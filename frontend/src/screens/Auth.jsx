import React, { useState } from 'react'
import { api } from '../api'

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [isOtpSent, setIsOtpSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernames, setUsernames] = useState([])
  const [selectedUsername, setSelectedUsername] = useState('')

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const purpose = isForgotPassword ? 'password_reset' : 'registration'
      
      if (isForgotPassword && !selectedUsername) {
        const accounts = await api.getUsernamesByEmail(email)
        if (accounts.length === 0) {
          throw new Error('No accounts found with this email')
        }
        if (accounts.length === 1) {
          setSelectedUsername(accounts[0])
        } else {
          setUsernames(accounts)
          setMessage('Multiple accounts found. Please select one below.')
          setLoading(false)
          return
        }
      }

      await api.sendOtp(email, purpose, isForgotPassword ? selectedUsername : username)
      setIsOtpSent(true)
      setMessage('OTP has been sent to your email.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      let data
      if (isLogin) {
        data = await api.login(username, password)
        onLogin(data)
      } else if (isForgotPassword) {
        if (!isOtpSent) {
          await handleSendOtp(e)
          return
        }
        await api.resetPassword(email, otpCode, password, selectedUsername)
        setMessage('Password reset successful. You can now login.')
        setIsForgotPassword(false)
        setIsLogin(true)
        setIsOtpSent(false)
        setOtpCode('')
      } else {
        // Registration
        if (!isOtpSent) {
          await handleSendOtp(e)
          return
        }
        data = await api.register(username, email, password, otpCode)
        onLogin(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const resetState = () => {
    setError('')
    setMessage('')
    setIsOtpSent(false)
    setOtpCode('')
    setPassword('')
    setUsernames([])
    setSelectedUsername('')
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{isForgotPassword ? 'Reset Password' : (isLogin ? 'Welcome Back' : 'Join Now')}</h1>
        <p>
          {isForgotPassword 
            ? 'Enter your email to receive an OTP' 
            : (isLogin ? 'Sign in to continue to ConnectFlow' : 'Create your ConnectFlow account')}
        </p>

        {error && <div className="error-message">{error}</div>}
        {message && <div className="success-message" style={{ color: '#00cec9', marginBottom: '15px', fontSize: '0.9rem' }}>{message}</div>}

        <form onSubmit={handleSubmit}>
          {isLogin && !isForgotPassword && (
            <div className="form-group">
              <label>Username</label>
              <input
                id="auth-username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}
          {(!isLogin || isForgotPassword) && (
            <div className="form-group">
              <label>Email</label>
              <input
                id="auth-email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isOtpSent || usernames.length > 0}
              />
            </div>
          )}

          {isForgotPassword && usernames.length > 0 && !isOtpSent && (
            <div className="form-group">
              <label>Select Account</label>
              <select 
                className="form-input"
                value={selectedUsername} 
                onChange={(e) => setSelectedUsername(e.target.value)}
                required
                style={{ 
                  width: '100%',
                  padding: '14px 16px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  outline: 'none',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 16px center',
                  backgroundSize: '16px'
                }}
              >
                <option value="" disabled style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>Select which username to reset</option>
                {usernames.map(u => (
                  <option key={u} value={u} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>{u}</option>
                ))}
              </select>
            </div>
          )}

          {!isLogin && !isForgotPassword && (
            <div className="form-group">
              <label>Username</label>
              <input
                id="auth-reg-username"
                type="text"
                placeholder="Pick a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}

          {(isOtpSent || isLogin) && (
            <div className="form-group">
              <label>{isForgotPassword ? 'New Password' : 'Password'}</label>
              <div className="password-input-wrapper">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isForgotPassword ? 'Enter new password' : 'Enter your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: '45px' }}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>
          )}

          {isOtpSent && (
            <div className="form-group">
              <label>OTP Code</label>
              <input
                id="auth-otp"
                type="text"
                placeholder="Enter 6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                required
              />
            </div>
          )}

          <button id="auth-submit" type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <span className="loading-spinner"></span> : (
              isForgotPassword 
                ? (isOtpSent ? 'Reset Password' : 'Send OTP') 
                : (isLogin ? 'Sign In' : (isOtpSent ? 'Verify & Register' : 'Send OTP'))
            )}
          </button>
        </form>

        <div className="auth-toggle">
          {isLogin && !isForgotPassword && (
            <div style={{ marginBottom: '10px' }}>
              <span onClick={() => { setIsForgotPassword(true); setIsLogin(false); resetState(); }}>
                Forgot Password?
              </span>
            </div>
          )}
          
          <span onClick={() => { 
            if (isForgotPassword) {
              setIsForgotPassword(false);
              setIsLogin(true);
            } else {
              setIsLogin(!isLogin);
            }
            resetState();
          }}>
            {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
          </span>
        </div>
      </div>
    </div>
  )
}
