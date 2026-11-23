// Schemaläggare för Syna: vilka lag som duellerar i vilken rond.
// Målet är att alla lag får lika många dueller, för 2–6 lag och även när ett lag hoppar av.

export const KINDS = ['kropp', 'röst', 'huvud'];
export const DUELS_PER_TEAM = { 2: 6, 3: 4, 4: 3, 5: 2, 6: 2 };

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

// Cirkelmetoden för jämnt antal lag: i varje varv duellerar alla lag exakt en gång.
export function laps(teams) {
  const l = [...teams];
  const out = [];
  for (let r = 0; r < l.length - 1; r++) {
    out.push(Array.from({ length: l.length / 2 }, (_, i) => [l[i], l[l.length - 1 - i]]));
    l.splice(1, 0, l.pop());
  }
  return out;
}

// Fyller varje lags behov av dueller. Inget par möts oftare än cap,
// och helst spelar inget lag två ronder i rad.
function search(need, met, cap, last, seq) {
  const left = sum(need);
  if (left === 0) return seq;
  const big = Math.max(...Object.values(need));
  if (left % 2 || big > left - big) return null;
  const teams = Object.keys(need).sort();
  const cands = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const [a, b] = [teams[i], teams[j]];
      if (need[a] && need[b] && (met.get(key(a, b)) ?? 0) < cap) cands.push([a, b]);
    }
  }
  const rank = ([a, b]) => [last.includes(a) + last.includes(b), -(need[a] + need[b]), met.get(key(a, b)) ?? 0];
  cands.sort((p, q) => {
    const [x, y] = [rank(p), rank(q)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  for (const [a, b] of cands) {
    need[a] -= 1; need[b] -= 1; met.set(key(a, b), (met.get(key(a, b)) ?? 0) + 1);
    const found = search(need, met, cap, [a, b], [...seq, [a, b]]);
    need[a] += 1; need[b] += 1; met.set(key(a, b), met.get(key(a, b)) - 1);
    if (found) return found;
  }
  return null;
}

export function plan(need, met = new Map(), last = []) {
  for (let cap = 1; cap <= 8; cap++) {
    const found = search({ ...need }, new Map(met), cap, last, []);
    if (found) return found;
  }
  return null;
}

// Schemat vid start. Jämnt antal lag spelar hela varv, så att sista varvet kan ge dubbla poäng.
export function newSchedule(teams) {
  const n = teams.length;
  const d = DUELS_PER_TEAM[n];
  if (!d) throw new Error('Syna spelas med 2–6 lag');
  if (n === 2) return Array.from({ length: d }, () => [...teams]);
  if (n % 2 === 0) return laps(teams).slice(0, d).flat();
  return plan(Object.fromEntries(teams.map((t) => [t, d])));
}

// Sort per duell (kropp, röst, huvud) så att inget lag får samma sort oftare än nödvändigt.
export function assignKinds(schedule) {
  let best = null;
  let bestCost = null;
  const total = KINDS.length ** schedule.length;
  for (let code = 0; code < total; code++) {
    const pick = [];
    for (let i = 0, c = code; i < schedule.length; i++, c = Math.floor(c / KINDS.length)) pick.push(KINDS[c % KINDS.length]);
    const per = new Map();
    const tot = Object.fromEntries(KINDS.map((k) => [k, 0]));
    schedule.forEach(([a, b], i) => {
      for (const t of [a, b]) per.set(`${t}|${pick[i]}`, (per.get(`${t}|${pick[i]}`) ?? 0) + 1);
      tot[pick[i]] += 1;
    });
    const counts = [...per.values()];
    const cost = [
      Math.max(...counts),
      counts.reduce((a, v) => a + v - 1, 0),
      Math.max(...Object.values(tot)) - Math.min(...Object.values(tot)),
    ];
    if (!bestCost || cost[0] - bestCost[0] < 0
      || (cost[0] === bestCost[0] && (cost[1] < bestCost[1] || (cost[1] === bestCost[1] && cost[2] < bestCost[2])))) {
      best = pick;
      bestCost = cost;
    }
  }
  return best;
}

// Ett lag lämnar efter rond `after`. Resten planeras om så att kvarvarande lag slutar på
// lika många dueller (target). Går det inte blir target null, och poängen räknas som snitt per duell.
export function dropout(schedule, after, out) {
  const played = schedule.slice(0, after);
  const left = [...new Set(schedule.flat())].filter((t) => t !== out).sort();
  const done = Object.fromEntries(left.map((t) => [t, 0]));
  const met = new Map();
  for (const [a, b] of played) {
    for (const t of [a, b]) if (t !== out) done[t] += 1;
    if (a !== out && b !== out) met.set(key(a, b), (met.get(key(a, b)) ?? 0) + 1);
  }
  const last = played.at(-1) ?? [];
  const most = Math.max(...Object.values(done));
  let best = null;
  for (let target = most; target < most + 4; target++) {
    const need = Object.fromEntries(left.map((t) => [t, target - done[t]]));
    if (sum(need) === 0 || sum(need) % 2) continue;
    const rest = plan(need, met, last);
    if (rest && (!best || Math.abs(after + rest.length - schedule.length) < Math.abs(best.total - schedule.length))) {
      best = { total: after + rest.length, target, rest };
    }
  }
  if (best) return best;

  const planned = Math.max(...Object.values(schedule.flat().reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {})));
  const need = Object.fromEntries(left.map((t) => [t, Math.max(0, planned - done[t])]));
  if (sum(need) % 2) {
    const top = Object.keys(need).reduce((a, b) => (need[b] > need[a] ? b : a));
    need[top] -= 1;
  }
  const rest = plan(need, met, last) ?? [];
  return { total: after + rest.length, target: null, rest };
}
