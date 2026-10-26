// 斗地主核心规则
// 牌值: 3=3,4=4,...,10=10,J=11,Q=12,K=13,A=14,2=15,小王=16,大王=17

const RANK_NAMES = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'
};

const SUITS = ['♠', '♥', '♣', '♦'];

// 生成一副牌 54 张
function createDeck() {
  const deck = [];
  for (let v = 3; v <= 15; v++) {
    for (const s of SUITS) {
      deck.push({ value: v, suit: s, id: `${v}-${s}` });
    }
  }
  deck.push({ value: 16, suit: 'joker', id: 'small-joker' });
  deck.push({ value: 17, suit: 'joker', id: 'big-joker' });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 按牌值分组计数
function countByValue(cards) {
  const map = {};
  for (const c of cards) map[c.value] = (map[c.value] || 0) + 1;
  return map;
}

// 识别牌型，返回 { type, mainValue, length } 或 null
function getPlayType(cards) {
  if (!cards || cards.length === 0) return null;
  const counts = countByValue(cards);
  const values = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const len = cards.length;

  // 火箭
  if (len === 2 && counts[16] && counts[17]) {
    return { type: 'rocket', mainValue: 17, length: 2 };
  }

  // 单张
  if (len === 1) {
    return { type: 'single', mainValue: values[0], length: 1 };
  }

  // 对子
  if (len === 2 && counts[values[0]] === 2) {
    return { type: 'pair', mainValue: values[0], length: 2 };
  }

  // 三张 / 三带一 / 三带二
  if (len === 3) {
    if (counts[values[0]] === 3) return { type: 'triple', mainValue: values[0], length: 3 };
  }
  if (len === 4) {
    const tripleVal = values.find(v => counts[v] === 3);
    if (tripleVal !== undefined) return { type: 'triple_single', mainValue: tripleVal, length: 4 };
  }
  if (len === 5) {
    const tripleVal = values.find(v => counts[v] === 3);
    const pairVal = values.find(v => counts[v] === 2);
    if (tripleVal !== undefined && pairVal !== undefined) {
      return { type: 'triple_pair', mainValue: tripleVal, length: 5 };
    }
  }

  // 炸弹
  if (len === 4 && counts[values[0]] === 4) {
    return { type: 'bomb', mainValue: values[0], length: 4 };
  }

  // 顺子（5+ 连续单张，不含2和王）
  if (len >= 5 && values.every(v => v <= 14)) {
    let ok = true;
    for (let i = 1; i < values.length; i++) {
      if (counts[values[i]] !== 1 || values[i] !== values[i - 1] + 1) { ok = false; break; }
    }
    if (ok && values[values.length - 1] - values[0] + 1 === len) {
      return { type: 'straight', mainValue: values[values.length - 1], length: len };
    }
  }

  // 连对（3+ 连续对子）
  if (len >= 6 && len % 2 === 0) {
    const pairs = values.filter(v => counts[v] === 2);
    if (pairs.length === len / 2 && pairs.every(v => v <= 14)) {
      let ok = true;
      for (let i = 1; i < pairs.length; i++) {
        if (pairs[i] !== pairs[i - 1] + 1) { ok = false; break; }
      }
      if (ok) return { type: 'pair_straight', mainValue: pairs[pairs.length - 1], length: len };
    }
  }

  // 飞机（连续三张）/ 飞机带单 / 飞机带对
  const triples = values.filter(v => counts[v] === 3 && v <= 14).sort((a, b) => a - b);
  if (triples.length >= 2) {
    // 找出最长连续三张段
    for (let start = 0; start < triples.length; start++) {
      for (let end = triples.length - 1; end > start; end--) {
        const seg = triples.slice(start, end + 1);
        let consecutive = true;
        for (let i = 1; i < seg.length; i++) {
          if (seg[i] !== seg[i - 1] + 1) { consecutive = false; break; }
        }
        if (!consecutive) continue;
        const n = seg.length;
        // 纯飞机
        if (len === n * 3) {
          return { type: 'plane', mainValue: seg[n - 1], length: len };
        }
        // 飞机带单
        if (len === n * 4) {
          const remaining = cards.filter(c => !seg.includes(c.value));
          if (remaining.length === n) {
            // 剩余牌不能有炸弹/三张与飞机段冲突，简单放行
            return { type: 'plane_single', mainValue: seg[n - 1], length: len };
          }
        }
        // 飞机带对
        if (len === n * 5) {
          const remaining = cards.filter(c => !seg.includes(c.value));
          const rc = countByValue(remaining);
          const rPairs = Object.keys(rc).filter(v => rc[v] === 2);
          if (rPairs.length === n) {
            return { type: 'plane_pair', mainValue: seg[n - 1], length: len };
          }
        }
      }
    }
  }

  // 四带二（单） / 四带二对
  const fourVal = values.find(v => counts[v] === 4);
  if (fourVal !== undefined) {
    if (len === 6) {
      return { type: 'four_two_single', mainValue: fourVal, length: len };
    }
    if (len === 8) {
      const remaining = cards.filter(c => c.value !== fourVal);
      const rc = countByValue(remaining);
      const pairs = Object.keys(rc).filter(v => rc[v] === 2);
      if (pairs.length === 2) {
        return { type: 'four_two_pair', mainValue: fourVal, length: len };
      }
    }
  }

  return null;
}

// 判断 newCards 是否能压过 lastCards
function canBeat(newCards, lastCards) {
  const nt = getPlayType(newCards);
  const lt = getPlayType(lastCards);
  if (!nt) return false;
  if (!lt) return true; // 领出
  // 火箭最大
  if (nt.type === 'rocket') return true;
  if (lt.type === 'rocket') return false;
  // 炸弹
  if (nt.type === 'bomb' && lt.type !== 'bomb') return true;
  if (nt.type === 'bomb' && lt.type === 'bomb') return nt.mainValue > lt.mainValue;
  if (lt.type === 'bomb') return false;
  // 同类型同长度比较主牌
  if (nt.type === lt.type && nt.length === lt.length) {
    return nt.mainValue > lt.mainValue;
  }
  return false;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => b.value - a.value || a.suit.localeCompare(b.suit));
}

module.exports = {
  createDeck, shuffle, getPlayType, canBeat, sortCards, countByValue, RANK_NAMES, SUITS
};
