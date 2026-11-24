// Spelmotorn för Syna: ronder, bud, syn, tid och poäng. Ren logik utan nätverk.
// Reglerna står i REGLER.md.
//
// En rond går genom stegen
//   intro  -> bid -> call -> ready -> play -> result -> score
// och efter sista ronden kommer final -> end.
// Uppdrag där lagen turas om (mode: turns) går ready -> play två gånger.

import { newSchedule, assignKinds, KINDS } from './schedule.js';
import { TASKS, FINALS, taskById, finalById } from './tasks.js';

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
// Övningsronden spelas före rond 1 och ligger utanför schemat: s.practice = { task, duel } medan den pågår.
// Den går som en vanlig rond, men ger inga poäng och inga rekord.
export const PRACTICE_TASK = 'masken';
const duelOf = (s) => (s.practice ? s.practice.duel : s.schedule[s.round]);
const taskOf = (s) => taskById(s.practice ? s.practice.task : s.tasks[s.round]);
const boldness = (task, bid) => (task.direction === 'low' ? -bid : bid);
const performing = (s, task) => (task.mode === 'turns' ? [s.order[s.turn]] : duelOf(s));

function watchersOf(room) {
  const duel = duelOf(room.syna);
  return room.teams.map((t) => t.id).filter((id) => !duel.includes(id));
}

// Väljer ett uppdrag av rätt sort som inte redan är använt. Tar slut på sorten
// tas ett annat oanvänt uppdrag, och i sista hand ett som redan spelats.
// settings avgör urvalet: uppdrag med material och långa uppdrag är med först när värden har slagit på dem.
export function pickTask(kind, settings, used, rng = Math.random) {
  const allowed = (t) => (settings?.material || !t.material) && (settings?.long || !t.long);
  const free = TASKS.filter((t) => !used.includes(t.id));
  const pools = [
    free.filter((t) => t.kind === kind && allowed(t)),
    free.filter(allowed),
    free,
    TASKS,
  ];
  return pick(pools.find((p) => p.length), rng).id;
}

// Poängen för en rond.
//   Klarat bud: 1. Djärvaste klarade budet: 2 till (delas vid lika bud).
//   Rätt syn: 2. Fel syn: det synade laget får 1. Den som synade förlorar inget: ingen ställning sjunker någonsin.
export function scoreRound({ direction, bids, results, calls = {}, factor = 1 }) {
  const teams = Object.keys(bids);
  const made = {};
  for (const t of teams) {
    const r = results[t];
    made[t] = r != null && (direction === 'low' ? r <= bids[t] : r >= bids[t]);
  }
  const points = Object.fromEntries([...teams, ...Object.keys(calls)].map((t) => [t, 0]));
  const ok = teams.filter((t) => made[t]);
  for (const t of ok) points[t] += 1;
  if (ok.length) {
    const bold = (t) => (direction === 'low' ? -bids[t] : bids[t]);
    const top = Math.max(...ok.map(bold));
    const boldest = ok.filter((t) => bold(t) === top);
    for (const t of boldest) points[t] += 2 / boldest.length;
  }
  for (const [caller, target] of Object.entries(calls)) {
    if (!(target in made)) continue; // stod över
    if (made[target]) {
      points[target] += 1;
    } else {
      points[caller] += 2;
    }
  }
  for (const t of Object.keys(points)) points[t] *= factor;
  return { made, points };
}

export function beginRound(room, rng = Math.random) {
  const s = room.syna;
  const task = taskOf(s);
  const [a, b] = duelOf(s);
  Object.assign(s, {
    step: 'intro',
    bids: { [a]: { value: task.bid.start, locked: false }, [b]: { value: task.bid.start, locked: false } },
    calls: {},
    results: { [a]: null, [b]: null },
    order: [a, b],
    turn: 0,
    startedAt: null,
    endsAt: null,
    made: null,
    points: null,
    newRecord: null,
    topic: task.topics ? pick(task.topics, rng) : null,
    notes: null,
  });
  if (task.prompts) {
    const first = pick(task.prompts, rng);
    s.notes = { [a]: first, [b]: pick(task.prompts.filter((p) => p !== first), rng) };
  }
}

