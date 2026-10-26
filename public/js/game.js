// 游戏前端逻辑
let gameState = null;
let selectedCards = new Set(); // card ids
let mySeat = -1;
let knownPlayedCards = {}; // value -> count played (for counter)

const RANK_NAMES = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'
};

function initGameView(room) {
  gameState = room;
  selectedCards.clear();
  knownPlayedCards = {};
  document.getElementById('gameEndPanel').style.display = 'none';
  if (typeof setupGameSocket === 'function') setupGameSocket();
  bindGameEvents();
  // 等待 gameState 事件填充
}

function bindGameEvents() {
  document.getElementById('playBtn').onclick = playSelected;
  document.getElementById('passBtn').onclick = () => {
    App.socket.emit('pass', (res) => { if (!res.ok) alert(res.error); });
  };
  document.getElementById('hintBtn').onclick = showHint;
  document.getElementById('backToLobby').onclick = () => {
    App.socket.emit('leaveRoom');
    showView('lobby');
  };
  document.getElementById('leaveGameBtn').onclick = () => {
    App.socket.emit('leaveRoom');
    showView('lobby');
  };
  document.getElementById('playAgainBtn').onclick = () => {
    // 返回大厅再重新开
    showView('lobby');
  };
}

function renderCard(card, opts = {}) {
  const div = document.createElement('div');
  div.className = 'card';
  if (card.value === 16) { div.classList.add('small-joker'); div.textContent = '小王'; }
  else if (card.value === 17) { div.classList.add('big-joker'); div.textContent = '大王'; }
  else {
    const isRed = card.suit === '♥' || card.suit === '♦';
    div.classList.add(isRed ? 'red' : 'black');
    div.innerHTML = `<div>${RANK_NAMES[card.value]}</div><div class="suit">${card.suit}</div>`;
  }
  if (opts.onClick) div.onclick = opts.onClick;
  if (opts.id) div.dataset.id = opts.id;
  return div;
}

function renderMyHand(hand) {
  const container = document.getElementById('myHand');
  container.innerHTML = '';
  // 按牌值从大到小
  const sorted = [...hand].sort((a, b) => b.value - a.value);
  for (const card of sorted) {
    const el = renderCard(card, {
      id: card.id,
      onClick: () => toggleSelect(card.id)
    });
    if (selectedCards.has(card.id)) el.classList.add('selected');
    container.appendChild(el);
  }
}

function toggleSelect(cardId) {
  if (selectedCards.has(cardId)) selectedCards.delete(cardId);
  else selectedCards.add(cardId);
  const el = document.querySelector(`#myHand .card[data-id="${cardId}"]`);
  if (el) el.classList.toggle('selected');
}

function getSelectedCardObjects() {
  if (!gameState || !gameState.myHand) return [];
  return gameState.myHand.filter(c => selectedCards.has(c.id));
}

function playSelected() {
  const cards = getSelectedCardObjects();
  if (cards.length === 0) return alert('请选择要出的牌');
  App.socket.emit('play', { cards }, (res) => {
    if (res.ok) {
      selectedCards.clear();
      SoundManager.playCard();
    } else {
      alert(res.error);
    }
  });
}

// 提示：简单提示最小单张或压牌
function showHint() {
  if (!gameState) return;
  const hand = gameState.myHand;
  const lastPlay = gameState.lastPlay;
  if (!lastPlay) {
    // 领出：选最小单张
    const sorted = [...hand].sort((a, b) => a.value - b.value);
    selectedCards.clear();
    selectedCards.add(sorted[0].id);
  } else {
    // 找最小能压的单张
    const lastVal = lastPlay.cards[0].value;
    const candidates = hand.filter(c => c.value > lastVal).sort((a, b) => a.value - b.value);
    if (candidates.length > 0) {
      selectedCards.clear();
      selectedCards.add(candidates[0].id);
    } else {
      alert('没有能压的牌，请选择不要');
      return;
    }
  }
  renderMyHand(gameState.myHand);
}

// 渲染游戏状态
function renderGameState(state) {
  gameState = state;
  mySeat = state.mySeat;

  // 倍数
  document.getElementById('multiplier').textContent = state.multiplier;

  // 玩家信息
  for (let i = 0; i < 3; i++) {
    const p = state.players.find(pl => pl.seat === i);
    if (!p) continue;
    const nameEl = document.getElementById(`player${i}Name`);
    if (nameEl) nameEl.textContent = p.nickname;
    const lordEl = document.getElementById(`player${i}Landlord`);
    if (lordEl) lordEl.style.display = p.isLandlord ? 'inline-block' : 'none';
    const countEl = document.getElementById(`player${i}Count`);
    if (countEl) countEl.textContent = p.handCount + '张';
  }

  // 我的手牌
  if (state.myHand) renderMyHand(state.myHand);

  // 底牌
  const bottomEl = document.getElementById('bottomCardsDisplay');
  bottomEl.innerHTML = '';
  if (state.bottomCards && state.bottomCards.length > 0) {
    for (const c of state.bottomCards) {
      const el = renderCard(c);
      el.style.width = '36px'; el.style.height = '52px'; el.style.fontSize = '12px';
      bottomEl.appendChild(el);
    }
  }

  // 清除出牌区
  for (let i = 0; i < 3; i++) {
    document.getElementById(`player${i}Played`).innerHTML = '';
    document.getElementById(`player${i}Pass`).style.display = 'none';
  }

  // 最后出牌
  if (state.lastPlay && state.lastPlay.cards) {
    const seat = state.lastPlay.seat;
    const playedEl = document.getElementById(`player${seat}Played`);
    for (const c of state.lastPlay.cards) {
      const el = renderCard(c);
      playedEl.appendChild(el);
    }
  }

  // 叫分阶段
  if (state.state === 'bidding') {
    renderBidding(state);
  } else {
    document.getElementById('biddingPanel').style.display = 'none';
  }

  // 更新记牌器
  updateCounter();

  // 按钮状态
  const isMyTurn = state.currentTurn === mySeat;
  document.getElementById('playBtn').disabled = !isMyTurn;
  document.getElementById('passBtn').disabled = !isMyTurn || !state.lastPlay || state.lastPlay.seat === mySeat;
}

