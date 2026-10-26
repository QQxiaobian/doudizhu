const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'doudizhu.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT,
    is_admin INTEGER DEFAULT 0,
    card_counter_enabled INTEGER DEFAULT 1,
    sound_enabled INTEGER DEFAULT 1,
    music_enabled INTEGER DEFAULT 1,
    beans INTEGER DEFAULT 1000,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// 兼容旧库：补充 beans 字段
const cols = db.prepare("PRAGMA table_info(users)").all();
if (!cols.find(c => c.name === 'beans')) {
  db.exec('ALTER TABLE users ADD COLUMN beans INTEGER DEFAULT 1000');
  db.prepare('UPDATE users SET beans = 1000 WHERE beans IS NULL').run();
}

// 默认管理员账号 admin / admin123
const bcrypt = require('bcryptjs');
const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    'INSERT INTO users (username, password, nickname, is_admin) VALUES (?, ?, ?, 1)'
  ).run('admin', hash, '管理员');
}

// 默认全局设置
const defaultSettings = {
  global_sound_enabled: '1',
  global_music_enabled: '1',
  global_card_counter: '1',
  music_volume: '0.3',
  sound_volume: '0.6'
};
for (const [k, v] of Object.entries(defaultSettings)) {
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(k);
  if (!exists) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }
}

module.exports = db;
