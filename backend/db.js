const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Neon and many managed DBs
  }
});

/**
 * Initialize the database tables on startup
 */
const initDB = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Initializing PostgreSQL database tables...');
    
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash TEXT NOT NULL,
        fcm_token TEXT,
        online_status INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Friend requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        receiver_id INTEGER NOT NULL REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sender_id, receiver_id)
      )
    `);

    // Friends mapping
    await client.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user1_id INTEGER NOT NULL REFERENCES users(id),
        user2_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user1_id, user2_id)
      )
    `);

    // Messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        receiver_id INTEGER NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        data TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Call history
    await client.query(`
      CREATE TABLE IF NOT EXISTS call_history (
        id SERIAL PRIMARY KEY,
        caller_id INTEGER NOT NULL REFERENCES users(id),
        receiver_id INTEGER NOT NULL REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'completed' CHECK(status IN ('completed', 'rejected', 'missed')),
        duration INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // OTP verifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        purpose VARCHAR(20) NOT NULL CHECK(purpose IN ('registration', 'password_reset')),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL database initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error initializing database:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDB
};
