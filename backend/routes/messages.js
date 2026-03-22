const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get messages between current user and a friend
router.get('/:friendId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const friendId = parseInt(req.params.friendId);

    // Verify they are friends
    const friendship = db.prepare(`
      SELECT id FROM friends
      WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
    `).get(userId, friendId, friendId, userId);

    if (!friendship) {
      return res.status(403).json({ error: 'You can only chat with friends' });
    }

    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.receiver_id, m.message, m.is_read, m.created_at,
             u.username as sender_username
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
      LIMIT 200
    `).all(userId, friendId, friendId, userId);

    res.json({ messages });
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
