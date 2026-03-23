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
        console.log('Push action performed: ' + JSON.stringify(notification))
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