export function start(room, now = Date.now(), rng = Math.random) {
  const ids = room.teams.map((t) => t.id);
  if (ids.length < 2 || ids.length > 6) return 'Syna spelas med 2–6 lag';
  const schedule = newSchedule(ids);
  // Sorterna sprids jämnt mellan lagen, men vilken sort som hamnar i vilket varv slumpas per kväll.
  const mixed = [...KINDS];
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  const kinds = assignKinds(schedule).map((k) => mixed[KINDS.indexOf(k)]);
  // Med övningsrond är övningens uppdrag förbrukat, så att det inte kommer igen senare under kvällen.
  const practice = room.settings?.practice !== false;
  const tasks = [];
  for (const kind of kinds) tasks.push(pickTask(kind, room.settings, practice ? [...tasks, PRACTICE_TASK] : tasks, rng));
  // I övningen duellerar helst två lag som inte möts i rond 1. Då har alla lag både budat och synat efter rond 1.
  const first = schedule[0];
  const practiceDuel = schedule.find((pair) => !pair.some((t) => first.includes(t))) ?? first;
  // Jämnt antal lag: i sista varvet tävlar alla lag en gång, och det ger dubbla poäng.
  const lastLap = ids.length % 2 === 0 ? schedule.length - ids.length / 2 : null;
  room.syna = {
    schedule,
    kinds,
    tasks,
    round: 0,
    doubleFrom: lastLap,
    hideFrom: lastLap ?? schedule.length - 1,
    scores: Object.fromEntries(ids.map((id) => [id, 0])),
    recordsSet: Object.fromEntries(ids.map((id) => [id, 0])),
    final: { task: FINALS[0].id, tries: 0, success: null },
  };
  if (practice) room.syna.practice = { task: PRACTICE_TASK, duel: [...practiceDuel] };
  room.phase = 'game';
  beginRound(room, rng);
  return null;
}

function closeBids(room, rng = Math.random) {
  const s = room.syna;
  const task = taskOf(s);
  const [a, b] = duelOf(s);
  s.bids[a].locked = true;
  s.bids[b].locked = true;
  // Det djärvaste budet går sist när lagen turas om. Vid lika bud avgör slumpen, så att inte samma lag
  // alltid börjar: laget som står först i schemat gör det i varje duell.
  const [x, y] = [boldness(task, s.bids[a].value), boldness(task, s.bids[b].value)];
  s.order = (x === y ? rng() < 0.5 : x < y) ? [a, b] : [b, a];
  s.step = watchersOf(room).length ? 'call' : 'ready';
}

function startPlay(room, now) {
  const s = room.syna;
  const task = taskOf(s);
  s.step = 'play';
  s.startedAt = now;
  s.endsAt = now + task.seconds * 1000;
  for (const t of performing(s, task)) s.results[t] = task.measure === 'count' ? 0 : null;
}

function endPlay(room) {
  const s = room.syna;
  const task = taskOf(s);
  // Stoppades aldrig klockan har laget hållit hela tiden (high) eller inte kommit i mål (low).
  if (task.measure === 'time' && task.direction === 'high') {
    for (const t of performing(s, task)) s.results[t] ??= task.seconds;
  }
  s.startedAt = null;
  s.endsAt = null;
  if (task.mode === 'turns' && s.turn === 0) {
    s.turn = 1;
    s.step = 'ready';
  } else {
    s.step = 'result';
  }
}

