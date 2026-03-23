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

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const purpose = isForgotPassword ? 'password_reset' : 'registration'
      await api.sendOtp(email, purpose, username)
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
        await api.resetPassword(email, otpCode, password)
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
                disabled={isOtpSent}
              />
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
