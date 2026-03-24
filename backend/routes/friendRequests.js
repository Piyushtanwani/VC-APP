const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Send friend request
router.post('/send', authenticateToken, (req, res) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user.id;

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send request to yourself' });
    }

    const receiverUser = db.prepare('SELECT id FROM users WHERE id = ?').get(receiverId);
    if (!receiverUser) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    // Check if already friends
    const friendship = db.prepare(`
      SELECT id FROM friends
      WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
    `).get(senderId, receiverId, receiverId, senderId);

    if (friendship) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Check if request already exists
    const existing = db.prepare(`
      SELECT id, status FROM friend_requests
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
    `).get(senderId, receiverId, receiverId, senderId);

    if (existing) {
      if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Request already pending' });
      }
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      // If rejected, allow re-sending by updating the existing record
      db.prepare(`UPDATE friend_requests SET sender_id = ?, receiver_id = ?, status = 'pending', created_at = datetime('now') WHERE id = ?`)
        .run(senderId, receiverId, existing.id);

      const sender = db.prepare('SELECT id, username FROM users WHERE id = ?').get(senderId);

      // Store notification for offline user
      db.prepare('INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)')
        .run(receiverId, 'friend_request_received', JSON.stringify({ from: sender }));

      return res.json({ message: 'Friend request re-sent', requestId: existing.id });
    }

    const result = db.prepare('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)')
      .run(senderId, receiverId);

    const sender = db.prepare('SELECT id, username FROM users WHERE id = ?').get(senderId);

    // Store notification for offline user
    db.prepare('INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)')
      .run(receiverId, 'friend_request_received', JSON.stringify({ from: sender, requestId: result.lastInsertRowid }));

    res.status(201).json({ message: 'Friend request sent', requestId: result.lastInsertRowid });
  } catch (err) {
    console.error('Send request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Respond to friend request
router.post('/respond', authenticateToken, (req, res) => {
  try {
    const { requestId, action } = req.body;
    const userId = req.user.id;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or reject' });
    }

    const request = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = ?')
      .get(requestId, userId, 'pending');

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run(newStatus, requestId);

    if (action === 'accept') {
      // Create friendship (lower id always first for consistency)
      const user1 = Math.min(request.sender_id, request.receiver_id);
      const user2 = Math.max(request.sender_id, request.receiver_id);
      db.prepare('INSERT OR IGNORE INTO friends (user1_id, user2_id) VALUES (?, ?)').run(user1, user2);

      const acceptor = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);

      // Store notification for sender
      db.prepare('INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)')
        .run(request.sender_id, 'friend_request_accepted', JSON.stringify({ from: acceptor }));
    }

    res.json({ message: `Friend request ${newStatus}` });
  } catch (err) {
    console.error('Respond error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get pending friend requests (received)
router.get('/', authenticateToken, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT fr.id, fr.sender_id, fr.status, fr.created_at,
             u.username as sender_username
      FROM friend_requests fr
      JOIN users u ON u.id = fr.sender_id
      WHERE fr.receiver_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(req.user.id);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get sent friend requests
router.get('/sent', authenticateToken, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT fr.id, fr.receiver_id, fr.status, fr.created_at,
             u.username as receiver_username
      FROM friend_requests fr
      JOIN users u ON u.id = fr.receiver_id
      WHERE fr.sender_id = ?
      ORDER BY fr.created_at DESC
    `).all(req.user.id);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
