const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    fcm_token TEXT,
    online_status INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    UNIQUE(sender_id, receiver_id)
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id),
    UNIQUE(user1_id, user2_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS call_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'rejected', 'missed')),
    duration INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (caller_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS otp_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('registration', 'password_reset')),
    expires_at DATETIME NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Automated Migration: Add fcm_token column if missing
try {
  const tableInfo = db.prepare('PRAGMA table_info(users)').all();
  const hasFcmToken = tableInfo.some(col => col.name === 'fcm_token');
  if (!hasFcmToken) {
    db.prepare('ALTER TABLE users ADD COLUMN fcm_token TEXT').run();
    console.log('✅ Added fcm_token column to users table');
  }

  // Migration: Remove UNIQUE constraint from email if it exists
  // We check the table schema by creating a dummy table and comparing
  // Or more simply, just check if the UNIQUE constraint is there in the DDL
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
  if (/email TEXT\s+UNIQUE/i.test(schema) || schema.includes('email TEXT UNIQUE')) {
    console.log('🔄 Migrating users table to remove UNIQUE(email)...');
    try {
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        // 1. Create new table
        db.prepare(`
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            fcm_token TEXT,
            online_status INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          )
        `).run();
        
        // 2. Copy data
        db.prepare('INSERT INTO users_new SELECT * FROM users').run();
        
        // 3. Drop old table
        db.prepare('DROP TABLE users').run();
        
        // 4. Rename new table
        db.prepare('ALTER TABLE users_new RENAME TO users').run();
      })();
      db.pragma('foreign_keys = ON');
      console.log('✅ Migration complete: UNIQUE(email) removed.');
    } catch (err) {
      db.pragma('foreign_keys = ON');
      throw err;
    }
  }
} catch (err) {
  console.error('Migration error:', err.message);
}

module.exports = db;
