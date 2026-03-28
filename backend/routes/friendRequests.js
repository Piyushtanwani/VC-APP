const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Send friend request
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user.id;

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send request to yourself' });
    }

    const receiverRes = await db.query('SELECT id FROM users WHERE id = $1', [receiverId]);
    if (receiverRes.rows.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    // Check if already friends
    const friendshipRes = await db.query(`
      SELECT id FROM friends
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    `, [senderId, receiverId]);

    if (friendshipRes.rows.length > 0) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Check if request already exists
    const existingRes = await db.query(`
      SELECT id, status FROM friend_requests
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
    `, [senderId, receiverId]);

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Request already pending' });
      }
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      // If rejected, allow re-sending by updating the existing record
      await db.query(`
        UPDATE friend_requests 
        SET sender_id = $1, receiver_id = $2, status = 'pending', created_at = CURRENT_TIMESTAMP 
        WHERE id = $3
      `, [senderId, receiverId, existing.id]);

      const senderRes = await db.query('SELECT id, username FROM users WHERE id = $1', [senderId]);
      const sender = senderRes.rows[0];

      // Store notification for offline user
      await db.query(
        'INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)',
        [receiverId, 'friend_request_received', JSON.stringify({ from: sender })]
      );

      return res.json({ message: 'Friend request re-sent', requestId: existing.id });
    }

    const insertRes = await db.query(
      'INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING id',
      [senderId, receiverId]
    );
    const requestId = insertRes.rows[0].id;

    const senderRes = await db.query('SELECT id, username FROM users WHERE id = $1', [senderId]);
    const sender = senderRes.rows[0];

    // Store notification for offline user
    await db.query(
      'INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)',
      [receiverId, 'friend_request_received', JSON.stringify({ from: sender, requestId: requestId })]
    );

    res.status(201).json({ message: 'Friend request sent', requestId: requestId });
  } catch (err) {
    console.error('Send request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Respond to friend request
router.post('/respond', authenticateToken, async (req, res) => {
  try {
    const { requestId, action } = req.body;
    const userId = req.user.id;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or reject' });
    }

    const requestRes = await db.query(
      'SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = $3',
      [requestId, userId, 'pending']
    );
    const request = requestRes.rows[0];

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    await db.query('UPDATE friend_requests SET status = $1 WHERE id = $2', [newStatus, requestId]);

    if (action === 'accept') {
      // Create friendship (lower id always first for consistency)
      const user1 = Math.min(request.sender_id, request.receiver_id);
      const user2 = Math.max(request.sender_id, request.receiver_id);
      
      await db.query(
        'INSERT INTO friends (user1_id, user2_id) VALUES ($1, $2) ON CONFLICT (user1_id, user2_id) DO NOTHING',
        [user1, user2]
      );

      const acceptorRes = await db.query('SELECT id, username FROM users WHERE id = $1', [userId]);
      const acceptor = acceptorRes.rows[0];

      // Store notification for sender
      await db.query(
        'INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)',
        [request.sender_id, 'friend_request_accepted', JSON.stringify({ from: acceptor })]
      );
    }

    res.json({ message: `Friend request ${newStatus}` });
  } catch (err) {
    console.error('Respond error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get pending friend requests (received)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const requestsRes = await db.query(`
      SELECT fr.id, fr.sender_id, fr.status, fr.created_at,
             u.username as sender_username
      FROM friend_requests fr
      JOIN users u ON u.id = fr.sender_id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [req.user.id]);

    res.json({ requests: requestsRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get sent friend requests
router.get('/sent', authenticateToken, async (req, res) => {
  try {
    const requestsRes = await db.query(`
      SELECT fr.id, fr.receiver_id, fr.status, fr.created_at,
             u.username as receiver_username
      FROM friend_requests fr
      JOIN users u ON u.id = fr.receiver_id
      WHERE fr.sender_id = $1
      ORDER BY fr.created_at DESC
    `, [req.user.id]);

    res.json({ requests: requestsRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
