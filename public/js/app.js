// 全局状态
const App = {
  token: localStorage.getItem('token'),
  user: null,
  socket: null,
  prefs: { card_counter: true, sound: true, music: true }
};

// ============ 工具函数 ============
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(App.token ? { 'Authorization': 'Bearer ' + App.token } : {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name + 'View').classList.add('active');
}

function setError(msg) {
  document.getElementById('authError').textContent = msg;
}

// ============ 认证 ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + 'Form').classList.add('active');
    setError('');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginUsername').value,
        password: document.getElementById('loginPassword').value
      })
    });
    App.token = data.token;
    App.user = data.user;
    localStorage.setItem('token', data.token);
    enterLobby();
  } catch (err) { setError(err.message); }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/register', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('regUsername').value,
        nickname: document.getElementById('regNickname').value,
        password: document.getElementById('regPassword').value
      })
    });
    App.token = data.token;
    App.user = data.user;
    localStorage.setItem('token', data.token);
    enterLobby();
  } catch (err) { setError(err.message); }
});

// ============ 大厅 ============
async function enterLobby() {
  SoundManager.init();
  try {
    const data = await api('/me');
    App.user = data.user;
  } catch (e) {}
  document.getElementById('userNickname').textContent = App.user.nickname || App.user.username;
  document.getElementById('userStats').textContent = `胜 ${App.user.wins || 0} / 负 ${App.user.losses || 0}`;
  document.getElementById('userBeans').textContent = App.user.beans || 0;
  document.getElementById('adminBtn').style.display = App.user.is_admin ? 'inline-block' : 'none';

  // 应用偏好
  App.prefs.card_counter = !!App.user.card_counter_enabled;
  App.prefs.sound = !!App.user.sound_enabled;
  App.prefs.music = !!App.user.music_enabled;
  updatePrefButtons();
  SoundManager.setPrefs({ sound: App.prefs.sound, music: App.prefs.music });

  // 加载全局设置音量
  try {
    const pub = await api('/settings/public');
    SoundManager.setPrefs({
      sVol: parseFloat(pub.settings.sound_volume || 0.6),
      mVol: parseFloat(pub.settings.music_volume || 0.3)
    });
  } catch (e) {}

  showView('lobby');
  connectSocket();
}

function updatePrefButtons() {
  document.getElementById('toggleSound').classList.toggle('off', !App.prefs.sound);
  document.getElementById('toggleMusic').classList.toggle('off', !App.prefs.music);
  document.getElementById('toggleCounter').classList.toggle('off', !App.prefs.card_counter);
}

document.getElementById('toggleSound').addEventListener('click', async () => {
  App.prefs.sound = !App.prefs.sound;
  updatePrefButtons();
  SoundManager.setPrefs({ sound: App.prefs.sound });
  await api('/me/prefs', { method: 'PUT', body: JSON.stringify({ sound_enabled: App.prefs.sound, music_enabled: App.prefs.music, card_counter_enabled: App.prefs.card_counter }) });
});

document.getElementById('toggleMusic').addEventListener('click', async () => {
  App.prefs.music = !App.prefs.music;
  updatePrefButtons();
  SoundManager.setPrefs({ music: App.prefs.music });
  await api('/me/prefs', { method: 'PUT', body: JSON.stringify({ sound_enabled: App.prefs.sound, music_enabled: App.prefs.music, card_counter_enabled: App.prefs.card_counter }) });
});

document.getElementById('toggleCounter').addEventListener('click', async () => {
  App.prefs.card_counter = !App.prefs.card_counter;
  updatePrefButtons();
  if (typeof updateCounterVisibility === 'function') updateCounterVisibility();
  await api('/me/prefs', { method: 'PUT', body: JSON.stringify({ sound_enabled: App.prefs.sound, music_enabled: App.prefs.music, card_counter_enabled: App.prefs.card_counter }) });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  App.token = null;
  if (App.socket) App.socket.disconnect();
  showView('auth');
});

document.getElementById('adminBtn').addEventListener('click', () => {
  showView('admin');
  if (typeof loadAdmin === 'function') loadAdmin();
});

document.getElementById('backFromAdmin').addEventListener('click', () => showView('lobby'));

// ============ 大厅操作 ============
document.getElementById('createAiRoom').addEventListener('click', () => {
  App.socket.emit('createRoom', { mode: 'ai' }, (res) => {
    if (res.ok) enterGame(res.room);
    else alert(res.error);
  });
});

document.getElementById('createMixedRoom').addEventListener('click', () => {
  App.socket.emit('createRoom', { mode: 'mixed' }, (res) => {
    if (res.ok) showRoomWait(res.room);
    else alert(res.error);
  });
});

document.getElementById('joinFriendRoom').addEventListener('click', () => {
  const id = document.getElementById('joinRoomId').value.trim().toUpperCase();
  if (!id) return alert('请输入房间号');
  App.socket.emit('joinRoom', { roomId: id }, (res) => {
    if (res.ok) {
      if (res.room.state === 'playing') enterGame(res.room);
      else showRoomWait(res.room);
    } else alert(res.error);
  });
});

document.getElementById('addAiBtn')?.addEventListener('click', () => {
  App.socket.emit('addAi', (res) => {
    if (!res.ok) alert(res.error);
  });
});

document.getElementById('startGameBtn').addEventListener('click', () => {
  App.socket.emit('startGame', (res) => {
    if (!res.ok) alert(res.error);
  });
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  App.socket.emit('leaveRoom');
  document.getElementById('roomWaitPanel').style.display = 'none';
});

