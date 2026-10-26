const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { sign, authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

// 注册
router.post('/register', (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)'
  ).run(username, hash, nickname || username);
  const user = db.prepare('SELECT id, username, nickname, is_admin FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = sign(user);
  res.json({ token, user });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = sign(user);
  res.json({
    token,
    user: {
      id: user.id, username: user.username, nickname: user.nickname, is_admin: user.is_admin,
      card_counter_enabled: user.card_counter_enabled,
      sound_enabled: user.sound_enabled, music_enabled: user.music_enabled
    }
  });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, nickname, is_admin, card_counter_enabled, sound_enabled, music_enabled, wins, losses FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json({ user });
});

// 更新自身偏好
router.put('/me/prefs', authMiddleware, (req, res) => {
  const { card_counter_enabled, sound_enabled, music_enabled } = req.body;
  db.prepare(
    'UPDATE users SET card_counter_enabled = ?, sound_enabled = ?, music_enabled = ? WHERE id = ?'
  ).run(card_counter_enabled ? 1 : 0, sound_enabled ? 1 : 0, music_enabled ? 1 : 0, req.user.id);
  res.json({ ok: true });
});

// ============ 管理员接口 ============

// 用户列表
router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, nickname, is_admin, card_counter_enabled, sound_enabled, music_enabled, wins, losses, created_at FROM users ORDER BY id'
  ).all();
  res.json({ users });
});

// 更新用户（管理员设置记牌器、声音等）
router.put('/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { card_counter_enabled, sound_enabled, music_enabled, is_admin, nickname } = req.body;
  const id = parseInt(req.params.id);
  db.prepare(`
    UPDATE users SET
      card_counter_enabled = COALESCE(?, card_counter_enabled),
      sound_enabled = COALESCE(?, sound_enabled),
      music_enabled = COALESCE(?, music_enabled),
      is_admin = COALESCE(?, is_admin),
      nickname = COALESCE(?, nickname)
    WHERE id = ?
  `).run(
    card_counter_enabled === undefined ? null : (card_counter_enabled ? 1 : 0),
    sound_enabled === undefined ? null : (sound_enabled ? 1 : 0),
    music_enabled === undefined ? null : (music_enabled ? 1 : 0),
    is_admin === undefined ? null : (is_admin ? 1 : 0),
    nickname || null,
    id
  );
  res.json({ ok: true });
});

// 删除用户
router.delete('/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// 全局设置获取
router.get('/admin/settings', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

// 全局设置更新
router.put('/admin/settings', authMiddleware, adminMiddleware, (req, res) => {
  const settings = req.body || {};
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(settings)) {
    stmt.run(k, String(v));
  }
  res.json({ ok: true });
});

// 公共设置（给前端展示，无需登录）
router.get('/settings/public', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'global_%' OR key LIKE '%volume%'").all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

module.exports = router;
