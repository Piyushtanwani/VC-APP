import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSocket } from '../SocketContext'
import { api } from '../api'

export default function ChatView({ friend, currentUser, onStartCall, onBack }) {
  const { socket } = useSocket()
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef(null)
  const prevFriendRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Load messages when friend changes
  useEffect(() => {
    if (!friend) return

    // Reset messages when friend changes
    if (prevFriendRef.current !== friend.id) {
      setMessages([])
      prevFriendRef.current = friend.id
    }

    const loadMessages = async () => {
      try {
        const data = await api.getMessages(friend.id)
        setMessages(data.messages)
      } catch (err) {
        console.error('Load messages error:', err)
      }
    }
    loadMessages()
  }, [friend])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Listen for incoming messages
  useEffect(() => {
    if (!socket) return

    const handleReceiveMessage = (data) => {
      if (data.sender_id === friend.id) {
        setMessages(prev => [...prev, data])
      }
    }

    socket.on('receive_message', handleReceiveMessage)

    return () => {
      socket.off('receive_message', handleReceiveMessage)
    }
  }, [socket, friend])

  // Mark incoming messages as read only if window is active and focused
  const markMessagesAsRead = useCallback(() => {
    if (!socket || !friend || messages.length === 0) return

    // Check if the app is in the foreground and has focus
    const isVisible = document.visibilityState === 'visible'
    const isFocused = document.hasFocus()

    if (!isVisible || !isFocused) return

    const unreadFromFriend = messages
      .filter(m => m.sender_id === friend.id && !m.is_read)
      .map(m => m.id)

    if (unreadFromFriend.length > 0) {
      socket.emit('mark_read', {
        messageIds: unreadFromFriend,
        senderId: friend.id
      })
      // Local update to avoid waiting for roundtrip
      setMessages(prev => prev.map(m => 
        unreadFromFriend.includes(m.id) ? { ...m, is_read: 1 } : m
      ))
    }
  }, [socket, friend, messages])

  // Trigger mark as read when messages change or when user returns to app
  useEffect(() => {
    markMessagesAsRead()

    const handleActivity = () => {
      markMessagesAsRead()
    }

    window.addEventListener('visibilitychange', handleActivity)
    window.addEventListener('focus', handleActivity)

    return () => {
      window.removeEventListener('visibilitychange', handleActivity)
      window.removeEventListener('focus', handleActivity)
    }
  }, [markMessagesAsRead])

  // Listen for sent message confirmations and read receipts
  useEffect(() => {
    if (!socket) return

    const handleMessageSent = (data) => {
      if (data.receiver_id === friend.id) {
        setMessages(prev => [...prev, data])
      }
    }

    const handleMessagesRead = (data) => {
      if (data.readerId === friend.id) {
        setMessages(prev => prev.map(m => 
          data.messageIds.includes(m.id) ? { ...m, is_read: 1 } : m
        ))
      }
    }

    socket.on('message_sent', handleMessageSent)
    socket.on('messages_read', handleMessagesRead)

    return () => {
      socket.off('message_sent', handleMessageSent)
      socket.off('messages_read', handleMessagesRead)
    }
  }, [socket, friend])

  const handleSend = (e) => {
    e.preventDefault()
    if (!inputValue.trim() || !socket) return

    socket.emit('send_message', {
      receiverId: friend.id,
      message: inputValue.trim()
    })

    setInputValue('')
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    // If the string doesn't end with Z and doesn't have a timezone offset, append Z
    // SQLite's datetime('now') returning YYYY-MM-DD HH:MM:SS format needs Z for JS to treat as UTC
    const normalized = (dateStr.endsWith('Z') || dateStr.includes('+')) 
      ? dateStr 
      : (dateStr.includes('T') ? dateStr + 'Z' : dateStr.replace(' ', 'T') + 'Z')
      
    const date = new Date(normalized)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <>
      <div className="chat-header">
        <div className="chat-header-left">
          <button className="btn-icon mobile-only" onClick={onBack} title="Back to list" style={{ width: 36, height: 36, marginRight: 8, fontSize: '1.2rem' }}>
            ←
          </button>
          <div className="avatar-wrapper">
            <div className="avatar">
              {friend.username[0].toUpperCase()}
            </div>
          </div>
          <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div className="name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {friend.username}
            </div>
            <div className={`status ${friend.online_status ? 'online' : ''}`}>
              {friend.online_status ? '● Online' : '○ Offline'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn-icon btn-call"
            onClick={() => onStartCall(friend)}
            title="Video Call"
          >
            📹
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👋</div>
            <h3>Start the conversation</h3>
            <p>Send a message to {friend.username}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-group ${msg.sender_id === currentUser.id ? 'sent' : 'received'}`}
            >
              <div className="message-bubble">
                {msg.message}
                {msg.sender_id === currentUser.id && (
                  <span className={`read-receipt ${msg.is_read ? 'read' : ''}`} style={{ fontSize: '0.6rem', marginLeft: '6px', opacity: 0.7 }}>
                    {msg.is_read ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
              <div className="message-time">{formatTime(msg.created_at)}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSend}>
        <input
          id="chat-message-input"
          className="chat-input"
          type="text"
          placeholder={`Message ${friend.username}...`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          autoFocus
        />
        <button id="chat-send-btn" type="submit" className="send-btn" disabled={!inputValue.trim()}>
          ➤
        </button>
      </form>
    </>
  )
}
