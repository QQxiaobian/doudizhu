const { verify } = require('./auth');
const db = require('./db');
const {
  createRoom, getRoom, addPlayerToRoom, addAiPlayer, removePlayerFromRoom, kickPlayer,
  startGame, handleBid, handlePlay, handlePass, aiBid, aiDecidePlay
} = require('./room');
const { getPlayType } = require('./game/doudizhu');
const { onlineUsers } = require('./routes');

function initSockets(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = verify(token);
    if (!payload) return next(new Error('未授权'));
    const user = db.prepare('SELECT id, username, nickname, is_admin, card_counter_enabled, sound_enabled, music_enabled, beans FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('用户不存在'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // 记录在线
    onlineUsers.set(user.id, { id: user.id, username: user.username, nickname: user.nickname || user.username });
    broadcastOnline(io);
    broadcastRoomList(io);

    // 获取用户偏好（记牌器、声音）
    socket.emit('prefs', {
      card_counter_enabled: !!user.card_counter_enabled,
      sound_enabled: !!user.sound_enabled,
      music_enabled: !!user.music_enabled
    });
    socket.emit('beans', { beans: user.beans });

    socket.on('createRoom', ({ mode }, cb) => {
      mode = (mode === 'ai' || mode === 'friend') ? mode : 'mixed';
      const room = createRoom(user, { mode });
      const dbUser = db.prepare('SELECT beans FROM users WHERE id = ?').get(user.id);
      addPlayerToRoom(room, {
        id: user.id, username: user.username,
        nickname: user.nickname || user.username, isAI: false,
        beans: dbUser?.beans || 0
      });
      socket.join(room.id);
      socket.data.roomId = room.id;
      cb({ ok: true, room: roomInfo(room) });
      broadcastRoomList(io);

      // AI 模式自动填充两个 AI 并开始
      if (mode === 'ai') {
        for (let i = 0; i < 2; i++) addAiPlayer(room);
        io.to(room.id).emit('roomUpdate', roomInfo(room));
        startGame(room);
        broadcastGameState(io, room);
        scheduleAiBid(io, room);
      }
    });

    // 房主添加AI
    socket.on('addAi', (cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      if (room.ownerId !== user.id) return cb && cb({ ok: false, error: '只有房主能添加AI' });
      if (room.state !== 'waiting') return cb && cb({ ok: false, error: '游戏已开始' });
      if (room.players.length >= 3) return cb && cb({ ok: false, error: '房间已满' });
      addAiPlayer(room);
      io.to(room.id).emit('roomUpdate', roomInfo(room));
      cb && cb({ ok: true });
    });

    // 房主踢人
    socket.on('kickPlayer', ({ targetId }, cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      const result = kickPlayer(room, targetId, user.id);
      if (!result.ok) return cb && cb(result);
      // 通知被踢者
      const targetSockets = io.sockets.sockets;
      for (const [, sock] of targetSockets) {
        if (sock.user && String(sock.user.id) === String(targetId)) {
          sock.emit('kicked');
          sock.leave(room.id);
          if (sock.data.roomId === room.id) sock.data.roomId = null;
        }
      }
      io.to(room.id).emit('roomUpdate', roomInfo(room));
      broadcastRoomList(io);
      cb && cb({ ok: true });
    });

    socket.on('joinRoom', ({ roomId }, cb) => {
      const room = getRoom(roomId);
      if (!room) return cb({ ok: false, error: '房间不存在' });
      if (room.state !== 'waiting') return cb({ ok: false, error: '游戏已开始' });
      if (room.players.some(p => p.id === user.id)) return cb({ ok: false, error: '你已在房间中' });
      const dbUser = db.prepare('SELECT beans FROM users WHERE id = ?').get(user.id);
      const ok = addPlayerToRoom(room, {
        id: user.id, username: user.username,
        nickname: user.nickname || user.username, isAI: false,
        beans: dbUser?.beans || 0
      });
      if (!ok) return cb({ ok: false, error: '房间已满' });
      socket.join(room.id);
      socket.data.roomId = room.id;
      io.to(room.id).emit('roomUpdate', roomInfo(room));
      broadcastRoomList(io);
      cb({ ok: true, room: roomInfo(room) });
    });

    socket.on('leaveRoom', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = getRoom(roomId);
      if (room) {
        removePlayerFromRoom(room, user.id);
        socket.leave(roomId);
        if (room.players.length === 0) {
          require('./room').removeRoom(roomId);
        } else {
          io.to(room.id).emit('roomUpdate', roomInfo(room));
        }
        broadcastRoomList(io);
      }
      socket.data.roomId = null;
    });

    socket.on('startGame', (cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      if (room.ownerId !== user.id) return cb && cb({ ok: false, error: '只有房主能开始' });
      if (room.players.length < 3) return cb && cb({ ok: false, error: '需要3人才能开始' });
      startGame(room);
      io.to(room.id).emit('roomUpdate', roomInfo(room));
      broadcastGameState(io, room);
      scheduleAiBid(io, room);
      cb && cb({ ok: true });
    });

    socket.on('bid', ({ bid }, cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      const player = room.players.find(p => p.id === user.id);
      if (!player || player.seat !== room.currentBidder) return cb && cb({ ok: false, error: '不是你叫分' });
      const result = handleBid(room, player.seat, bid);
      io.to(room.id).emit('bidUpdate', {
        seat: player.seat,
        bid,
        currentBidder: room.currentBidder,
        bidHistory: room.bidHistory
      });
      broadcastGameState(io, room);
      if (result === 'restart') {
        // 都不叫，重新发牌
        setTimeout(() => {
          startGame(room);
          broadcastGameState(io, room);
          scheduleAiBid(io, room);
        }, 1500);
      } else if (result === true) {
        // 叫分结束
        broadcastGameState(io, room);
        scheduleAiTurn(io, room);
      } else {
        // 继续叫分
        scheduleAiBid(io, room);
      }
      cb && cb({ ok: true });
    });

    socket.on('play', ({ cards }, cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      const player = room.players.find(p => p.id === user.id);
      if (!player) return cb && cb({ ok: false, error: '你不在游戏中' });
      const result = handlePlay(room, player.seat, cards);
      if (!result.ok) return cb && cb({ ok: false, error: result.error });
      io.to(room.id).emit('playUpdate', {
        seat: player.seat,
        cards,
        type: getPlayType(cards),
        passCount: room.passCount
      });
      broadcastGameState(io, room);
      if (result.ended) {
        endGame(io, room);
      } else {
        scheduleAiTurn(io, room);
      }
      cb && cb({ ok: true });
    });

    socket.on('pass', (cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      const player = room.players.find(p => p.id === user.id);
      if (!player) return cb && cb({ ok: false, error: '你不在游戏中' });
      const result = handlePass(room, player.seat);
      if (!result.ok) return cb && cb({ ok: false, error: result.error });
      io.to(room.id).emit('passUpdate', { seat: player.seat, passCount: room.passCount, currentTurn: room.currentTurn });
      broadcastGameState(io, room);
      scheduleAiTurn(io, room);
      cb && cb({ ok: true });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(user.id);
      broadcastOnline(io);
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = getRoom(roomId);
      if (room) {
        removePlayerFromRoom(room, user.id);
        if (room.players.length === 0) {
          require('./room').removeRoom(roomId);
        } else {
          io.to(room.id).emit('roomUpdate', roomInfo(room));
        }
        broadcastRoomList(io);
      }
    });
  });
}

