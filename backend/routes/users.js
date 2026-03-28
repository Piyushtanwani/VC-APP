const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Search users by username
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || search.length < 1) {
      return res.json({ users: [] });
    }

    const usersRes = await db.query(`
      SELECT id, username, email, online_status
      FROM users
      WHERE username ILIKE $1 AND id != $2
      LIMIT 20
    `, [`%${search}%`, req.user.id]);

    res.json({ users: usersRes.rows });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
