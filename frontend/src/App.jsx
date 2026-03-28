import React, { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { SocketProvider, useSocket } from './SocketContext'
import { PushNotifications } from '@capacitor/push-notifications'
import { api } from './api'
import Auth from './screens/Auth'
import Dashboard from './screens/Dashboard'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(null)

  useEffect(() => {
    const requestPermissions = async () => {
      if (!Capacitor.isNativePlatform()) return
      try {
        const perm = await LocalNotifications.requestPermissions()
        if (perm.display === 'granted') {
          // Create a channel for Android 8.0+
          await LocalNotifications.createChannel({
            id: 'chat-messages',
            name: 'Chat Messages',
            description: 'Notifications for new chat messages',
            importance: 5,
            visibility: 1,
            sound: 'default'
          })
        }

        // Push Notifications
        const pushPerm = await PushNotifications.requestPermissions()
        if (pushPerm.receive === 'granted') {
          await PushNotifications.register()
          
          // Create WebRTC Call Channel for Android high-priority ringtones
          await PushNotifications.createChannel({
            id: 'calls',
            name: 'Video Calls',
            description: 'Incoming video call alerts',
            importance: 5,
            visibility: 1,
            sound: 'ringtone',
            vibration: true
          })
        }
      } catch (err) {
        console.error('Error requesting notifications:', err)
      }
    }
    requestPermissions()

    if (Capacitor.isNativePlatform()) {
      PushNotifications.addListener('registration', (token) => {
        console.log('Push registration success, token: ' + token.value)
        localStorage.setItem('fcmToken', token.value)
        if (localStorage.getItem('token')) {
          api.updateFcmToken(token.value).catch(err => console.error('Failed to sync FCM token:', err))
        }
      })

      PushNotifications.addListener('registrationError', (error) => {
        console.error('Push registration error: ' + JSON.stringify(error))
      })

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received: ' + JSON.stringify(notification))
      })

      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('Push action performed:', notification)
        const { data } = notification.notification
        if (data && data.senderId) {
          // Store in session storage for Dashboard to pick up on mount
          sessionStorage.setItem('pendingNotification', JSON.stringify(data))
          window.location.reload() // Force reload to ensure Dashboard picks it up if already in a weird state
        }
      })
    }
  }, [])

  const handleLogin = (data) => {
    localStorage.setItem('token', data.token)
    setToken(data.token)
    setUser(data.user)
    
    // Sync FCM token if available
    const fcmToken = localStorage.getItem('fcmToken')
    if (fcmToken) {
      api.updateFcmToken(fcmToken).catch(err => console.error('Failed to sync FCM token:', err))
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  if (!token) {
    return <Auth onLogin={handleLogin} />
  }

  return (
    <SocketProvider token={token}>
      <Dashboard user={user} setUser={setUser} token={token} onLogout={handleLogout} />
    </SocketProvider>
  )
}