// 广播在线玩家
function broadcastOnline(io) {
  const list = Array.from(onlineUsers.values());
  io.emit('onlineUpdate', { count: list.length, players: list });
}

// 广播房间列表（显示所有房间，含游戏中）
function broadcastRoomList(io) {
  const list = [];
  for (const room of require('./room').rooms.values()) {
    list.push({
      id: room.id,
      ownerName: room.players.find(p => p.id === room.ownerId)?.nickname || '未知',
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      hasAI: room.players.some(p => p.isAI),
      state: room.state
    });
  }
  io.emit('roomList', { rooms: list });
}

function roomInfo(room) {
  return {
    id: room.id,
    mode: room.mode,
    state: room.state,
    ownerId: room.ownerId,
    baseBet: room.baseBet,
    players: room.players.map(p => ({
      id: p.id,
      username: p.username,
      nickname: p.nickname,
      seat: p.seat,
      isAI: p.isAI,
      isLandlord: p.isLandlord,
      handCount: p.hand?.length || 0,
      beans: p.beans || 0
    })),
    bottomCards: room.state === 'playing' || room.state === 'ended' ? room.bottomCards : [],
    multiplier: room.multiplier,
    winner: room.winner
  };
}

function broadcastGameState(io, room) {
  // 给每个玩家发送自己的手牌，其他人只发数量
  for (const p of room.players) {
    if (p.isAI) continue;
    const playerSockets = io.sockets.sockets;
    for (const [, sock] of playerSockets) {
      if (sock.user && sock.user.id === p.id) {
        sock.emit('gameState', {
          ...roomInfo(room),
          myHand: p.hand,
          mySeat: p.seat,
          currentTurn: room.currentTurn,
          currentBidder: room.currentBidder,
          bidHistory: room.bidHistory,
          lastPlay: room.lastPlay,
          landlordSeat: room.landlordSeat,
          passCount: room.passCount
        });
      }
    }
  }
}