function renderBidding(state) {
  const panel = document.getElementById('biddingPanel');
  panel.style.display = 'block';
  const maxBid = Math.max(...(state.bidHistory || []).map(b => b.bid || 0), 0);
  document.getElementById('currentBid').textContent = maxBid;

  const btnContainer = document.getElementById('bidButtons');
  btnContainer.innerHTML = '';
  if (state.currentBidder === mySeat) {
    const opts = [0, 1, 2, 3].filter(b => b > maxBid || b === 0);
    for (const b of opts) {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = b === 0 ? '不叫' : `${b}分`;
      btn.onclick = () => App.socket.emit('bid', { bid: b });
      btnContainer.appendChild(btn);
    }
  } else {
    const bidder = state.players.find(p => p.seat === state.currentBidder);
    btnContainer.innerHTML = `<span class="hint">等待 ${bidder ? bidder.nickname : ''} 叫分...</span>`;
  }
}

// ============ Socket 游戏事件 ============
let gameSocketBound = false;
function setupGameSocket() {
  if (gameSocketBound || !App.socket) return;
  gameSocketBound = true;

  App.socket.on('gameState', (state) => {
    renderGameState(state);
  });

  App.socket.on('playUpdate', (data) => {
    const playedEl = document.getElementById(`player${data.seat}Played`);
    playedEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      if (i !== data.seat) {
        document.getElementById(`player${i}Played`).innerHTML = '';
        document.getElementById(`player${i}Pass`).style.display = 'none';
      }
    }
    for (const c of data.cards) {
      const el = renderCard(c);
      playedEl.appendChild(el);
    }
    for (const c of data.cards) {
      knownPlayedCards[c.value] = (knownPlayedCards[c.value] || 0) + 1;
    }
    if (data.type) {
      if (data.type.type === 'bomb' || data.type.type === 'rocket') SoundManager.bomb();
      else SoundManager.playCard();
    }
    updateCounter();
  });

  App.socket.on('passUpdate', (data) => {
    document.getElementById(`player${data.seat}Pass`).style.display = 'block';
    SoundManager.pass();
  });

  App.socket.on('bidUpdate', () => {
    SoundManager.bid();
  });

  App.socket.on('gameEnd', (data) => {
    const panel = document.getElementById('gameEndPanel');
    panel.style.display = 'block';
    const me = data.players.find(p => p.id === App.user.id);
    const myWon = me && ((me.isLandlord && data.winner === 'landlord') || (!me.isLandlord && data.winner === 'farmer'));
    document.getElementById('gameEndTitle').textContent = myWon ? '🎉 你赢了！' : '😢 你输了';
    document.getElementById('gameEndDesc').textContent =
      (data.winner === 'landlord' ? '地主胜' : '农民胜') + `，倍数：${data.multiplier}`;
    if (myWon) SoundManager.win(); else SoundManager.lose();
  });
}

// ============ 记牌器 ============
function updateCounterVisibility() {
  const counter = document.getElementById('cardCounter');
  counter.style.display = App.prefs.card_counter ? 'block' : 'none';
}

function updateCounter() {
  const counter = document.getElementById('cardCounter');
  if (!App.prefs.card_counter) {
    counter.style.display = 'none';
    return;
  }
  counter.style.display = 'block';
  const list = document.getElementById('counterList');
  // 每种牌的总数
  const totalMap = {};
  for (let v = 3; v <= 15; v++) totalMap[v] = 4;
  totalMap[16] = 1; totalMap[17] = 1;

  // 减去我手里的
  const myCounts = {};
  if (gameState && gameState.myHand) {
    for (const c of gameState.myHand) myCounts[c.value] = (myCounts[c.value] || 0) + 1;
  }

  const rows = [];
  // 从大到小显示
  const values = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
  for (const v of values) {
    const remaining = totalMap[v] - (knownPlayedCards[v] || 0);
    const myHave = myCounts[v] || 0;
    const isOut = remaining - myHave <= 0;
    rows.push(`<div class="counter-row ${isOut ? 'out' : ''}">
      <span>${RANK_NAMES[v]}</span>
      <span>剩 ${remaining - myHave} ${myHave ? `(我${myHave})` : ''}</span>
    </div>`);
  }
  list.innerHTML = rows.join('');
}