function finishRound(room, now) {
  const s = room.syna;
  const task = taskOf(s);
  const [a, b] = duelOf(s);
  const factor = s.doubleFrom !== null && s.round >= s.doubleFrom ? 2 : 1;
  const { made, points } = scoreRound({
    direction: task.direction,
    bids: { [a]: s.bids[a].value, [b]: s.bids[b].value },
    results: s.results,
    calls: s.calls,
    factor,
  });
  s.made = made;
  s.points = points;
  s.newRecord = null;
  // Övningsronden visar vad poängen hade blivit, men rör varken ställningen eller rekordboken.
  if (s.practice) { s.step = 'score'; return; }
  for (const [t, p] of Object.entries(points)) s.scores[t] = (s.scores[t] ?? 0) + p;

  // Rekordboken gäller resultatet, inte budet. Bara rondens bästa lag kan ta rekordet.
  const better = (x, y) => (task.direction === 'low' ? x < y : x > y);
  let best = null;
  for (const t of [a, b]) {
    if (s.results[t] != null && (best === null || better(s.results[t], s.results[best]))) best = t;
  }
  const old = room.records[task.id];
  s.newRecord = null;
  if (best && (!old || better(s.results[best], old.value))) {
    room.records[task.id] = {
      value: s.results[best],
      team: room.teams.find((t) => t.id === best)?.name ?? best,
      date: new Date(now).toISOString().slice(0, 10),
    };
    s.recordsSet[best] += 1;
    s.newRecord = best;
  }
  s.step = 'score';
}

function advance(room, ctx, isJudge, now, rng) {
  const s = room.syna;
  const judgeSteps = ['ready', 'play', 'result'];
  if (!ctx.isAdmin && !(isJudge && judgeSteps.includes(s.step))) return 'bara värden får gå vidare här';
  switch (s.step) {
    case 'intro': s.step = 'bid'; return null;
    case 'bid': closeBids(room, rng); return null;
    case 'call':
      for (const w of watchersOf(room)) s.calls[w] ??= 'pass';
      s.step = 'ready';
      return null;
    case 'ready': startPlay(room, now); return null;
    case 'play': endPlay(room); return null;
    case 'result': finishRound(room, now); return null;
    case 'score':
      if (s.practice) {
        // Övningen är över: nu börjar rond 1.
        s.practice = null;
        beginRound(room, rng);
      } else if (s.round + 1 < s.schedule.length) {
        s.round += 1;
        beginRound(room, rng);
      } else {
        s.step = 'final';
      }
      return null;
    default: return 'det finns inget nästa steg';
  }
}

// Ångra: läget före de senaste stegen sparas i s.history, och värden kan lägga tillbaka det.
// Ett läge sparas när spelet lämnar ett steg, eller när uppdraget byts. Under ett försök sparas
// inget, så det senast sparade läget är då alltid stunden före försöket: att ångra där är att
// göra om försöket. Historiken innehåller hemliga bud och lämnar aldrig servern (se view).
const HISTORY = 6;
const stepKey = (s) => [s.round, s.step, s.turn, s.tasks[s.round], s.topic, s.practice ? 'övning' : ''].join('|');

function snapshot(room) {
  const { history, ...syna } = room.syna;
  return JSON.parse(JSON.stringify({ syna, records: room.records }));
}

