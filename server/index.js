const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { router: routes } = require('./routes');
const { initSockets } = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use('/api', routes);

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// 单页路由回退
app.get(['/', '/game', '/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

initSockets(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`斗地主服务已启动: http://localhost:${PORT}`);
  console.log(`默认管理员账号: admin / admin123`);
});
