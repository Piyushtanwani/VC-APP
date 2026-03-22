import React, { useState, useEffect, useCallback } from 'react'
import { SocketProvider, useSocket } from './SocketContext'
import Auth from './screens/Auth'
import Dashboard from './screens/Dashboard'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(null)

  const handleLogin = (data) => {
    localStorage.setItem('token', data.token)
    setToken(data.token)
    setUser(data.user)
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