function scheduleAiBid(io, room) {
  if (room.state !== 'bidding') return;
  const bidder = room.players[room.currentBidder];
  if (!bidder || !bidder.isAI) return;
  setTimeout(() => {
    try {
      const bid = aiBid(bidder.hand);
      const result = handleBid(room, bidder.seat, bid);
      io.to(room.id).emit('bidUpdate', {
        seat: bidder.seat,
        bid,
        currentBidder: room.currentBidder,
        bidHistory: room.bidHistory
      });
      broadcastGameState(io, room);
      if (result === 'restart') {
        setTimeout(() => {
          startGame(room);
          broadcastGameState(io, room);
          scheduleAiBid(io, room);
        }, 1500);
      } else if (result === true) {
        broadcastGameState(io, room);
        scheduleAiTurn(io, room);
      } else {
        scheduleAiBid(io, room);
      }
    } catch (e) {
      console.error('[scheduleAiBid] error:', e);
    }
  }, 800);
}

function scheduleAiTurn(io, room) {
  if (room.state !== 'playing') return;
  const player = room.players[room.currentTurn];
  if (!player || !player.isAI) return;
  setTimeout(() => {
    const play = aiDecidePlay(room, player.seat);
    if (play && play.length > 0) {
      const result = handlePlay(room, player.seat, play);
      if (result.ok) {
        io.to(room.id).emit('playUpdate', {
          seat: player.seat,
          cards: play,
          type: getPlayType(play),
          passCount: room.passCount
        });
        broadcastGameState(io, room);
        if (result.ended) {
          endGame(io, room);
          return;
        }
      }
    } else {
      const result = handlePass(room, player.seat);
      if (result.ok) {
        io.to(room.id).emit('passUpdate', { seat: player.seat, passCount: room.passCount, currentTurn: room.currentTurn });
        broadcastGameState(io, room);
      }
    }
    scheduleAiTurn(io, room);
  }, 1000);
}

function endGame(io, room) {
  const baseBet = room.baseBet || 100;
  const amount = baseBet * room.multiplier;
  const results = {}; // playerId -> delta

  for (const p of room.players) {
    const won = (p.isLandlord && room.winner === 'landlord') || (!p.isLandlord && room.winner === 'farmer');
    // 地主赢：+2*amount；农民赢：+amount
    const delta = won ? (p.isLandlord ? 2 * amount : amount) : (p.isLandlord ? -2 * amount : -amount);
    results[p.id] = delta;
    p.beans = Math.max(0, (p.beans || 0) + delta);

    if (p.isAI) continue;

    // 更新战绩与欢乐豆
    if (won) {
      db.prepare('UPDATE users SET wins = wins + 1, beans = MAX(0, beans + ?) WHERE id = ?').run(delta, p.id);
    } else {
      db.prepare('UPDATE users SET losses = losses + 1, beans = MAX(0, beans + ?) WHERE id = ?').run(delta, p.id);
    }
    // 推送最新欢乐豆给该玩家
    const u = db.prepare('SELECT beans FROM users WHERE id = ?').get(p.id);
    const playerSockets = io.sockets.sockets;
    for (const [, sock] of playerSockets) {
      if (sock.user && sock.user.id === p.id) {
        sock.emit('beans', { beans: u.beans });
      }
    }
  }

  io.to(room.id).emit('gameEnd', {
    winner: room.winner,
    multiplier: room.multiplier,
    baseBet,
    results,
    players: room.players.map(p => ({
      id: p.id, nickname: p.nickname, isLandlord: p.isLandlord, handCount: p.hand.length,
      beans: p.beans, delta: results[p.id]
    }))
  });
}

module.exports = { initSockets };
