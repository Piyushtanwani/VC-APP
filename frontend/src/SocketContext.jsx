import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Capacitor } from '@capacitor/core'

const SocketContext = createContext(null)

export function useSocket() {
  return useContext(SocketContext)
}

export function SocketProvider({ children, token }) {
  const [socket, setSocket] = useState(null)
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    if (!token) return

    const isNative = Capacitor.isNativePlatform();
    // Use relative path '' for web production, localhost for local web, and hardcoded URL for native app.
    const SOCKET_URL = isNative ? 'https://vc-app-ibdu.onrender.com' : (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');
    const newSocket = io(SOCKET_URL, {
      auth: { token }
    })

    newSocket.on('connect', () => {
      console.log('Socket connected')
    })

    newSocket.on('pending_notifications', (data) => {
      setNotifications(prev => [...data, ...prev])
    })

    newSocket.on('connect_error', (err) => {
      console.error('Socket error:', err.message)
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [token])

  const clearNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const addNotification = useCallback((notif) => {
    setNotifications(prev => [notif, ...prev])
  }, [])

  return (
    <SocketContext.Provider value={{ socket, notifications, clearNotifications, addNotification }}>
      {children}
    </SocketContext.Provider>
  )
}