// Lägger tillbaka i samma objekt, så att den som håller i läget ser det återställda.
function restore(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function undo(room, ctx, msg) {
  const s = room.syna;
  // Kontrollanten får börja om ett försök som startats av misstag. Allt annat ångrar bara värden.
  const judgeRestart = ctx.device?.role === 'judge' && s.step === 'play';
  if (!ctx.isAdmin && !judgeRestart) return 'bara värden får ångra';
  // Knappen säger vad som ångras. Har läget hunnit ändras gäller den inte längre.
  if (msg.step !== undefined && msg.step !== s.step) return 'läget ändrades, försök igen';
  const history = Array.isArray(s.history) ? s.history : [];
  const last = history.at(-1);
  if (!last?.syna || !last.records) return 'det finns inget att ångra';
  restore(room.records, last.records);
  restore(s, { ...last.syna, history: history.slice(0, -1) });
  return null;
}

// Får mobilen byta plats just nu? Returnerar en feltext om inte, annars null.
// Medan ett lags val är hemligt sitter dess mobiler kvar: annars kan man byta till motståndarlaget,
// se deras bud och byta tillbaka. En mobil utan plats får alltid gå med, så att en ny mobil kan ersätta en som dött.
// Under spelet kan ingen ny bli kontrollant så länge det finns en. Värden kan ta bort den som sitter.
export function seatLocked(room, dev, msg) {
  const s = room.syna;
  if (!s) return null;
  const duel = duelOf(s);
  if (dev.role === 'team') {
    if (s.step === 'bid' && duel.includes(dev.team)) return 'vänta tills buden är lagda';
    if (s.step === 'call' && !duel.includes(dev.team)) return 'vänta tills alla har synat';
  }
  if (msg.t === 'choose' && msg.role === 'judge' && dev.role !== 'judge' && Object.values(room.devices).some((d) => d.role === 'judge')) {
    return 'det finns redan en kontrollant. Värden kan ta bort den';
  }
  return null;
}

// Tar emot en avsikt under spelet. ctx = { device, isAdmin }.
// Värden får agera åt ett lag (msg.team), så att kvällen klarar sig om en mobil saknas.
export function apply(room, ctx, msg, now = Date.now(), rng = Math.random) {
  const s = room.syna;
  if (!s) return 'inget spel pågår';
  if (msg.t === 'undo') return undo(room, ctx, msg);
  const before = s.step === 'play' ? null : snapshot(room);
  const key = stepKey(s);
  const error = handle(room, ctx, msg, now, rng);
  const after = room.syna;
  if (!error && before && after && stepKey(after) !== key) {
    after.history = [...(Array.isArray(after.history) ? after.history : []), before].slice(-HISTORY);
  }
  return error;
}

function handle(room, ctx, msg, now, rng) {
  const s = room.syna;
  const task = taskOf(s);
  const duel = duelOf(s);
  const own = ctx.device?.role === 'team' ? ctx.device.team : null;
  const team = ctx.isAdmin && msg.team ? msg.team : own;
  const isJudge = ctx.isAdmin || ctx.device?.role === 'judge';

  switch (msg.t) {
    case 'bid':
    case 'lockBid': {
      if (s.step !== 'bid') return 'budgivningen är inte öppen';
      if (!duel.includes(team)) return 'ert lag budar inte i den här ronden';
      const bid = s.bids[team];
      if (bid.locked) return 'budet är redan låst';
      if (msg.t === 'bid') {
        const v = Number(msg.value);
        if (!Number.isFinite(v)) return 'ogiltigt bud';
        bid.value = Math.min(task.bid.max, Math.max(task.bid.min, Math.round(v / task.bid.step) * task.bid.step));
        return null;
      }
      bid.locked = true;
      if (duel.every((t) => s.bids[t].locked)) closeBids(room, rng);
      return null;
    }
    case 'call': {
      const watchers = watchersOf(room);
      if (s.step !== 'call') return 'synen är inte öppen';
      if (!watchers.includes(team)) return 'ert lag tittar inte i den här ronden';
      if (msg.target !== 'pass' && !duel.includes(msg.target)) return 'okänt val';
      s.calls[team] = msg.target;
      if (watchers.every((w) => s.calls[w])) s.step = 'ready';
      return null;
    }
    case 'count': {
      if (!isJudge) return 'bara kontrollanten får räkna';
      if (task.measure !== 'count' || !['play', 'result'].includes(s.step)) return 'det går inte att räkna nu';
      if (!duel.includes(msg.team)) return 'okänt lag';
      if (msg.delta !== 1 && msg.delta !== -1) return 'ogiltigt steg';
      s.results[msg.team] = Math.max(0, (s.results[msg.team] ?? 0) + msg.delta);
      return null;
    }
    case 'stop': {
      if (!isJudge) return 'bara kontrollanten får stoppa tiden';
      if (task.measure !== 'time' || s.step !== 'play') return 'det finns ingen tid att stoppa';
      const active = performing(s, task);
      if (!active.includes(msg.team)) return 'laget tävlar inte just nu';
      if (s.results[msg.team] != null) return 'tiden är redan stoppad';
      // Ett tryck efter att tiden gått ut räknas som att tiden gick ut, som om klockan hade hunnit först.
      if (now >= s.endsAt) { endPlay(room); return null; }
      s.results[msg.team] = Math.round((now - s.startedAt) / 100) / 10;
      if (active.every((t) => s.results[t] != null)) endPlay(room);
      return null;
    }
    case 'setResult': {
      if (!isJudge) return 'bara kontrollanten får ändra resultatet';
      if (s.step !== 'result') return 'resultatet kan bara ändras efter tiden';
      if (!duel.includes(msg.team)) return 'okänt lag';
      const v = msg.value === null ? null : Number(msg.value);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return 'ogiltigt resultat';
      // En tid kan inte vara längre än uppdragets tid, och det som räknas är hela tal.
      if (v === null) s.results[msg.team] = null;
      else if (task.measure === 'time') s.results[msg.team] = Math.min(task.seconds, Math.round(v * 10) / 10);
      else s.results[msg.team] = Math.round(v);
      return null;
    }
    case 'next':
      return advance(room, ctx, isJudge, now, rng);
    case 'skipPractice': {
      if (!ctx.isAdmin) return 'bara värden får hoppa över övningen';
      if (!s.practice) return 'det finns ingen övningsrond att hoppa över';
      s.practice = null;
      beginRound(room, rng);
      return null;
    }
    case 'toFinal': {
      // Nödutgången när tiden inte räcker: resten av ronderna stryks och finalen börjar.
      // En rond som pågår räknas inte. En rond som redan har fått sina poäng behåller dem.
      if (!ctx.isAdmin) return 'bara värden får gå till finalen';
      if (['final', 'end'].includes(s.step)) return 'finalen har redan börjat';
      // Lämnas övningen den här vägen ska rondens läge gälla lagen i schemat, inte lagen som övade.
      if (s.practice) { s.practice = null; beginRound(room, rng); }
      s.startedAt = null;
      s.endsAt = null;
      s.step = 'final';
      return null;
    }
    case 'swapTask': {
      if (!ctx.isAdmin) return 'bara värden får byta uppdrag';
      if (s.practice) return 'övningsronden har ett fast uppdrag. Hoppa över den i stället';
      if (s.step !== 'intro') return 'uppdraget kan bara bytas innan budgivningen';
      s.tasks[s.round] = pickTask(s.kinds[s.round], room.settings, [...s.tasks, ...(room.settings?.practice !== false ? [PRACTICE_TASK] : [])], rng);
      beginRound(room, rng);
      return null;
    }
    case 'finalResult': {
      if (!ctx.isAdmin) return 'bara värden avgör finalen';
      if (s.step !== 'final') return 'finalen pågår inte';
      if (msg.success) {
        s.final.success = true;
        s.step = 'end';
      } else {
        s.final.tries += 1;
      }
      return null;
    }
    case 'endGame': {
      if (!ctx.isAdmin) return 'bara värden får avsluta';
      room.phase = 'lobby';
      room.syna = null;
      return null;
    }
    default:
      return 'okänt meddelande';
  }
}

// Klockan: servern avslutar själv tiden när den gått ut.
export function tick(room, now = Date.now()) {
  const s = room.syna;
  if (!s || s.step !== 'play' || now < s.endsAt) return false;
  endPlay(room);
  return true;
}

function standings(room) {
  const s = room.syna;
  const rows = room.teams.map((t) => ({ team: t.id, score: s.scores[t.id] ?? 0, records: s.recordsSet[t.id] ?? 0 }));
  rows.sort((x, y) => y.score - x.score || y.records - x.records);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.place = prev && prev.score === r.score && prev.records === r.records ? prev.place : i + 1;
  });
  return rows;
}

