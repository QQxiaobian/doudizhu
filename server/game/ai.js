// 斗地主 AI
const { getPlayType, canBeat, countByValue } = require('./doudizhu');

// 从手牌中取出若干张组成指定牌型（找到能压过 lastCards 的最小出法）
function findPlayToBeat(hand, lastCards) {
  const lt = getPlayType(lastCards);
  if (!lt) return null;
  const counts = countByValue(hand);
  const values = Object.keys(counts).map(Number).sort((a, b) => a - b);

  // 火箭
  if (lt.type !== 'rocket') {
    if (counts[16] && counts[17]) {
      return [hand.find(c => c.value === 16), hand.find(c => c.value === 17)];
    }
  }

  // 炸弹：比当前炸弹大的最小炸弹（或任何炸弹压非炸弹）
  const bombCandidates = values.filter(v => counts[v] === 4 && v > (lt.type === 'bomb' ? lt.mainValue : -1));
  if (bombCandidates.length > 0) {
    // 只在必要时用炸弹（AI 策略：炸弹留到关键时刻，这里先返回最小的炸弹）
    const v = bombCandidates[0];
    return hand.filter(c => c.value === v);
  }

  // 同类型比较
  switch (lt.type) {
    case 'single': {
      const cands = values.filter(v => v > lt.mainValue);
      if (cands.length === 0) return null;
      const v = cands[0];
      return [hand.find(c => c.value === v)];
    }
    case 'pair': {
      const cands = values.filter(v => counts[v] >= 2 && v > lt.mainValue);
      if (cands.length === 0) return null;
      const v = cands[0];
      return hand.filter(c => c.value === v).slice(0, 2);
    }
    case 'triple': {
      const cands = values.filter(v => counts[v] >= 3 && v > lt.mainValue);
      if (cands.length === 0) return null;
      const v = cands[0];
      return hand.filter(c => c.value === v).slice(0, 3);
    }
    case 'triple_single': {
      const cands = values.filter(v => counts[v] >= 3 && v > lt.mainValue);
      for (const v of cands) {
        const triple = hand.filter(c => c.value === v).slice(0, 3);
        const kicker = hand.find(c => c.value !== v);
        if (kicker) return [...triple, kicker];
      }
      return null;
    }
    case 'triple_pair': {
      const cands = values.filter(v => counts[v] >= 3 && v > lt.mainValue);
      for (const v of cands) {
        const triple = hand.filter(c => c.value === v).slice(0, 3);
        const pairVals = values.filter(x => counts[x] >= 2 && x !== v);
        if (pairVals.length > 0) {
          const pv = pairVals[0];
          const pair = hand.filter(c => c.value === pv).slice(0, 2);
          return [...triple, ...pair];
        }
      }
      return null;
    }
    case 'straight': {
      const len = lt.length;
      for (let start = 3; start + len - 1 <= lt.mainValue - 1; start++) {
        // 需要 start..start+len-1 都有
      }
      // 找比 lt.mainValue 大的最小顺子
      const minStart = lt.mainValue - len + 2; // 起始值需要 > ...
      for (let s = Math.max(3, lt.mainValue - len + 2); s + len - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < len; i++) {
          if (!counts[s + i] || counts[s + i] < 1) { ok = false; break; }
        }
        if (ok) {
          const result = [];
          for (let i = 0; i < len; i++) {
            result.push(hand.find(c => c.value === s + i));
          }
          return result;
        }
      }
      return null;
    }
    case 'pair_straight': {
      const n = lt.length / 2;
      for (let s = Math.max(3, lt.mainValue - n + 2); s + n - 1 <= 14; s++) {
        let ok = true;
        for (let i = 0; i < n; i++) {
          if (!counts[s + i] || counts[s + i] < 2) { ok = false; break; }
        }
        if (ok) {
          const result = [];
          for (let i = 0; i < n; i++) {
            result.push(...hand.filter(c => c.value === s + i).slice(0, 2));
          }
          return result;
        }
      }
      return null;
    }
    case 'bomb':
      return null; // 已在上面处理
    default:
      return null;
  }
}

// AI 领出：出最小的单张（或如果有顺子等则出顺子，简化为最小单张）
function aiLead(hand) {
  const counts = countByValue(hand);
  const values = Object.keys(counts).map(Number).sort((a, b) => a - b);

  // 优先出顺子
  for (let len = 12; len >= 5; len--) {
    for (let s = 3; s + len - 1 <= 14; s++) {
      let ok = true;
      for (let i = 0; i < len; i++) {
        if (!counts[s + i] || counts[s + i] < 1) { ok = false; break; }
      }
      if (ok) {
        const result = [];
        for (let i = 0; i < len; i++) {
          result.push(hand.find(c => c.value === s + i));
        }
        return result;
      }
    }
  }

  // 连对
  for (let n = 10; n >= 3; n--) {
    for (let s = 3; s + n - 1 <= 14; s++) {
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!counts[s + i] || counts[s + i] < 2) { ok = false; break; }
      }
      if (ok) {
        const result = [];
        for (let i = 0; i < n; i++) {
          result.push(...hand.filter(c => c.value === s + i).slice(0, 2));
        }
        return result;
      }
    }
  }

  // 最小单张（不拆对子/三张/炸弹）
  const singles = values.filter(v => counts[v] === 1);
  if (singles.length > 0) {
    return [hand.find(c => c.value === singles[0])];
  }
  // 最小对子
  const pairs = values.filter(v => counts[v] === 2);
  if (pairs.length > 0) {
    return hand.filter(c => c.value === pairs[0]).slice(0, 2);
  }
  // 最小三张
  const triples = values.filter(v => counts[v] === 3);
  if (triples.length > 0) {
    return hand.filter(c => c.value === triples[0]).slice(0, 3);
  }
  // 出最小单张
  return [hand.find(c => c.value === values[0])];
}

// AI 决策：lastCards 为 null 表示领出，返回出牌数组或 null（要不起）
function aiPlay(hand, lastCards, isLandlord, teammateLastCards) {
  if (!lastCards) {
    return aiLead(hand);
  }
  // 判断 lastCards 是队友出的（不压队友）
  // 这里由调用方处理
  return findPlayToBeat(hand, lastCards);
}

module.exports = { aiPlay, aiLead, findPlayToBeat };