function showRoomWait(room) {
  document.getElementById('roomWaitPanel').style.display = 'flex';
  document.getElementById('roomIdDisplay').textContent = room.id;
  document.getElementById('roomBaseBet').textContent = room.baseBet || 100;
  renderRoomSeats(room);
}

function renderRoomSeats(room) {
  const container = document.getElementById('roomSeats');
  const isOwner = room.ownerId === App.user.id;
  let html = '';
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = room.players[i];
    if (p) {
      const isOwnerSeat = p.id === room.ownerId;
      html += `<div class="seat-slot filled ${isOwnerSeat ? 'owner' : ''}">
        <div class="seat-label">座位 ${i + 1}${isOwnerSeat ? ' · 房主' : ''}</div>
        <div class="seat-name">${p.nickname}${p.isAI ? ' (AI)' : ''}</div>
        <div class="seat-beans">🫘 ${p.beans || 0}</div>
        ${isOwner && !p.isAI && p.id !== App.user.id ? `<button class="kick-player-btn" data-kick="${p.id}">踢出</button>` : ''}
      </div>`;
    } else {
      html += `<div class="seat-slot">
        <div class="seat-label">座位 ${i + 1}（空）</div>
        ${isOwner ? `<button class="add-ai-btn" data-add-ai="1">➕ 添加人机</button>` : `<div class="seat-label">等待加入…</div>`}
      </div>`;
    }
  }
  container.innerHTML = html;

  // 绑定添加人机（每个空座位）
  container.querySelectorAll('[data-add-ai]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.socket.emit('addAi', (res) => {
        if (!res.ok) alert(res.error);
      });
    });
  });
  // 绑定踢人
  container.querySelectorAll('[data-kick]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('确定踢出该玩家？')) {
        App.socket.emit('kickPlayer', { targetId: btn.dataset.kick }, (res) => {
          if (!res.ok) alert(res.error);
        });
      }
    });
  });

  // 开始按钮：仅房主且满3人
  document.getElementById('startGameBtn').style.display = (isOwner && room.players.length >= 3) ? 'inline-block' : 'none';
}

function enterGame(room) {
  document.getElementById('roomWaitPanel').style.display = 'none';
  document.getElementById('roomIdGame').textContent = '房间：' + room.id;
  showView('game');
  if (typeof initGameView === 'function') initGameView(room);
}

// ============ Socket 连接 ============
function connectSocket() {
  if (App.socket) {
    App.socket.disconnect();
  }
  App.socket = io({ auth: { token: App.token } });
  if (typeof setupGameSocket === 'function') setupGameSocket();

  App.socket.on('prefs', (p) => {
    App.prefs.card_counter = p.card_counter_enabled;
    App.prefs.sound = p.sound_enabled;
    App.prefs.music = p.music_enabled;
    updatePrefButtons();
    SoundManager.setPrefs({ sound: App.prefs.sound, music: App.prefs.music });
  });

  App.socket.on('beans', (data) => {
    document.getElementById('userBeans').textContent = data.beans;
    if (App.user) App.user.beans = data.beans;
  });

  App.socket.on('onlineUpdate', (data) => {
    document.getElementById('onlineCount').textContent = data.count;
    document.getElementById('onlinePlayersList').innerHTML =
      data.players.map(p => `<div class="online-chip">${p.nickname}</div>`).join('');
  });

  App.socket.on('roomList', (data) => {
    const list = document.getElementById('roomList');
    if (data.rooms.length === 0) {
      list.innerHTML = '<p class="hint">暂无房间</p>';
      return;
    }
    const stateMap = { waiting: '等待中', bidding: '叫分中', playing: '游戏中', ended: '已结束' };
    list.innerHTML = data.rooms.map(r => {
      const stateText = stateMap[r.state] || r.state;
      const canJoin = r.state === 'waiting' && r.playerCount < r.maxPlayers;
      const stateColor = r.state === 'waiting' ? '#4caf50' : '#ff9800';
      return `
      <div class="room-item">
        <div class="room-info">
          <span class="room-id">${r.id}</span> · ${r.ownerName}的房间 ·
          ${r.playerCount}/${r.maxPlayers}人${r.hasAI ? ' · 含AI' : ''} ·
          <span style="color:${stateColor}">${stateText}</span>
        </div>
        <button class="join-btn" data-join="${r.id}" ${canJoin ? '' : 'disabled'}>${canJoin ? '加入' : (r.state === 'waiting' ? '已满' : '进行中')}</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-join]').forEach(btn => {
      btn.addEventListener('click', () => {
        App.socket.emit('joinRoom', { roomId: btn.dataset.join }, (res) => {
          if (res.ok) {
            if (res.room.state === 'playing' || res.room.state === 'bidding') enterGame(res.room);
            else showRoomWait(res.room);
          } else alert(res.error);
        });
      });
    });
  });

  App.socket.on('kicked', () => {
    alert('你已被房主踢出房间');
    document.getElementById('roomWaitPanel').style.display = 'none';
    showView('lobby');
  });

  App.socket.on('roomUpdate', (room) => {
    if (room.state === 'playing' || room.state === 'bidding') {
      enterGame(room);
    } else {
      const panel = document.getElementById('roomWaitPanel');
      if (panel.style.display !== 'none' || room.players.some(p => p.id === App.user.id)) {
        if (panel.style.display === 'none') panel.style.display = 'flex';
        renderRoomSeats(room);
      }
    }
  });
}

// 自动登录
if (App.token) {
  enterLobby().catch(() => showView('auth'));
} else {
  showView('auth');
}
