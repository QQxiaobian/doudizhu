// 房间与游戏状态管理
const { createDeck, shuffle, getPlayType, canBeat, sortCards } = require('./game/doudizhu');
const { aiPlay } = require('./game/ai');

const rooms = new Map(); // roomId -> room

function createRoom(owner, options = {}) {
  const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = {
    id: roomId,
    mode: options.mode || 'mixed', // mixed | ai | friend
    ownerId: owner.id,
    players: [], // { id, username, nickname, isAI, seat, hand, isLandlord, beans }
    maxPlayers: 3,
    state: 'waiting', // waiting | bidding | playing | ended
    deck: [],
    bottomCards: [],
    currentTurn: 0,
    landlordSeat: -1,
    lastPlay: null, // { cards, seat }
    lastPlayerSeat: -1,
    passCount: 0,
    bids: [], // bidding
    currentBidder: 0,
    bidHistory: [],
    winner: null,
    multiplier: 1,
    baseBet: 100, // 每局基础欢乐豆
    createdAt: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function removeRoom(roomId) {
  rooms.delete(roomId);
}

function addPlayerToRoom(room, player) {
  if (room.players.length >= room.maxPlayers) return false;
  const seat = room.players.length;
  const p = {
    ...player,
    seat,
    hand: [],
    isLandlord: false,
    isAI: player.isAI || false,
    ready: false,
    beans: player.beans || (player.isAI ? 1000 : 0)
  };
  room.players.push(p);
  return true;
}

// 添加AI玩家（房主手动添加）
function addAiPlayer(room) {
  if (room.players.length >= room.maxPlayers) return null;
  const idx = room.players.filter(p => p.isAI).length + 1;
  const ai = {
    id: `ai-${Date.now()}-${idx}`,
    username: `AI-${idx}`,
    nickname: `AI 玩家 ${idx}`,
    isAI: true,
    beans: 1000
  };
  addPlayerToRoom(room, ai);
  return ai;
}

function removePlayerFromRoom(room, playerId) {
  room.players = room.players.filter(p => p.id !== playerId);
}

// 踢人（仅房主）
function kickPlayer(room, targetId, kickerId) {
  if (room.ownerId !== kickerId) return { ok: false, error: '只有房主能踢人' };
  if (room.state !== 'waiting') return { ok: false, error: '游戏进行中不能踢人' };
  const target = room.players.find(p => p.id === targetId);
  if (!target) return { ok: false, error: '玩家不存在' };
  if (target.isAI) return { ok: false, error: 'AI 玩家请用移除AI功能' };
  if (target.id === kickerId) return { ok: false, error: '不能踢自己' };
  removePlayerFromRoom(room, targetId);
  return { ok: true };
}

// 开始游戏：发牌
function startGame(room) {
  const deck = shuffle(createDeck());
  room.bottomCards = deck.slice(51, 54);
  for (let i = 0; i < 3; i++) {
    room.players[i].hand = sortCards(deck.slice(i * 17, (i + 1) * 17));
    room.players[i].isLandlord = false;
    room.players[i].ready = false;
  }
  room.state = 'bidding';
  room.landlordSeat = -1;
  room.lastPlay = null;
  room.lastPlayerSeat = -1;
  room.passCount = 0;
  room.bids = [];
  room.currentBidder = Math.floor(Math.random() * 3);
  room.bidHistory = [];
  room.multiplier = 1;
  room.winner = null;
}

// 叫地主：bid 0=不叫, 1-3=叫分
function handleBid(room, seat, bid) {
  room.bidHistory.push({ seat, bid });
  room.bids.push({ seat, bid });

  const maxBid = Math.max(...room.bids.map(b => b.bid), 0);
  const maxBidder = room.bids.find(b => b.bid === maxBid)?.seat ?? -1;

  if (bid === 3) {
    // 直接当地主
    finishBidding(room, seat, 3);
    return true;
  }

  if (room.bids.length >= 3) {
    if (maxBid > 0) {
      finishBidding(room, maxBidder, maxBid);
    } else {
      // 都不叫，重新发牌
      room.state = 'waiting';
      // 触发重新开始（由调用方处理）
      return 'restart';
    }
    return true;
  }

  room.currentBidder = (room.currentBidder + 1) % 3;
  return false;
}

function finishBidding(room, landlordSeat, bid) {
  room.landlordSeat = landlordSeat;
  room.players[landlordSeat].isLandlord = true;
  // 把底牌给地主
  room.players[landlordSeat].hand = sortCards([...room.players[landlordSeat].hand, ...room.bottomCards]);
  room.multiplier = bid;
  room.state = 'playing';
  room.currentTurn = landlordSeat;
  room.lastPlay = null;
  room.lastPlayerSeat = -1;
  room.passCount = 0;
}

// 出牌
function handlePlay(room, seat, cards) {
  if (room.state !== 'playing') return { ok: false, error: '游戏未开始' };
  if (room.currentTurn !== seat) return { ok: false, error: '不是你的回合' };

  const player = room.players[seat];
  // 校验牌都在手牌中
  const handIds = new Set(player.hand.map(c => c.id));
  for (const c of cards) {
    if (!handIds.has(c.id)) return { ok: false, error: '手牌中没有这些牌' };
  }

  const pt = getPlayType(cards);
  if (!pt) return { ok: false, error: '无效牌型' };

  // 领出或压牌
  if (room.lastPlay && room.lastPlayerSeat !== seat) {
    if (!canBeat(cards, room.lastPlay.cards)) {
      return { ok: false, error: '压不过上家的牌' };
    }
  } else {
    // 领出，无限制
  }

  // 扣牌
  const playedIds = new Set(cards.map(c => c.id));
  player.hand = player.hand.filter(c => !playedIds.has(c.id));
  room.lastPlay = { cards, type: pt, seat };
  room.lastPlayerSeat = seat;
  room.passCount = 0;

  // 炸弹倍数
  if (pt.type === 'bomb') room.multiplier *= 2;
  if (pt.type === 'rocket') room.multiplier *= 2;

  // 胜利判断
  if (player.hand.length === 0) {
    room.state = 'ended';
    room.winner = player.isLandlord ? 'landlord' : 'farmer';
    return { ok: true, played: true, ended: true, winner: room.winner };
  }

  room.currentTurn = (seat + 1) % 3;
  return { ok: true, played: true };
}

// 不要
function handlePass(room, seat) {
  if (room.state !== 'playing') return { ok: false, error: '游戏未开始' };
  if (room.currentTurn !== seat) return { ok: false, error: '不是你的回合' };
  if (!room.lastPlay || room.lastPlayerSeat === seat) {
    return { ok: false, error: '你是领出方，不能不要' };
  }
  room.passCount++;
  room.currentTurn = (seat + 1) % 3;
  // 如果其他两人都不要，最后出牌的人领出
  if (room.passCount >= 2) {
    room.lastPlay = null;
    room.passCount = 0;
  }
  return { ok: true, passed: true };
}

// AI 叫分
function aiBid(hand) {
  // 简单策略：根据大牌数量决定叫分
  const counts = {};
  for (const c of hand) counts[c.value] = (counts[c.value] || 0) + 1;
  let score = 0;
  if (counts[17]) score += 4;
  if (counts[16]) score += 3;
  if (counts[15]) score += counts[15] * 2;
  if (counts[14]) score += counts[14];
  if (Object.values(counts).some(c => c === 4)) score += 6;
  if (score >= 10) return 3;
  if (score >= 7) return 2;
  if (score >= 4) return 1;
  return 0;
}

// AI 出牌决策
function aiDecidePlay(room, seat) {
  const player = room.players[seat];
  const lastPlay = room.lastPlay;
  const lastSeat = room.lastPlayerSeat;

  // 判断 lastPlay 是否来自队友（农民队友）
  let isTeammate = false;
  if (lastPlay && lastSeat !== -1 && !player.isLandlord) {
    const lastPlayer = room.players[lastSeat];
    if (!lastPlayer.isLandlord && lastSeat !== seat) isTeammate = true;
  }
  if (lastPlay && lastSeat !== -1 && player.isLandlord) {
    // 地主没有队友
  }

  // 如果是队友领出且没人压，AI 农民不压队友
  if (isTeammate && room.passCount === 0) {
    // 队友出的牌，且自己不是领出循环，选择不要（除非自己能很快赢）
    // 简化：直接不要
    return null;
  }

  if (!lastPlay || lastSeat === seat) {
    // 领出
    const play = aiPlay(player.hand, null);
    return play;
  }

  const play = aiPlay(player.hand, lastPlay.cards);
  // 如果能压过且牌型合理，出；否则不要
  if (play && canBeat(play, lastPlay.cards)) {
    // 不要用炸弹压队友或小牌（简化）
    const pt = getPlayType(play);
    if (pt && (pt.type === 'bomb' || pt.type === 'rocket')) {
      // 炸弹留到关键时刻：手牌少时才用
      if (player.hand.length > 10) return null;
    }
    return play;
  }
  return null;
}

module.exports = {
  createRoom, getRoom, removeRoom, addPlayerToRoom, addAiPlayer, removePlayerFromRoom, kickPlayer,
  startGame, handleBid, handlePlay, handlePass, aiBid, aiDecidePlay, rooms
};
