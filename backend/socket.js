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

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    const username = socket.user.username;
    console.log(`✅ ${username} connected (socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      await db.query('UPDATE users SET online_status = 1 WHERE id = $1', [userId]);
      // Notify friends that user is online
      broadcastOnlineStatus(io, userId, true);
    }
    onlineUsers.get(userId).add(socket.id);

    // Initial Sync
    sendInitialFriendsStatus(socket, userId);

    // Send any pending notifications
    try {
      const notifRes = await db.query(
        'SELECT * FROM notifications WHERE user_id = $1 AND read = 0 ORDER BY created_at DESC',
        [userId]
      );
      if (notifRes.rows.length > 0) {
        socket.emit('pending_notifications', notifRes.rows.map(n => ({
          ...n,
          data: JSON.parse(n.data)
        })));
        await db.query('UPDATE notifications SET read = 1 WHERE user_id = $1', [userId]);
      }
    } catch (err) {
      console.error('Error fetching pending notifications:', err);
    }

    // ===== FRIEND REQUEST EVENTS =====
    socket.on('send_friend_request', async (data) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(Array.from(receiverSocketId)).emit('friend_request_received', {
          from: { id: userId, username },
          requestId: data.requestId
        });
      } else {
        const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [data.receiverId]);
        const receiver = userRes.rows[0];
        if (receiver && receiver.fcm_token) {
          sendPushNotification(receiver.fcm_token, {
            title: 'New Friend Request',
            body: `${username} sent you a friend request!`,
            data: { type: 'friend_request', senderId: userId.toString() }
          });
        }
      }
    });

    socket.on('respond_friend_request', async (data) => {
      if (data.action === 'accept') {
        const senderSocketId = onlineUsers.get(data.senderId);
        if (senderSocketId) {
          io.to(Array.from(senderSocketId)).emit('friend_request_accepted', {
            from: { id: userId, username }
          });
        }
        
        const senderRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [data.senderId]);
        const sender = senderRes.rows[0];
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
    socket.on('send_message', async (data) => {
      const { receiverId, message } = data;

      try {
        const friendRes = await db.query(`
          SELECT id FROM friends
          WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
        `, [userId, receiverId]);

        if (friendRes.rows.length === 0) {
          socket.emit('error_message', { error: 'You can only message friends' });
          return;
        }

        const insertRes = await db.query(
          'INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3) RETURNING id, created_at',
          [userId, receiverId, message]
        );

        const msgData = {
          id: insertRes.rows[0].id,
          sender_id: userId,
          receiver_id: receiverId,
          message,
          is_read: 0,
          sender_username: username,
          created_at: insertRes.rows[0].created_at
        };

        const receiverSockets = onlineUsers.get(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          receiverSockets.forEach(sId => {
            io.to(sId).emit('receive_message', msgData);
          });
        }

        const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [receiverId]);
        const receiver = userRes.rows[0];
        if (receiver && receiver.fcm_token) {
          sendPushNotification(receiver.fcm_token, {
            title: `New message from ${username}`,
            body: message.length > 50 ? message.substring(0, 47) + '...' : message,
            data: { type: 'chat_message', senderId: userId.toString() }
          });
        }

        socket.emit('message_sent', msgData);
      } catch (err) {
        console.error('Error sending message:', err);
      }
    });

    socket.on('mark_read', async (data) => {
      const { messageIds, senderId } = data;
      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      try {
        await db.query(
          'UPDATE messages SET is_read = 1 WHERE id = ANY($1) AND receiver_id = $2',
          [messageIds, userId]
        );

        const senderSockets = onlineUsers.get(senderId);
        if (senderSockets) {
          senderSockets.forEach(sId => {
            io.to(sId).emit('messages_read', {
              readerId: userId,
              messageIds
            });
          });
        }
      } catch (err) {
        console.error('Error marking messages read:', err);
      }
    });

    // ===== VIDEO CALL EVENTS =====
    socket.on('call_user', async (data) => {
      const { targetId } = data;

      const friendRes = await db.query(`
        SELECT id FROM friends
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      `, [userId, targetId]);

      if (friendRes.rows.length === 0) {
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

      const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [targetId]);
      const receiver = userRes.rows[0];
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
        activeCalls.set(data.callerId, { startTime: Date.now(), receiverId: userId });
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_accepted', {
            from: { id: userId, username },
            signal: data.signal
          });
        });
      }
    });

    socket.on('reject_call', async (data) => {
      const callerSockets = onlineUsers.get(data.callerId);
      await db.query(
        'INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES ($1, $2, $3, $4)',
        [data.callerId, userId, 'rejected', 0]
      );
      activeCalls.delete(data.callerId);

      if (callerSockets) {
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_rejected', { from: { id: userId, username } });
        });
      }
    });

    socket.on('end_call', async (data) => {
      const targetSockets = onlineUsers.get(data.targetId);
      let callInfo = activeCalls.get(userId) || activeCalls.get(data.targetId);
      let callerId = activeCalls.has(userId) ? userId : data.targetId;
      let receiverId = activeCalls.has(userId) ? data.targetId : userId;

      if (callInfo) {
        const duration = callInfo.startTime ? Math.floor((Date.now() - callInfo.startTime) / 1000) : 0;
        await db.query(
          'INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES ($1, $2, $3, $4)',
          [callerId, receiverId, callInfo.startTime ? 'completed' : 'missed', duration]
        );
        activeCalls.delete(callerId);
      }

      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('call_ended', { from: { id: userId, username } });
        });
      }
    });

    socket.on('ice_candidate', (data) => {
      const targetSockets = onlineUsers.get(data.targetId);
      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('ice_candidate', { from: userId, candidate: data.candidate });
        });
      }
    });

    socket.on('disconnect', async () => {
      console.log(`❌ ${username} disconnected`);
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await db.query('UPDATE users SET online_status = 0 WHERE id = $1', [userId]);
          broadcastOnlineStatus(io, userId, false);
        }
      }
    });
  });
}

async function broadcastOnlineStatus(io, userId, isOnline) {
  const friendsRes = await db.query(`
    SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = $1 OR user2_id = $1
  `, [userId]);

  friendsRes.rows.forEach(f => {
    const friendSockets = onlineUsers.get(f.friend_id);
    if (friendSockets) {
      friendSockets.forEach(sId => {
        io.to(sId).emit('user_status_changed', { userId, isOnline });
      });
    }
  });
}

async function sendInitialFriendsStatus(socket, userId) {
  const friendsRes = await db.query(`
    SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = $1 OR user2_id = $1
  `, [userId]);

  const statusList = friendsRes.rows.map(f => ({
    userId: f.friend_id,
    isOnline: onlineUsers.has(f.friend_id) && onlineUsers.get(f.friend_id).size > 0
  }));

  if (statusList.length > 0) {
    socket.emit('initial_friends_status', statusList);
  }
}

module.exports = { setupSocket, onlineUsers };
