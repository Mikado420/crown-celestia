// CPUの思考。エンジンの状態を直接読むが、他人の手札は見ない。
import { SEAT_LIMIT, tabOf, tableTab, cheapestTable } from './game.js';

function targetTable(tables, rank) {
  let target = -1;
  tables.forEach((t, i) => {
    const end = t[t.length - 1];
    if (end < rank && (target === -1 || end > tables[target][tables[target].length - 1])) target = i;
  });
  return target;
}

// 期待されるツケが小さそうなカードを選ぶ（少しだけ気まぐれ）
export function cpuChooseCard(state, pid, random = Math.random) {
  const hand = state.hands[pid];
  const others = state.players.length - 1;
  const minTab = Math.min(...state.tables.map((t) => tableTab(state, t)));
  let best = hand[0];
  let bestCost = Infinity;
  for (const rank of hand) {
    const idx = targetTable(state.tables, rank);
    let cost;
    if (idx === -1) {
      // 卓を選んで引き取る。他人がもっと小さい札を出せば助かることもある
      cost = minTab * 0.85;
    } else {
      const table = state.tables[idx];
      const tab = tableTab(state, table);
      const end = table[table.length - 1];
      const gap = rank - end;
      const seatsLeft = SEAT_LIMIT - table.length;
      if (seatsLeft <= 0) {
        cost = tab * 0.95;
      } else {
        // 差が大きく、空席が少ないほど割り込まれて6人目になりやすい
        const squeeze = (gap / state.deckSize) * others * 4;
        cost = (squeeze / seatsLeft) * (tab + 2);
      }
    }
    // 自分の高いツケの札は、安全なうちに出しておきたい
    cost -= tabOf(state, rank) * 0.05;
    cost += random() * 0.6;
    if (cost < bestCost) {
      bestCost = cost;
      best = rank;
    }
  }
  return best;
}

export function cpuChooseTable(state) {
  return cheapestTable(state);
}
