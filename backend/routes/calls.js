const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get call history for the current user
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    // Get calls where user was either caller or receiver
    const calls = db.prepare(`
      SELECT 
        c.*, 
        u1.username as caller_name, 
        u2.username as receiver_name
      FROM call_history c
      JOIN users u1 ON c.caller_id = u1.id
      JOIN users u2 ON c.receiver_id = u2.id
      WHERE c.caller_id = ? OR c.receiver_id = ?
      ORDER BY c.created_at DESC
      LIMIT 50
    `).all(userId, userId);

    res.json({ calls });
  } catch (err) {
    console.error('Fetch call history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
