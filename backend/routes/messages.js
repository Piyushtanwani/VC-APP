const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get messages between current user and a friend
router.get('/:friendId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const friendId = parseInt(req.params.friendId);

    // Verify they are friends
    const friendshipRes = await db.query(`
      SELECT id FROM friends
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    `, [userId, friendId]);

    if (friendshipRes.rows.length === 0) {
      return res.status(403).json({ error: 'You can only chat with friends' });
    }

    const messagesRes = await db.query(`
      SELECT m.id, m.sender_id, m.receiver_id, m.message, m.is_read, m.created_at,
             u.username as sender_username
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [userId, friendId]);

    res.json({ messages: messagesRes.rows });
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
