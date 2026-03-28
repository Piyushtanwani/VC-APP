require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRequestRoutes = require('./routes/friendRequests');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const callRoutes = require('./routes/calls');
const { setupSocket } = require('./socket');
const { initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// Initialization and Routes
initDB().then(() => {
  // Routes
  app.use('/auth', authRoutes);
  app.use('/users', userRoutes);
  app.use('/friend-request', friendRequestRoutes);
  app.use('/friends', friendRoutes);
  app.use('/messages', messageRoutes);
  app.use('/calls', callRoutes);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve frontend in production (Docker)
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../frontend/dist')));
    app.get(/(.*)/, (req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    });
  }

  // Setup Socket.io
  setupSocket(io);

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});
