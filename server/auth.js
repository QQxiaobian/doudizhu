const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'doudizhu-dev-secret';

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Express 中间件：校验 token
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'token 无效或已过期' });
  req.user = payload;
  next();
}

// 管理员中间件
function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = { sign, verify, authMiddleware, adminMiddleware };
