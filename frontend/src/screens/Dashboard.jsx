import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useSocket } from '../SocketContext'
import { api } from '../api'
import ChatView from './ChatView'
import CallScreen from './CallScreen'
import { App } from '@capacitor/app'

export default function Dashboard({ user, setUser, token, onLogout }) {
  const { socket, notifications, addNotification } = useSocket()
  const [activeTab, setActiveTab] = useState('friends')
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [sentRequests, setSentRequests] = useState([])
  const [toasts, setToasts] = useState([])
  const [unreadCounts, setUnreadCounts] = useState({})
  const [lastMessages, setLastMessages] = useState({})
  const [callHistory, setCallHistory] = useState([])

  // Call state
  const [incomingCall, setIncomingCall] = useState(null)
  const [activeCall, setActiveCall] = useState(null)
  const [callSignal, setCallSignal] = useState(null)

  // Handle Android Hardware Back Button
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    
    const listener = App.addListener('backButton', () => {
      // Do nothing if in an active call (let them use on-screen buttons)
      if (activeCall) return;
      
      // If chat is open, close chat
      if (selectedFriend) {
        setSelectedFriend(null);
      } else {
        // If on the main dashboard tab, minimize app (sends to background)
        App.minimizeApp();
      }
    });
    
    return () => {
      listener.then(l => l.remove());
    }
  }, [activeCall, selectedFriend]);

  // Load user info if not available
  useEffect(() => {
    if (!user) {
      api.getMe().then(data => setUser(data.user)).catch(() => onLogout())
    }
  }, [user, setUser, onLogout])

  // Load friends and requests
  const loadFriends = useCallback(async () => {
    try {
      const data = await api.getFriends()
      setFriends(data.friends)
    } catch (err) {
      console.error('Load friends error:', err)
    }
  }, [])

  const loadRequests = useCallback(async () => {
    try {
      const data = await api.getFriendRequests()
      setFriendRequests(data.requests)
    } catch (err) {
      console.error('Load requests error:', err)
    }
  }, [])

  const loadSentRequests = useCallback(async () => {
    try {
      const data = await api.getSentRequests()
      setSentRequests(data.requests)
    } catch (err) {
      console.error('Load sent error:', err)
    }
  }, [])

  const loadCallHistory = useCallback(async () => {
    try {
      const data = await api.getCallHistory()
      setCallHistory(data.calls)
    } catch (err) {
      console.error('Load history error:', err)
    }
  }, [])

  useEffect(() => {
    loadFriends()
    loadRequests()
    loadSentRequests()
    loadCallHistory()
  }, [loadFriends, loadRequests, loadSentRequests, loadCallHistory])

  // Socket and Push Notification Configuration
  useEffect(() => {
    // 1. Configure Notification Channels & Actions (Capacitor Native)
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.createChannel({
        id: 'calls',
        name: 'Incoming Calls',
        description: 'Persistent notifications for incoming video calls',
        importance: 5, // High importance (Head-up)
        visibility: 1, // Public
        vibration: true,
        sound: 'ringtone.mp3' // Placeholder for system ringtone if possible, otherwise default
      });

      // Register "Accept" and "Decline" actions
      LocalNotifications.registerActionTypes({
        types: [
          {
            id: 'CALL_NOTIFICATION',
            actions: [
              { id: 'accept', title: 'Accept', foreground: true },
              { id: 'decline', title: 'Decline', destructive: true, foreground: false }
            ]
          }
        ]
      });

      // Handle Notification Actions
      const actionListener = LocalNotifications.addListener('localNotificationActionPerformed', (data) => {
        const { actionId, notification } = data;
        const callData = notification.extra; // This should contain the caller info

        if (actionId === 'accept') {
          // Open the specific chat/call
          if (callData && callData.callerId) {
            const friend = friends.find(f => f.id === parseInt(callData.callerId));
            if (friend) {
              handleStartCall(friend);
            }
          }
        } else if (actionId === 'decline') {
          // Send rejection via socket if connected, or via API
          if (socket && callData && callData.callerId) {
            socket.emit('reject_call', { callerId: parseInt(callData.callerId) });
          }
        }
      });

      // Handle Incoming Push Messages (Wakeup)
      // When a data-only message arrives in background
      import('@capacitor/push-notifications').then(({ PushNotifications }) => {
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push received:', notification);
          
          const { data } = notification;
          if (data && data.isVoip === 'true') {
            // Manually show local notification with buttons
            LocalNotifications.schedule({
              notifications: [
                {
                  title: data.title || 'Incoming Video Call',
                  body: data.body || 'Someone is calling you...',
                  id: Date.now(),
                  schedule: { at: new Date(Date.now() + 100) },
                  sound: 'ringtone',
                  channelId: 'calls',
                  actionTypeId: 'CALL_NOTIFICATION',
                  extra: data
                }
              ]
            });
          }
        });
      });

      return () => {
        actionListener.remove();
      }
    }
  }, [socket, friends])

  // Main Socket events
  useEffect(() => {
    if (!socket) return

    socket.on('friend_request_received', (data) => {
      showToast('🤝 Friend Request', `${data.from.username} sent you a friend request`)
      loadRequests()
    })

    socket.on('friend_request_accepted', (data) => {
      showToast('🎉 New Friend!', `${data.from.username} accepted your request`)
      loadFriends()
      loadSentRequests()
    })

    socket.on('initial_friends_status', (data) => {
      setFriends(prev => prev.map(f => {
        const friendId = Number(f.id);
        const status = data.find(s => Number(s.userId) === friendId)
        return status ? { ...f, online_status: status.isOnline ? 1 : 0 } : f
      }))
    })

    socket.on('user_status_changed', (data) => {
      const changedUserId = Number(data.userId);
      setFriends(prev => prev.map(f =>
        Number(f.id) === changedUserId ? { ...f, online_status: data.isOnline ? 1 : 0 } : f
      ))
      if (selectedFriend && Number(selectedFriend.id) === changedUserId) {
        setSelectedFriend(prev => ({ ...prev, online_status: data.isOnline ? 1 : 0 }))
      }
    })

    socket.on('incoming_call', (data) => {
      setIncomingCall(data)
      setCallSignal(data.signal)
    })

    socket.on('call_rejected', () => {
      showToast('📞 Call Declined', 'The user declined your call')
      setActiveCall(null)
    })

    socket.on('call_ended', () => {
      showToast('📞 Call Ended', 'The call has ended')
      setActiveCall(null)
    })

    socket.on('receive_message', (data) => {
      // Update last message preview
      setLastMessages(prev => ({
        ...prev,
        [data.sender_id]: data.message
      }))

      // Native Phone Notification
      if (!selectedFriend || selectedFriend.id !== data.sender_id) {
        if (Capacitor.isNativePlatform()) {
          LocalNotifications.checkPermissions().then(permission => {
            if (permission.display === 'granted') {
              LocalNotifications.schedule({
                notifications: [
                  {
                    title: `New message from ${data.sender_username}`,
                    body: data.message.length > 50 ? data.message.substring(0, 50) + '...' : data.message,
                    id: Date.now(),
                    schedule: { at: new Date(Date.now() + 100) },
                    sound: 'default',
                    channelId: 'chat-messages'
                  }
                ]
              })
            }
          })
        }
      }

      if (!selectedFriend || selectedFriend.id !== data.sender_id) {
        showToast(`💬 ${data.sender_username} says:`, data.message)
        // Increment unread count
        setUnreadCounts(prev => ({
          ...prev,
          [data.sender_id]: (prev[data.sender_id] || 0) + 1
        }))
      }
    })

    socket.on('message_sent', (data) => {
      // Update last message preview for the thread we just sent to
      setLastMessages(prev => ({
        ...prev,
        [data.receiver_id]: `You: ${data.message}`
      }))
    })

    return () => {
      socket.off('friend_request_received')
      socket.off('friend_request_accepted')
      socket.off('initial_friends_status')
      socket.off('user_status_changed')
      socket.off('incoming_call')
      socket.off('call_rejected')
      socket.off('call_ended')
      socket.off('receive_message')
      socket.off('message_sent')
    }
  }, [socket, selectedFriend, loadFriends, loadRequests, loadSentRequests])

  // Toast notifications
  const showToast = (title, desc) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, title, desc }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  // Search
  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([])
      return
    }
    const timeout = setTimeout(async () => {
      try {
        const data = await api.searchUsers(searchQuery)
        setSearchResults(data.users)
      } catch (err) {
        console.error('Search error:', err)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQuery])

  // Actions
  const handleSendRequest = async (receiverId) => {
    try {
      const data = await api.sendFriendRequest(receiverId)
      showToast('✅ Sent!', 'Friend request sent successfully')
      if (socket) {
        socket.emit('send_friend_request', { receiverId, requestId: data.requestId })
      }
      loadSentRequests()
    } catch (err) {
      showToast('❌ Error', err.message)
    }
  }

  const handleRespondRequest = async (requestId, action, senderId) => {
    try {
      await api.respondFriendRequest(requestId, action)
      if (action === 'accept' && socket) {
        socket.emit('respond_friend_request', { action: 'accept', senderId })
      }
      loadRequests()
      loadFriends()
      showToast(action === 'accept' ? '🎉 Accepted!' : '✓ Declined', 
        action === 'accept' ? 'You are now friends!' : 'Request declined')
    } catch (err) {
      showToast('❌ Error', err.message)
    }
  }

  const handleStartCall = (friend) => {
    setActiveCall({ target: friend, isCaller: true })
  }

  const handleAcceptCall = () => {
    if (incomingCall) {
      setActiveCall({ target: incomingCall.from, isCaller: false, incomingSignal: callSignal })
      setIncomingCall(null)
    }
  }

  const handleRejectCall = () => {
    if (incomingCall && socket) {
      socket.emit('reject_call', { callerId: incomingCall.from.id })
    }
    setIncomingCall(null)
    setCallSignal(null)
  }

  const handleEndCall = () => {
    setActiveCall(null)
  }

  if (!user) return <div className="auth-container"><div className="loading-spinner"></div></div>

  const isSentToUser = (userId) => sentRequests.some(r => r.receiver_id === userId && r.status === 'pending')
  const isFriend = (userId) => friends.some(f => f.id === userId)

  return (
    <>
      <div className={`app-layout ${selectedFriend ? 'chat-active' : ''}`}>
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <span className="logo">ConnectFlow</span>
          </div>

          <div className="sidebar-nav">
            <button
              className={`nav-btn ${activeTab === 'friends' ? 'active' : ''}`}
              onClick={() => setActiveTab('friends')}
            >
              <span className="icon">👥</span>
              Friends
            </button>
            <button
              className={`nav-btn ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              <span className="icon">🔍</span>
              Search
            </button>
            <button
              className={`nav-btn ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              <span className="icon">🤝</span>
              Requests
              {friendRequests.length > 0 && <span className="badge">{friendRequests.length}</span>}
            </button>
            <button
              className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('history')
                loadCallHistory()
              }}
            >
              <span className="icon">🕒</span>
              History
            </button>
          </div>

          <div className="sidebar-content">
            {activeTab === 'friends' && (
              <>
                <div className="section-title">
                  Friends ({friends.length})
                </div>
                {friends.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No friends yet. Search and add people!
                  </div>
                ) : (
                  friends.map(friend => (
                    <div
                      key={friend.id}
                      className={`friend-card ${selectedFriend?.id === friend.id ? 'active' : ''} ${unreadCounts[friend.id] ? 'unread' : ''}`}
                      onClick={() => {
                        setSelectedFriend(friend);
                        setUnreadCounts(prev => ({ ...prev, [friend.id]: 0 }));
                      }}
                    >
                      <div className="avatar-wrapper">
                        <div className="avatar">
                          {friend.username[0].toUpperCase()}
                        </div>
                      </div>
                      <div className="card-info">
                        <div className="name">{friend.username}</div>
                        <div className="last-msg-preview">
                          {lastMessages[friend.id] ? (
                            lastMessages[friend.id].length > 30 
                              ? lastMessages[friend.id].substring(0, 30) + '...' 
                              : lastMessages[friend.id]
                          ) : (
                            friend.online_status ? 'Online' : 'Offline'
                          )}
                        </div>
                      </div>
                      {unreadCounts[friend.id] > 0 && (
                        <div className="badge">{unreadCounts[friend.id]}</div>
                      )}
                    </div>
                  ))
                )}
              </>
            )}

            {activeTab === 'search' && (
              <>
                <div className="search-container">
                  <div className="search-input-wrapper">
                    <span className="search-icon">🔍</span>
                    <input
                      id="search-users"
                      className="search-input"
                      type="text"
                      placeholder="Search by username..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
                {searchResults.map(u => (
                  <div key={u.id} className="user-card">
                    <div className="avatar">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className="card-info">
                      <div className="name">{u.username}</div>
                      <div className={`status ${u.online_status ? 'online' : ''}`}>
                        {u.online_status ? '● Online' : '○ Offline'}
                      </div>
                    </div>
                    <div className="card-actions">
                      {isFriend(u.id) ? (
                        <button className="btn btn-ghost" disabled>Friends ✓</button>
                      ) : isSentToUser(u.id) ? (
                        <button className="btn btn-ghost" disabled>Pending ⏳</button>
                      ) : (
                        <button className="btn btn-success" onClick={() => handleSendRequest(u.id)}>Add +</button>
                      )}
                    </div>
                  </div>
                ))}
                {searchQuery && searchResults.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No users found for "{searchQuery}"
                  </div>
                )}
              </>
            )}

            {activeTab === 'requests' && (
              <>
                <div className="section-title">
                  Received ({friendRequests.length})
                </div>
                {friendRequests.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No pending requests
                  </div>
                ) : (
                  friendRequests.map(req => (
                    <div key={req.id} className="request-card">
                      <div className="avatar">
                        {req.sender_username[0].toUpperCase()}
                      </div>
                      <div className="card-info">
                        <div className="name">{req.sender_username}</div>
                        <div className="status">wants to be friends</div>
                      </div>
                      <div className="card-actions">
                        <button
                          className="btn btn-success"
                          onClick={() => handleRespondRequest(req.id, 'accept', req.sender_id)}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleRespondRequest(req.id, 'reject', req.sender_id)}
                        >
                          ✗
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {activeTab === 'history' && (
              <>
                <div className="section-title">
                  Call History ({callHistory.length})
                </div>
                {callHistory.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No calls recorded yet.
                  </div>
                ) : (
                  callHistory.map(call => {
                    const isCaller = call.caller_id === user.id
                    const otherName = isCaller ? call.receiver_name : call.caller_name
                    const formatDuration = (s) => {
                      if (!s) return '0s'
                      const m = Math.floor(s / 60)
                      const rs = s % 60
                      return m > 0 ? `${m}m ${rs}s` : `${rs}s`
                    }
                    const icon = call.status === 'completed' ? (isCaller ? '↗️' : '↙️') : (call.status === 'rejected' ? '🚫' : '📵')
                    const normalizedDate = call.created_at.includes('T') ? call.created_at : call.created_at.replace(' ', 'T') + 'Z'

                    return (
                      <div key={call.id} className="history-card">
                        <div className="avatar">
                          {otherName[0].toUpperCase()}
                        </div>
                        <div className="card-info">
                          <div className="name">
                            {icon} {otherName}
                          </div>
                          <div className="status">
                            {call.status === 'completed' ? formatDuration(call.duration) : call.status}
                          </div>
                          <div className="time" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                            {new Date(normalizedDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>

          <div className="sidebar-footer">
            <div className="user-info">
              <div className="avatar" style={{ background: 'linear-gradient(135deg, #00cec9, #6c5ce7)' }}>
                {user.username[0].toUpperCase()}
              </div>
              <span className="username">{user.username}</span>
            </div>
            <button className="btn-icon" onClick={onLogout} title="Logout">
              🚪
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="main-content">
          {selectedFriend ? (
            <ChatView
              friend={selectedFriend}
              currentUser={user}
              onStartCall={handleStartCall}
              onBack={() => setSelectedFriend(null)}
            />
          ) : (
            <div className="empty-state">
              <div className="icon">💬</div>
              <h3>Select a friend to chat</h3>
              <p>Choose someone from your friends list, or search for new people to connect with.</p>
            </div>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toasts.map((toast, i) => (
        <div key={toast.id} className="notification-toast" style={{ top: `${24 + i * 80}px` }}>
          <div className="content">
            <div className="title">{toast.title}</div>
            <div className="desc">{toast.desc}</div>
          </div>
          <button className="close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>✕</button>
        </div>
      ))}

      {/* Incoming call modal */}
      {incomingCall && (
        <div className="incoming-call-modal">
          <h3>📞 Incoming Call</h3>
          <p>{incomingCall.from.username} is calling you...</p>
          <div className="actions">
            <button className="btn btn-success" onClick={handleAcceptCall}>Accept ✓</button>
            <button className="btn btn-danger" onClick={handleRejectCall}>Decline ✗</button>
          </div>
        </div>
      )}

      {/* Active call */}
      {activeCall && (
        <CallScreen
          call={activeCall}
          currentUser={user}
          onEndCall={handleEndCall}
        />
      )}
    </>
  )
}
