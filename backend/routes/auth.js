const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendOTP } = require('../utils/email');

const router = express.Router();

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP for Register
router.post('/send-otp', async (req, res) => {
  try {
    const { email, purpose } = req.body; // purpose: 'registration' or 'password_reset'
    if (!email || !purpose) {
      return res.status(400).json({ error: 'Email and purpose are required' });
    }

    // If purpose is registration, check if user exists
    if (purpose === 'registration') {
      const { username } = req.body;
      const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
      if (existingEmail) {
        return res.status(409).json({ error: 'Email already exists' });
      }
      
      if (username) {
        const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
        if (existingUser) {
          return res.status(409).json({ error: 'Username already exists' });
        }
      }
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    // Delete existing OTPs for this email/purpose
    db.prepare('DELETE FROM otp_verifications WHERE email = ? AND purpose = ?').run(email, purpose);
    
    // Save new OTP
    db.prepare('INSERT INTO otp_verifications (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)')
      .run(email, code, purpose, expiresAt);

    const sent = await sendOTP(email, code, purpose);
    if (sent) {
      res.json({ message: 'OTP sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send email' });
    }
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register
router.post('/register', (req, res) => {
  try {
    const { username, email, password, otpCode, fcmToken } = req.body;

    if (!username || !email || !password || !otpCode) {
      return res.status(400).json({ error: 'All fields including OTP are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Verify OTP
    const otp = db.prepare('SELECT * FROM otp_verifications WHERE email = ? AND code = ? AND purpose = ?')
      .get(email, otpCode, 'registration');

    if (!otp) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired' });
    }

    // Check if user exists (double check case-insensitively)
    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Delete OTP after use
    db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(otp.id);

    const password_hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, email, password_hash, fcm_token) VALUES (?, ?, ?, ?)').run(username, email, password_hash, fcmToken || null);

    const token = jwt.sign({ id: result.lastInsertRowid, username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: { id: result.lastInsertRowid, username, email }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', (req, res) => {
  try {
    const { username, password, fcmToken } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    if (fcmToken) {
      db.prepare('UPDATE users SET fcm_token = ? WHERE id = ?').run(fcmToken, user.id);
    }

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email, online_status FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      // Don't reveal if user exists for security, just say "If email exists..."
      return res.json({ message: 'If an account exists with this email, an OTP has been sent.' });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare('DELETE FROM otp_verifications WHERE email = ? AND purpose = ?').run(email, 'password_reset');
    db.prepare('INSERT INTO otp_verifications (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)')
      .run(email, code, 'password_reset', expiresAt);

    await sendOTP(email, code, 'password_reset');
    res.json({ message: 'If an account exists with this email, an OTP has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password
router.post('/reset-password', (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body;
    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const otp = db.prepare('SELECT * FROM otp_verifications WHERE email = ? AND code = ? AND purpose = ?')
      .get(email, otpCode, 'password_reset');

    if (!otp || new Date(otp.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const password_hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(password_hash, email);
    db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(otp.id);

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update FCM Token
router.post('/fcm-token', authenticateToken, (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'FCM token is required' });

    db.prepare('UPDATE users SET fcm_token = ? WHERE id = ?').run(fcmToken, req.user.id);
    res.json({ message: 'FCM token updated successfully' });
  } catch (err) {
    console.error('Update FCM token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
