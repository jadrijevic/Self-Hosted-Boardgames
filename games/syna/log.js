// Händelseloggen för Syna som text: hur lång tid varje steg tog och vad lagen budade och klarade.
// Underlaget är raderna i events.jsonl. De byggs ur storbildens vy och innehåller bara det som har visats för alla.

const STEPS = ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score'];
const HEAD = ['uppläsning', 'bud', 'syn', 'uppställning', 'försök', 'resultat', 'poäng'];
// Ett steg som står kvar längre än så här är en paus, inte spel. Det märks ut i stället för att räknas bort.
const PAUSE_MS = 5 * 60_000;

const num = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const mmss = (ms) => {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const minutes = (ms) => `${num(ms / 60_000)} min`;
function table(rows) {
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => String(c ?? '').padEnd(width[i])).join('  ').trimEnd()).join('\n');
}

// Tar raderna från en kväll, från start till att spelet avslutas. day och hm gör datum och klockslag av en tid.
export function logSummary(lines, { day, hm }) {
  const at = (l) => Date.parse(l.at);
  const played = lines.filter((l) => l.phase === 'game' && l.step);
  if (!played.length) return '';
  const names = played.at(-1).teams ?? {};
  const lag = (id) => names[id] ?? id;
  const where = (l) => (l.practice ? 'övningen' : `rond ${l.round + 1}`);

  const rounds = new Map();
  const stat = { undo: 0, restart: 0, early: false, swapped: [], final: 0, misses: 0, success: null };
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (l.by === 'undo') stat.undo += 1;
    if (l.by === 'serverStart' && i > 0) stat.restart += 1;
    if (l.by === 'toFinal') stat.early = true;
    if (l.by === 'swapTask' && prev?.taskName) stat.swapped.push(`${prev.taskName} i ${where(prev)}`);
    if (l.phase !== 'game' || !l.step) return;
    const next = lines[i + 1];
    const spent = next ? Math.max(0, at(next) - at(l)) : 0;
    if (l.final) { stat.misses = l.final.tries; stat.success = l.final.success; } // spelet räknar de misslyckade försöken
    if (l.step === 'final') stat.final += spent;
    if (l.step === 'final' || l.step === 'end') return;
    const key = l.practice ? 'övn' : String(l.round + 1);
    const r = rounds.get(key) ?? { key, time: {}, paused: false, score: null };
    rounds.set(key, r);
    r.task = l.taskName;
    r.time[l.step] = (r.time[l.step] ?? 0) + spent;
    if (spent > PAUSE_MS) r.paused = true;
    // Poängen gäller så länge ronden står kvar där. En rad från ett tidigare steg efteråt betyder att den ångrades.
    r.score = l.step === 'score' ? l : null;
  });

  const first = played[0];
  const end = played.find((l) => l.step === 'end');
  const last = end ?? lines.at(-1);
  const all = [...rounds.values()];
  const scored = all.filter((r) => r.score);
  const counted = scored.filter((r) => r.key !== 'övn');
  const out = [];

  const teams = Object.keys(names).map(lag);
  out.push(`Kvällen ${day(at(first))}, ${hm(at(first))}–${hm(at(last))}, ${minutes(at(last) - at(first))}. ${teams.length} lag: ${teams.join(', ')}.`);
  const practice = rounds.has('övn') ? 'Övningsrond och ' : '';
  const finale = stat.success === true ? `lyckades på försök ${stat.misses + 1}`
    : played.some((l) => l.step === 'final') ? `inte klar, ${stat.misses} misslyckade försök` : 'inte nådd';
  out.push(`${practice}${counted.length} av ${first.rounds} ronder räknade. Final: ${finale}.`);
  out.push(`Ångrat: ${stat.undo}. Bytt uppdrag: ${stat.swapped.length}${stat.swapped.length ? ` (${stat.swapped.join(', ')})` : ''}. Till finalen i förtid: ${stat.early ? 'ja' : 'nej'}. Omstarter av servern: ${stat.restart}.`);

  // Tid per steg. En rond som spelats om efter ett ångrande har tiden från båda gångerna.
  const sum = (r) => STEPS.reduce((x, s) => x + (r.time[s] ?? 0), 0);
  const total = Object.fromEntries(STEPS.map((s) => [s, all.reduce((x, r) => x + (r.time[s] ?? 0), 0)]));
  out.push('', 'Tid per steg, minuter:sekunder');
  out.push(table([
    ['rond', 'uppdrag', ...HEAD, 'summa'],
    ...all.map((r) => [`${r.key}${r.paused ? '*' : ''}`, r.task, ...STEPS.map((s) => (r.time[s] == null ? '–' : mmss(r.time[s]))), mmss(sum(r))]),
    ['final', '', ...STEPS.map(() => ''), mmss(stat.final)],
    ['summa', '', ...STEPS.map((s) => mmss(total[s])), mmss(all.reduce((x, r) => x + sum(r), 0) + stat.final)],
  ]));
  if (all.some((r) => r.paused)) out.push('* Något steg i ronden stod kvar i över fem minuter: en paus, eller en skärm som lämnades.');

  // Bud och resultat, för ronder som har fått sina poäng.
  if (scored.length) {
    const rows = [['rond', 'uppdrag', 'startbud', 'lag', 'bud', 'resultat', 'klarat', 'poäng', 'synad av']];
    const bold = [];
    const reached = [];
    let made = 0;
    for (const r of scored) {
      const l = r.score;
      const low = l.direction === 'low';
      l.duel.forEach((t, i) => {
        const bid = l.bids?.[t];
        const res = l.results?.[t];
        const callers = Object.entries(l.calls ?? {}).filter(([, target]) => target === t).map(([w]) => `${lag(w)} (${l.made?.[t] ? 'fel' : 'rätt'})`);
        const pts = num(l.points?.[t] ?? 0);
        rows.push([i ? '' : r.key, i ? '' : r.task, i ? '' : `${num(l.startBid)} ${l.unit}`, lag(t), bid == null ? '–' : num(bid), res == null ? '–' : num(res),
          l.made?.[t] ? 'ja' : 'nej', l.practice ? `(${pts})` : pts, callers.join(', ') || '–']);
        if (bid > 0) bold.push(low ? l.startBid / bid : bid / l.startBid);
        if (res > 0) reached.push(low ? l.startBid / res : res / l.startBid);
        if (l.made?.[t]) made += 1;
      });
    }
    const mean = (xs) => (xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(2).replace('.', ',');
    out.push('', 'Bud och resultat. Poäng inom parentes är övningen och räknades inte', table(rows));
    out.push('', 'Mot startbudet, där 1 är startbudet och högre är djärvare eller bättre');
    if (bold.length) out.push(`Buden: snitt ${mean(bold)} över ${bold.length} bud. Klarade bud: ${made} av ${bold.length}.`);
    if (reached.length) out.push(`Resultaten: snitt ${mean(reached)} över ${reached.length} resultat.`);
  }

  const places = end?.standings;
  if (places) out.push('', `Slutställning: ${places.map((p) => `${p.place}. ${lag(p.team)} ${num(p.score)} p`).join(', ')}.`);
  return out.join('\n');
}
