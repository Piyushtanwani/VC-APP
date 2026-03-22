const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get friends list
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;

    const friends = db.prepare(`
      SELECT u.id, u.username, u.email, u.online_status
      FROM friends f
      JOIN users u ON (u.id = f.user1_id OR u.id = f.user2_id)
      WHERE (f.user1_id = ? OR f.user2_id = ?) AND u.id != ?
      ORDER BY u.online_status DESC, u.username ASC
    `).all(userId, userId, userId);

    res.json({ friends });
  } catch (err) {
    console.error('Friends error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
