const jwt = require('jsonwebtoken');
const db = require('./db');
const { sendPushNotification } = require('./utils/fcm');

// Map userId -> socketId
// Map userId -> Set(socketIds)
const onlineUsers = new Map();
// Map callerId -> { startTime, receiverId }
const activeCalls = new Map();

function setupSocket(io) {
  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const username = socket.user.username;
    console.log(`✅ ${username} connected (socket: ${socket.id})`);

    // Track online status
    // Track online status with multiple sockets support
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      db.prepare('UPDATE users SET online_status = 1 WHERE id = ?').run(userId);
      // Notify friends that user is online (only if first connection)
      broadcastOnlineStatus(io, userId, true);
    }
    onlineUsers.get(userId).add(socket.id);

    // Initial Sync: Send the user the status of all their friends
    sendInitialFriendsStatus(socket, userId);

    // Send any pending notifications
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC').all(userId);
    if (notifications.length > 0) {
      socket.emit('pending_notifications', notifications.map(n => ({
        ...n,
        data: JSON.parse(n.data)
      })));
      db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
    }

    // ===== FRIEND REQUEST EVENTS =====
    socket.on('send_friend_request', (data) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('friend_request_received', {
          from: { id: userId, username },
          requestId: data.requestId
        });
      } else {
        // Send push notification if receiver is offline
        const receiver = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(data.receiverId);
        if (receiver && receiver.fcm_token) {
          sendPushNotification(receiver.fcm_token, {
            title: 'New Friend Request',
            body: `${username} sent you a friend request!`,
            data: { type: 'friend_request', senderId: userId.toString() }
          });
        }
      }
    });

    socket.on('respond_friend_request', (data) => {
      if (data.action === 'accept') {
        const senderSocketId = onlineUsers.get(data.senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('friend_request_accepted', {
            from: { id: userId, username }
          });
        }
        
        // Send push notification for accepted request
        const sender = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(data.senderId);
        if (sender && sender.fcm_token) {
          sendPushNotification(sender.fcm_token, {
            title: 'Friend Request Accepted',
            body: `${username} accepted your friend request!`,
            data: { type: 'friend_request_accepted', fromId: userId.toString() }
          });
        }
      }
    });

    // ===== CHAT EVENTS =====
    socket.on('send_message', (data) => {
      const { receiverId, message } = data;

      // Verify friendship
      const friendship = db.prepare(`
        SELECT id FROM friends
        WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
      `).get(userId, receiverId, receiverId, userId);

      if (!friendship) {
        socket.emit('error_message', { error: 'You can only message friends' });
        return;
      }

      // Store message
      const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)')
        .run(userId, receiverId, message);

      const msgData = {
        id: result.lastInsertRowid,
        sender_id: userId,
        receiver_id: receiverId,
        message,
        is_read: 0,
        sender_username: username,
        created_at: new Date().toISOString()
      };

      // Send to receiver if online (directly via sockets)
      const receiverSockets = onlineUsers.get(receiverId);
      if (receiverSockets && receiverSockets.size > 0) {
        receiverSockets.forEach(sId => {
          io.to(sId).emit('receive_message', msgData);
        });
      }

      // ALWAYS send push notification (handles cases where app is in background/minimized)
      const receiver = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(receiverId);
      if (receiver && receiver.fcm_token) {
        sendPushNotification(receiver.fcm_token, {
          title: `New message from ${username}`,
          body: message.length > 50 ? message.substring(0, 47) + '...' : message,
          data: { type: 'chat_message', senderId: userId.toString() }
        });
      }

      // Confirm to sender
      socket.emit('message_sent', msgData);
    });

    socket.on('mark_read', (data) => {
      const { messageIds, senderId } = data;
      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      // Update database
      const placeholders = messageIds.map(() => '?').join(',');
      db.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${placeholders}) AND receiver_id = ?`).run(...messageIds, userId);

      // Notify the sender that their messages were read
      const senderSockets = onlineUsers.get(senderId);
      if (senderSockets) {
        senderSockets.forEach(sId => {
          io.to(sId).emit('messages_read', {
            readerId: userId,
            messageIds
          });
        });
      }
    });

    // ===== VIDEO CALL EVENTS =====
    socket.on('call_user', (data) => {
      const { targetId } = data;

      // Verify friendship
      const friendship = db.prepare(`
        SELECT id FROM friends
        WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
      `).get(userId, targetId, targetId, userId);

      if (!friendship) {
        socket.emit('call_error', { error: 'You can only call friends' });
        return;
      }

      const targetSockets = onlineUsers.get(targetId);
      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('incoming_call', {
            from: { id: userId, username },
            signal: data.signal
          });
        });
      }

      // Also send push notification (always for calls, in case app is minimized)
      const receiver = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(targetId);
      if (receiver && receiver.fcm_token) {
        sendPushNotification(receiver.fcm_token, {
          title: 'Incoming Video Call',
          body: `${username} is calling you...`,
          data: { type: 'video_call', callerId: userId.toString() }
        }, 'calls');
      }
    });

    socket.on('accept_call', (data) => {
      const callerSockets = onlineUsers.get(data.callerId);
      if (callerSockets) {
        // Update tracking to started
        activeCalls.set(data.callerId, { startTime: Date.now(), receiverId: userId });
        
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_accepted', {
            from: { id: userId, username },
            signal: data.signal
          });
        });
      }
    });

    socket.on('reject_call', (data) => {
      const callerSockets = onlineUsers.get(data.callerId);
      
      // Log rejected call
      db.prepare('INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES (?, ?, ?, ?)')
        .run(data.callerId, userId, 'rejected', 0);
      
      // Remove from active tracking
      activeCalls.delete(data.callerId);

      if (callerSockets) {
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_rejected', {
            from: { id: userId, username }
          });
        });
      }
    });

    socket.on('end_call', (data) => {
      const targetSockets = onlineUsers.get(data.targetId);
      
      // Handle call history recording
      // The call could have been started by either side, but we track by callerId
      let callInfo = activeCalls.get(userId); // If we were the caller
      let callerId = userId;
      let receiverId = data.targetId;

      if (!callInfo) {
        callInfo = activeCalls.get(data.targetId); // If they were the caller
        callerId = data.targetId;
        receiverId = userId;
      }

      if (callInfo) {
        if (callInfo.startTime) {
          const duration = Math.floor((Date.now() - callInfo.startTime) / 1000);
          db.prepare('INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES (?, ?, ?, ?)')
            .run(callerId, receiverId, 'completed', duration);
        } else {
          // If no startTime, it was never accepted -> missed
          db.prepare('INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES (?, ?, ?, ?)')
            .run(callerId, receiverId, 'missed', 0);
        }
        activeCalls.delete(callerId);
      }

      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('call_ended', {
            from: { id: userId, username }
          });
        });
      }
    });

    // WebRTC ICE candidates
    socket.on('ice_candidate', (data) => {
      const targetSockets = onlineUsers.get(data.targetId);
      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('ice_candidate', {
            from: userId,
            candidate: data.candidate
          });
        });
      }
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', () => {
      console.log(`❌ ${username} disconnected`);
      
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          db.prepare('UPDATE users SET online_status = 0 WHERE id = ?').run(userId);
          broadcastOnlineStatus(io, userId, false);
        }
      }
    });
  });
}

function broadcastOnlineStatus(io, userId, isOnline) {
  // Get all friends and notify them
  const friends = db.prepare(`
    SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = ? OR user2_id = ?
  `).all(userId, userId, userId);

  friends.forEach(f => {
    const friendSockets = onlineUsers.get(f.friend_id);
    if (friendSockets) {
      friendSockets.forEach(sId => {
        io.to(sId).emit('user_status_changed', { userId, isOnline });
      });
    }
  });
}

function sendInitialFriendsStatus(socket, userId) {
  // Get all friends and their current online status
  const friends = db.prepare(`
    SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = ? OR user2_id = ?
  `).all(userId, userId, userId);

  const statusList = friends.map(f => {
    return {
      userId: f.friend_id,
      isOnline: onlineUsers.has(f.friend_id) && onlineUsers.get(f.friend_id).size > 0
    };
  });

  if (statusList.length > 0) {
    socket.emit('initial_friends_status', statusList);
  }
}

module.exports = { setupSocket, onlineUsers };
