const { verify } = require('./auth');
const db = require('./db');
const {
  createRoom, getRoom, addPlayerToRoom, removePlayerFromRoom,
  startGame, handleBid, handlePlay, handlePass, aiBid, aiDecidePlay
} = require('./room');
const { getPlayType } = require('./game/doudizhu');

function initSockets(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = verify(token);
    if (!payload) return next(new Error('未授权'));
    const user = db.prepare('SELECT id, username, nickname, is_admin, card_counter_enabled, sound_enabled, music_enabled FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('用户不存在'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // 获取用户偏好（记牌器、声音）
    socket.emit('prefs', {
      card_counter_enabled: !!user.card_counter_enabled,
      sound_enabled: !!user.sound_enabled,
      music_enabled: !!user.music_enabled
    });

    socket.on('createRoom', ({ mode }, cb) => {
      mode = mode === 'ai' ? 'ai' : 'friend';
      const room = createRoom(user, { mode });
      addPlayerToRoom(room, { id: user.id, username: user.username, nickname: user.nickname || user.username, isAI: false });
      socket.join(room.id);
      socket.data.roomId = room.id;
      cb({ ok: true, room: roomInfo(room) });

      // AI 模式自动填充两个 AI
      if (mode === 'ai') {
        for (let i = 0; i < 2; i++) {
          addPlayerToRoom(room, {
            id: `ai-${Date.now()}-${i}`,
            username: `AI-${i + 1}`,
            nickname: `AI 玩家 ${i + 1}`,
            isAI: true
          });
        }
        io.to(room.id).emit('roomUpdate', roomInfo(room));
        // 自动开始
        startGame(room);
        broadcastGameState(io, room);
        // AI 叫分
        scheduleAiBid(io, room);
      }
    });

    socket.on('joinRoom', ({ roomId }, cb) => {
      const room = getRoom(roomId);
      if (!room) return cb({ ok: false, error: '房间不存在' });
      if (room.state !== 'waiting') return cb({ ok: false, error: '游戏已开始' });
      if (room.players.some(p => p.id === user.id)) return cb({ ok: false, error: '你已在房间中' });
      const ok = addPlayerToRoom(room, { id: user.id, username: user.username, nickname: user.nickname || user.username, isAI: false });
      if (!ok) return cb({ ok: false, error: '房间已满' });
      socket.join(room.id);
      socket.data.roomId = room.id;
      io.to(room.id).emit('roomUpdate', roomInfo(room));
      cb({ ok: true, room: roomInfo(room) });

      // 人满自动开始
      if (room.players.length === 3 && room.mode === 'friend') {
        startGame(room);
        broadcastGameState(io, room);
      }
    });

    socket.on('leaveRoom', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = getRoom(roomId);
      if (room) {
        removePlayerFromRoom(room, user.id);
        socket.leave(roomId);
        if (room.players.length === 0) {
          // 保留房间一会，直接删除
          require('./room').removeRoom(roomId);
        } else {
          io.to(room.id).emit('roomUpdate', roomInfo(room));
        }
      }
      socket.data.roomId = null;
    });

    socket.on('startGame', (cb) => {
      const room = getRoom(socket.data.roomId);
      if (!room) return cb && cb({ ok: false, error: '不在房间中' });
      if (room.ownerId !== user.id) return cb && cb({ ok: false, error: '只有房主能开始' });
      if (room.players.length < 3) return cb && cb({ ok: false, error: '需要3人才能开始' });
      startGame(room);
      broadcastGameState(io, room);
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
      }
    });
  });
}

function roomInfo(room) {
  return {
    id: room.id,
    mode: room.mode,
    state: room.state,
    ownerId: room.ownerId,
    players: room.players.map(p => ({
      id: p.id,
      username: p.username,
      nickname: p.nickname,
      seat: p.seat,
      isAI: p.isAI,
      isLandlord: p.isLandlord,
      handCount: p.hand?.length || 0
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
  // 更新战绩
  for (const p of room.players) {
    if (p.isAI) continue;
    const won = (p.isLandlord && room.winner === 'landlord') || (!p.isLandlord && room.winner === 'farmer');
    if (won) {
      db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').run(p.id);
    } else {
      db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(p.id);
    }
  }
  io.to(room.id).emit('gameEnd', {
    winner: room.winner,
    multiplier: room.multiplier,
    players: room.players.map(p => ({
      id: p.id, nickname: p.nickname, isLandlord: p.isLandlord, handCount: p.hand.length
    }))
  });
}

module.exports = { initSockets };
