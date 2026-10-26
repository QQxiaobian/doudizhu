// 声音管理：使用 Web Audio API 生成出牌音效和背景音乐
const SoundManager = (() => {
  let ctx = null;
  let soundEnabled = true;
  let musicEnabled = true;
  let soundVolume = 0.6;
  let musicVolume = 0.3;
  let musicNodes = null;
  let musicPlaying = false;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 播放单音
  function tone(freq, duration, type = 'sine', volume = 0.3) {
    if (!soundEnabled) return;
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume * soundVolume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
  }

  // 出牌音效（短促的"啪"声）
  function playCard() {
    if (!soundEnabled) return;
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.08);
    gain.gain.setValueAtTime(0.4 * soundVolume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.1);
  }

  // 不要音效
  function pass() {
    tone(300, 0.15, 'sine', 0.2);
  }

  // 叫地主音效
  function bid() {
    tone(523, 0.1, 'square', 0.15);
    setTimeout(() => tone(659, 0.1, 'square', 0.15), 100);
  }

  // 炸弹音效
  function bomb() {
    if (!soundEnabled) return;
    const c = ensureCtx();
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150 - i * 20, c.currentTime);
        gain.gain.setValueAtTime(0.3 * soundVolume, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.3);
      }, i * 60);
    }
  }

  // 胜利音效
  function win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => setTimeout(() => tone(n, 0.2, 'triangle', 0.3), i * 120));
  }

  // 失败音效
  function lose() {
    const notes = [392, 330, 262];
    notes.forEach((n, i) => setTimeout(() => tone(n, 0.3, 'sine', 0.3), i * 200));
  }

  // 背景音乐：循环简单旋律
  function startMusic() {
    if (!musicEnabled || musicPlaying) return;
    const c = ensureCtx();
    musicPlaying = true;
    const melody = [523, 587, 659, 698, 784, 698, 659, 587, 523, 659, 784, 880, 784, 659, 523, 587];
    let idx = 0;
    const playNext = () => {
      if (!musicPlaying || !musicEnabled) return;
      const freq = melody[idx % melody.length];
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(0.08 * musicVolume, c.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.4);
      idx++;
      setTimeout(playNext, 350);
    };
    playNext();
  }

  function stopMusic() {
    musicPlaying = false;
  }

  function setPrefs({ sound, music, sVol, mVol }) {
    if (sound !== undefined) soundEnabled = sound;
    if (music !== undefined) {
      musicEnabled = music;
      if (music) startMusic(); else stopMusic();
    }
    if (sVol !== undefined) soundVolume = sVol;
    if (mVol !== undefined) musicVolume = mVol;
  }

  return {
    init: ensureCtx,
    playCard, pass, bid, bomb, win, lose,
    startMusic, stopMusic, setPrefs,
    isSoundOn: () => soundEnabled,
    isMusicOn: () => musicEnabled
  };
})();
