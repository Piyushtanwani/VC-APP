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
    const { email, purpose, username } = req.body; // purpose: 'registration' or 'password_reset'
    if (!email || !purpose) {
      return res.status(400).json({ error: 'Email and purpose are required' });
    }

    // If purpose is registration, check if user exists
    if (purpose === 'registration') {
      if (username) {
        const userRes = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (userRes.rows.length > 0) {
          return res.status(400).json({ error: 'Username already exists' });
        }
      } else {
        return res.status(400).json({ error: 'Username is required for registration' });
      }
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    // Delete existing OTPs for this email/purpose
    await db.query('DELETE FROM otp_verifications WHERE email = $1 AND purpose = $2', [email, purpose]);
    
    // Save new OTP
    await db.query(
      'INSERT INTO otp_verifications (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)',
      [email, code, purpose, expiresAt]
    );

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
router.post('/register', async (req, res) => {
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
    const otpRes = await db.query(
      'SELECT * FROM otp_verifications WHERE email = $1 AND code = $2 AND purpose = $3',
      [email, otpCode, 'registration']
    );
    const otp = otpRes.rows[0];

    if (!otp) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired' });
    }

    // Check for existing username
    const existingUserRes = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existingUserRes.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Delete OTP after use
    await db.query('DELETE FROM otp_verifications WHERE id = $1', [otp.id]);

    const password_hash = bcrypt.hashSync(password, 10);
    const insertRes = await db.query(
      'INSERT INTO users (username, email, password_hash, fcm_token) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, email, password_hash, fcmToken || null]
    );
    const newUserId = insertRes.rows[0].id;

    const token = jwt.sign({ id: newUserId, username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: { id: newUserId, username, email }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password, fcmToken } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userRes = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userRes.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

    if (fcmToken) {
      await db.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcmToken, user.id]);
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
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userRes = await db.query('SELECT id, username, email, online_status FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
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

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.query('DELETE FROM otp_verifications WHERE email = $1 AND purpose = $2', [email, 'password_reset']);
    await db.query(
      'INSERT INTO otp_verifications (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)',
      [email, code, 'password_reset', expiresAt]
    );

    await sendOTP(email, code, 'password_reset');
    res.json({ message: 'If an account exists with this email, an OTP has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, username } = req.body;

    if (!email || !code || !newPassword || !username) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const otpRes = await db.query(
      'SELECT * FROM otp_verifications WHERE email = $1 AND code = $2 AND purpose = $3',
      [email, code, 'password_reset']
    );
    const otp = otpRes.rows[0];

    if (!otp || new Date(otp.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const updateRes = await db.query(
      'UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2) AND LOWER(username) = LOWER($3)',
      [hashedPassword, email, username]
    );

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: 'User not found with this email/username combination' });
    }
    await db.query('DELETE FROM otp_verifications WHERE id = $1', [otp.id]);

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get usernames associated with an email
router.get('/accounts', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const usersRes = await db.query('SELECT username FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    res.json(usersRes.rows.map(u => u.username));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/fcm-token', authenticateToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'FCM token is required' });

    await db.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcmToken, req.user.id]);
    res.json({ message: 'FCM token updated successfully' });
  } catch (err) {
    console.error('Update FCM token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
