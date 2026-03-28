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
    const userId = Number(socket.user.id);
    const username = socket.user.username;
    console.log(`✅ ${username} connected (ID: ${userId}, Socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      try {
        await db.query('UPDATE users SET online_status = 1 WHERE id = $1', [userId]);
        console.log(`🌐 User ${username} marked online in DB`);
        broadcastOnlineStatus(io, userId, true);
      } catch (err) {
        console.error(`❌ DB error marking user online:`, err);
      }
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
        console.log(`🔔 Sending ${notifRes.rows.length} pending notifications to ${username}`);
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
      const targetId = Number(data.receiverId);
      console.log(`📩 ${username} sending friend request to ID: ${targetId}`);
      const receiverSockets = onlineUsers.get(targetId);
      
      if (receiverSockets) {
        io.to(Array.from(receiverSockets)).emit('friend_request_received', {
          from: { id: userId, username },
          requestId: data.requestId
        });
      } else {
        const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [targetId]);
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
      const targetId = Number(data.senderId);
      if (data.action === 'accept') {
        const senderSockets = onlineUsers.get(targetId);
        if (senderSockets) {
          io.to(Array.from(senderSockets)).emit('friend_request_accepted', {
            from: { id: userId, username }
          });
        }
        
        const senderRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [targetId]);
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
      const receiverId = Number(data.receiverId);
      const { message } = data;

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
        } else {
          const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [receiverId]);
          const receiver = userRes.rows[0];
          if (receiver && receiver.fcm_token) {
            sendPushNotification(receiver.fcm_token, {
              title: `New message from ${username}`,
              body: message.length > 50 ? message.substring(0, 47) + '...' : message,
              data: { type: 'chat_message', senderId: userId.toString() }
            }, 'chat-messages');
          }
        }

        socket.emit('message_sent', msgData);
      } catch (err) {
        console.error('Error sending message:', err);
      }
    });

    socket.on('mark_read', async (data) => {
      const { messageIds, senderId } = data;
      const targetId = Number(senderId);
      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      try {
        await db.query(
          'UPDATE messages SET is_read = 1 WHERE id = ANY($1) AND receiver_id = $2',
          [messageIds, userId]
        );

        const senderSockets = onlineUsers.get(targetId);
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
      const targetId = Number(data.targetId);
      console.log(`📞 ${username} calling user ID: ${targetId}`);

      const friendRes = await db.query(`
        SELECT id FROM friends
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      `, [userId, targetId]);

      if (friendRes.rows.length === 0) {
        console.log(`⚠️ User ${username} tried to call ID ${targetId} without friendship`);
        socket.emit('call_error', { error: 'You can only call friends' });
        return;
      }

      const targetSockets = onlineUsers.get(targetId);
      if (targetSockets) {
        console.log(`📱 Routing call to ${targetSockets.size} active sockets for ID: ${targetId}`);
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
        console.log(`🔕 Sending VoIP Wakeup Push to ID: ${targetId}`);
        sendPushNotification(receiver.fcm_token, {
          title: 'Incoming Video Call',
          body: `${username} is calling you...`,
          data: { type: 'video_call', callerId: userId.toString(), isVoip: 'true' }
        }, 'calls');
      }
    });

    socket.on('accept_call', (data) => {
      const callerId = Number(data.callerId);
      const callerSockets = onlineUsers.get(callerId);
      console.log(`✅ ${username} accepted call from ID: ${callerId}`);
      
      if (callerSockets) {
        activeCalls.set(callerId, { startTime: Date.now(), receiverId: userId });
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_accepted', {
            from: { id: userId, username },
            signal: data.signal
          });
        });
      }
    });

    socket.on('reject_call', async (data) => {
      const callerId = Number(data.callerId);
      const callerSockets = onlineUsers.get(callerId);
      console.log(`🚫 ${username} rejected call from ID: ${callerId}`);
      
      await db.query(
        'INSERT INTO call_history (caller_id, receiver_id, status, duration) VALUES ($1, $2, $3, $4)',
        [callerId, userId, 'rejected', 0]
      );
      activeCalls.delete(callerId);

      if (callerSockets) {
        callerSockets.forEach(sId => {
          io.to(sId).emit('call_rejected', { from: { id: userId, username } });
        });
      }
    });

    socket.on('end_call', async (data) => {
      const targetId = Number(data.targetId);
      const targetSockets = onlineUsers.get(targetId);
      console.log(`📵 ${username} ended call session with ID: ${targetId}`);
      
      let callInfo = activeCalls.get(userId) || activeCalls.get(targetId);
      let callerId = activeCalls.has(userId) ? userId : targetId;
      let receiverId = activeCalls.has(userId) ? targetId : userId;

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
      const targetId = Number(data.targetId);
      const targetSockets = onlineUsers.get(targetId);
      if (targetSockets) {
        targetSockets.forEach(sId => {
          io.to(sId).emit('ice_candidate', { from: userId, candidate: data.candidate });
        });
      }
    });

    socket.on('disconnect', async () => {
      console.log(`❌ ${username} disconnected (ID: ${userId})`);
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          try {
            await db.query('UPDATE users SET online_status = 0 WHERE id = $1', [userId]);
            broadcastOnlineStatus(io, userId, false);
          } catch (err) {
            console.error('❌ DB error marking user offline:', err);
          }
        }
      }
    });
  });
}

async function broadcastOnlineStatus(io, userId, isOnline) {
  const normUserId = Number(userId);
  const friendsRes = await db.query(`
    SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = $1 OR user2_id = $1
  `, [normUserId]);

  friendsRes.rows.forEach(f => {
    const friendId = Number(f.friend_id);
    const friendSockets = onlineUsers.get(friendId);
    if (friendSockets) {
      friendSockets.forEach(sId => {
        io.to(sId).emit('user_status_changed', { userId: normUserId, isOnline });
      });
    }
  });
}

async function sendInitialFriendsStatus(socket, userId) {
  const normUserId = Number(userId);
  const friendsRes = await db.query(`
    SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END as friend_id
    FROM friends
    WHERE user1_id = $1 OR user2_id = $1
  `, [normUserId]);

  const statusList = friendsRes.rows.map(f => {
    const friendId = Number(f.friend_id);
    return {
      userId: friendId,
      isOnline: onlineUsers.has(friendId) && onlineUsers.get(friendId).size > 0
    };
  });

  if (statusList.length > 0) {
    socket.emit('initial_friends_status', statusList);
  }
}

module.exports = { setupSocket, onlineUsers };
