const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Search users by username
router.get('/', authenticateToken, (req, res) => {
  try {
    const { search } = req.query;
    if (!search || search.length < 1) {
      return res.json({ users: [] });
    }

    const users = db.prepare(`
      SELECT id, username, email, online_status
      FROM users
      WHERE username LIKE ? AND id != ?
      LIMIT 20
    `).all(`%${search}%`, req.user.id);

    res.json({ users });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
