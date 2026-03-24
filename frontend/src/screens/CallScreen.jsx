import React, { useEffect, useRef, useState } from 'react'
import { useSocket } from '../SocketContext'

export default function CallScreen({ call, currentUser, onEndCall }) {
  const { socket } = useSocket()
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const iceCandidateBuffer = useRef([])
  const remoteDescSet = useRef(false)
  const [callStatus, setCallStatus] = useState(call.isCaller ? 'calling' : 'connecting')
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const timerRef = useRef(null)

  // Call timer — starts when connected
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1)
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [callStatus])

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        localStreamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }

        // Create peer connection
        const pc = new RTCPeerConnection(ICE_SERVERS)
        peerConnectionRef.current = pc

        // Add local tracks
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream)
        })

        // Handle remote track
        pc.ontrack = (event) => {
          console.log('Got remote track:', event.streams[0])
          if (remoteVideoRef.current && event.streams[0]) {
            remoteVideoRef.current.srcObject = event.streams[0]
            // Explicitly call play to bypass some mobile browser autoplay policies
            remoteVideoRef.current.play().then(() => {
              if (window.AudioToggle) {
                window.AudioToggle.setAudioMode(window.AudioToggle.SPEAKER);
              }
            }).catch(e => console.error("Audio autoplay prevented:", e))
          }
          if (mounted) setCallStatus('connected')
        }

        // Handle ICE candidates — send to peer
        pc.onicecandidate = (event) => {
          if (event.candidate && socket) {
            socket.emit('ice_candidate', {
              targetId: call.target.id,
              candidate: event.candidate
            })
          }
        }

        pc.oniceconnectionstatechange = () => {
          console.log('ICE state:', pc.iceConnectionState)
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            if (mounted) setCallStatus('connected')
          }
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            if (mounted) handleEndCall()
          }
        }

        // Helper to flush buffered ICE candidates
        const flushIceCandidates = async () => {
          while (iceCandidateBuffer.current.length > 0) {
            const candidate = iceCandidateBuffer.current.shift()
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
              console.log('Added buffered ICE candidate')
            } catch (err) {
              console.error('Error adding buffered ICE:', err)
            }
          }
        }

        // Socket: receive ICE candidates from peer
        const handleIceCandidate = async (data) => {
          if (remoteDescSet.current && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
              console.log('Added ICE candidate directly')
            } catch (err) {
              console.error('ICE candidate error:', err)
            }
          } else {
            // Buffer until remote description is set
            console.log('Buffering ICE candidate')
            iceCandidateBuffer.current.push(data.candidate)
          }
        }

        socket.on('ice_candidate', handleIceCandidate)

        if (call.isCaller) {
          // === CALLER FLOW ===
          // Listen for call_accepted BEFORE sending the offer
          const handleCallAccepted = async (data) => {
            try {
              console.log('Call accepted, setting remote description')
              if (mounted) setCallStatus('connecting')
              await pc.setRemoteDescription(new RTCSessionDescription(data.signal))
              remoteDescSet.current = true
              await flushIceCandidates()
              console.log('Remote description set, ICE candidates flushed')
            } catch (err) {
              console.error('Error handling call accepted:', err)
            }
          }

          socket.on('call_accepted', handleCallAccepted)

          // Create and send offer
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          console.log('Sending offer to', call.target.username)

          socket.emit('call_user', {
            targetId: call.target.id,
            signal: offer
          })

          if (mounted) setCallStatus('ringing')

        } else {
          // === CALLEE FLOW ===
          console.log('Answering call from', call.target.username)

          // Set the incoming offer as remote description
          await pc.setRemoteDescription(new RTCSessionDescription(call.incomingSignal))
          remoteDescSet.current = true
          await flushIceCandidates()

          // Create and send answer
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)

          socket.emit('accept_call', {
            callerId: call.target.id,
            signal: answer
          })

          if (mounted) setCallStatus('connecting')
          console.log('Answer sent')
        }
      } catch (err) {
        console.error('Call setup error:', err)
        if (mounted) setCallStatus('error')
      }
    }

    init()

    return () => {
      mounted = false
      cleanup()
      if (socket) {
        socket.off('ice_candidate')
        socket.off('call_accepted')
      }
    }
  }, [])

  const cleanup = () => {
    if (window.AudioToggle) {
      window.AudioToggle.setAudioMode(window.AudioToggle.NORMAL);
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
  }

  const handleEndCall = () => {
    if (socket) {
      socket.emit('end_call', { targetId: call.target.id })
    }
    cleanup()
    onEndCall()
  }

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks()
      audioTracks.forEach(track => { track.enabled = !track.enabled })
      setIsMuted(!isMuted)
    }
  }

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks()
      videoTracks.forEach(track => { track.enabled = !track.enabled })
      setIsVideoOff(!isVideoOff)
    }
  }

  return (
    <div className="call-overlay">
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>
          {callStatus === 'ringing' && `📞 Calling ${call.target.username}...`}
          {callStatus === 'connecting' && `⏳ Connecting...`}
          {callStatus === 'connected' && `🟢 ${call.target.username}`}
          {callStatus === 'calling' && `📞 Initiating call...`}
          {callStatus === 'error' && `❌ Call failed — check camera/mic permissions`}
        </h2>
        {callStatus === 'connected' && (
          <div style={{
            fontSize: '1.8rem',
            fontWeight: 700,
            marginTop: '4px',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--accent-light)',
            letterSpacing: '2px'
          }}>
            {formatDuration(callDuration)}
          </div>
        )}
      </div>

      <div className="call-videos">
        <video
          ref={remoteVideoRef}
          className="remote-video"
          autoPlay
          playsInline
        />
        <video
          ref={localVideoRef}
          className="local-video"
          autoPlay
          playsInline
          muted
        />
      </div>

      <div className="call-controls">
        <button
          className={`btn-icon ${isMuted ? 'btn-end' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          style={{ width: 56, height: 56, fontSize: '1.4rem' }}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          className={`btn-icon ${isVideoOff ? 'btn-end' : ''}`}
          onClick={toggleVideo}
          title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
          style={{ width: 56, height: 56, fontSize: '1.4rem' }}
        >
          {isVideoOff ? '📷' : '📹'}
        </button>
        <button
          className="btn-icon btn-end"
          onClick={handleEndCall}
          title="End call"
          style={{ width: 56, height: 56, fontSize: '1.4rem' }}
        >
          📵
        </button>
      </div>
    </div>
  )
}