// Det en viss enhet får se av spelet. Här hålls buden hemliga tills båda är låsta,
// synen tills alla har valt, och ställningen under sista varvet.
// Underlag för värdens nödutgång: hur många ronder som är räknade, om alla lag då har tävlat lika många
// gånger, och efter vilken rond det blir jämnt nästa gång. Räknas ur det verkliga schemat.
export function fairness(s) {
  const played = s.practice ? 0 : s.round + (s.step === 'score' ? 1 : 0);
  const count = Object.fromEntries(Object.keys(s.scores).map((id) => [id, 0]));
  const level = () => new Set(Object.values(count)).size === 1;
  let even = true;
  let next = null;
  s.schedule.forEach((pair, i) => {
    for (const t of pair) count[t] += 1;
    if (i + 1 === played) even = level();
    if (i + 1 > played && next === null && level()) next = i + 1;
  });
  return { played, even, next };
}

export function view(room, ctx) {
  const s = room.syna;
  if (!s) return null;
  const task = taskOf(s);
  const duel = duelOf(s);
  const watchers = watchersOf(room);
  const own = ctx.device?.role === 'team' ? ctx.device.team : null;
  const isJudge = ctx.isAdmin || ctx.device?.role === 'judge';
  const bidsShown = !['intro', 'bid'].includes(s.step);
  const callsShown = !['intro', 'bid', 'call'].includes(s.step);
  // Ställningen är dold under sista varvet och under finalen, också när värden gått dit i förtid.
  const hidden = (s.round >= s.hideFrom || s.step === 'final') && s.step !== 'end';

  const bids = {};
  for (const t of duel) {
    bids[t] = { locked: s.bids[t].locked, value: bidsShown || ctx.isAdmin || own === t ? s.bids[t].value : null };
  }
  const calls = {};
  for (const w of watchers) {
    const c = s.calls[w] ?? null;
    calls[w] = callsShown || ctx.isAdmin || own === w ? c : (c ? 'hidden' : null);
  }
  const { prompts, topics, ...publicTask } = task;
  const out = {
    round: s.round,
    rounds: s.schedule.length,
    practice: Boolean(s.practice),
    step: s.step,
    duel,
    watchers,
    task: publicTask,
    topic: s.topic,
    double: s.doubleFrom !== null && s.round >= s.doubleFrom,
    hidden,
    bids,
    calls,
    order: s.order,
    turn: s.turn,
    performing: s.step === 'play' ? performing(s, task) : [],
    endsAt: s.endsAt,
    results: s.results,
    made: s.made,
    points: s.points,
    newRecord: s.newRecord,
    record: s.practice ? null : room.records[task.id] ?? null,
    scores: hidden && !ctx.isAdmin ? null : s.scores,
    final: { ...finalById(s.final.task), tries: s.final.tries, success: s.final.success },
  };
  if (isJudge && s.notes) out.notes = s.notes;
  // Vad ett ångrande leder tillbaka till. Bara steget lämnas ut, aldrig det sparade läget.
  const last = Array.isArray(s.history) ? s.history.at(-1) : null;
  if (isJudge && last?.syna) out.back = { step: last.syna.step, round: last.syna.round };
  // Nödutgången visas så länge det finns ronder kvar att stryka.
  if (ctx.isAdmin && !['final', 'end'].includes(s.step)) {
    const fair = fairness(s);
    if (fair.played < s.schedule.length) out.fair = fair;
  }
  if (s.step === 'end') out.standings = standings(room);
  return out;
}
