// Spelteori och längd: tusentals kvällar genom den riktiga spellogiken, med lag som budar och synar på olika sätt.
//
// Frågorna är de som avgör om spelet håller som spel:
//   - Lönar det sig att buda fegt, eller att alltid syna? Då faller budgivningen ihop.
//   - Vinner det bästa laget oftare än de andra, men inte alltid?
//   - Hur ofta är kvällen avgjord före sista ronden, slutar oavgjord eller ger ett lag minuspoäng?
//   - Är schemat rättvist mellan lagen?
//   - Hur lång blir kvällen?
//   - Vad ändras om värden går till finalen i förtid?
//
// Lagens prestationer är antaganden, inte mätningar: ett lag presterar i snitt uppdragets startbud gånger
// lagets förmåga, med en spridning på 25 %, och vet sin egen nivå på 15 % när. Resultaten visar hur reglerna
// beter sig under de antagandena, inte hur svåra uppdragen är.
//
//   node tools/storm/balance.js [kvällar per uppställning]      (standard 1500)

import { newRoom, apply, viewFor } from '../../server/room.js';
import { TASKS, taskById } from '../../games/syna/tasks.js';
import { rng32 } from './scenarios.js';

const N = Number(process.argv[2]) || 1500;
const SPREAD = 0.25; // spridningen i ett lags prestation från gång till gång
const GUESS = 0.15; // hur fel ett lag har om sin egen nivå

const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const snap = (task, v) => Math.min(task.bid.max, Math.max(task.bid.min, task.bid.min + Math.round((v - task.bid.min) / task.bid.step) * task.bid.step));
// Sannolikheten att klara ett bud, som en utomstående bedömer den utan att känna lagets förmåga.
const phi = (x) => 0.5 * (1 + Math.sign(x) * Math.sqrt(1 - Math.exp((-2 * x * x) / Math.PI)));
const chanceToMake = (task, bid) => phi(((task.direction === 'low' ? Math.log(bid / task.bid.start) : Math.log(task.bid.start / bid))) / Math.hypot(SPREAD, 0.25));

// Hur ett lag budar: andelen av den egna förväntade nivån. "min" budar alltid lägsta möjliga.
const BIDS = { min: null, feg: 0.6, lagom: 0.85, djärv: 1.1 };
// Hur ett lag synar.
const CALLS = {
  aldrig: () => 'pass',
  // Synar det bud som ser svårast ut. Ser de lika svåra ut avgör slumpen, så att inget lag synas oftare för sin plats i schemat.
  alltid: (task, bids, duel, rnd) => {
    const [x, y] = duel.map((t) => chanceToMake(task, bids[t]));
    return x === y ? duel[rnd() < 0.5 ? 0 : 1] : duel[x < y ? 0 : 1];
  },
  // Synar bara om budet ser ut att klaras mindre än två gånger av tre. Där gick gränsen för att det lönade sig när fel syn kostade 1.
  kalkyl: (task, bids, duel, rnd) => { const t = CALLS.alltid(task, bids, duel, rnd); return chanceToMake(task, bids[t]) < 2 / 3 ? t : 'pass'; },
};

// Tiden en rond tar utöver själva försöket, i sekunder. Antaganden: uppläsning i 14 tecken per sekund plus 6 s,
// budgivning 30 s, syn 20 s, uppställning 15 s per försök, resultat 10 s, poäng 20 s.
const roundSeconds = (task, watchers) => (task.text.length + task.role.length) / 14 + 6 + 30 + (watchers ? 20 : 0)
  + (task.mode === 'turns' ? 2 : 1) * (15 + task.seconds * (task.measure === 'time' ? 0.7 : 1)) + 10 + 20;
const FINAL_SECONDS = 150;

// Regelvarianter som räknas vid sidan av de riktiga poängen, på samma bud, syner och resultat.
//   nu        reglerna som de är: fel syn kostar ingenting för den som synade. Det synade laget får 1
//   avdrag    regeln som gällde först: fel syn kostar den som synade 1
//   golv      som avdrag, men ett lags ställning kan aldrig gå under noll
const VARIANTS = { nu: { wrong: 0, floor: false }, avdrag: { wrong: -1, floor: false }, golv: { wrong: -1, floor: true } };
function variantPoints(rule, { direction, bids, made, calls, factor }) {
  const duel = Object.keys(bids);
  const points = Object.fromEntries([...duel, ...Object.keys(calls)].map((t) => [t, 0]));
  const ok = duel.filter((t) => made[t]);
  for (const t of ok) points[t] += 1;
  if (ok.length) {
    const bold = (t) => (direction === 'low' ? -bids[t] : bids[t]);
    const top = Math.max(...ok.map(bold));
    const boldest = ok.filter((t) => bold(t) === top);
    for (const t of boldest) points[t] += 2 / boldest.length;
  }
  for (const [caller, target] of Object.entries(calls)) {
    if (!(target in made)) continue;
    if (made[target]) { points[caller] += rule.wrong; points[target] += 1; } else points[caller] += 2;
  }
  for (const t of Object.keys(points)) points[t] *= factor;
  return points;
}

function evening(teams, profile, rnd) {
  const room = newRoom(teams);
  room.settings.practice = false; // övningsronden ger inga poäng och hör inte hit
  const admin = (msg) => apply(room, null, msg, true, 0, rnd);
  admin({ t: 'start' });
  const s = room.syna;
  const ids = room.teams.map((t) => t.id);
  const skill = Object.fromEntries(ids.map((id, i) => [id, profile[i].skill * Math.exp(0.2 * gauss(rnd))]));
  const style = Object.fromEntries(ids.map((id, i) => [id, profile[i]]));
  let seconds = FINAL_SECONDS;
  let callPoints = 0;
  let decidedEarly = false;
  const cuts = []; // ställning och längd om värden hade gått till finalen efter varje rond
  const totals = Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, Object.fromEntries(ids.map((id) => [id, 0]))]));
  const leader = {}; // per variant: laget som leder ensamt när sista ronden börjar, annars null
  for (let guard = 0; guard < 400 && s.step !== 'end'; guard++) {
    const task = taskById(s.tasks[s.round]);
    const duel = s.schedule[s.round];
    const low = task.direction === 'low';
    if (s.step === 'intro') {
      seconds += roundSeconds(task, ids.length > 2);
      // Är kvällen redan avgjord när sista ronden börjar? Högsta möjliga i en rond är 3 poäng plus 1 per fel syn mot en.
      if (s.round === s.schedule.length - 1) {
        const sorted = Object.values(s.scores).sort((x, y) => y - x);
        const factor = s.doubleFrom !== null && s.round >= s.doubleFrom ? 2 : 1;
        decidedEarly = sorted[0] - sorted[1] > (3 + (ids.length - 2)) * factor;
        for (const v of Object.keys(VARIANTS)) {
          const top = Math.max(...Object.values(totals[v]));
          const first = ids.filter((id) => totals[v][id] === top);
          leader[v] = first.length === 1 ? first[0] : null;
        }
      }
      admin({ t: 'next' });
    } else if (s.step === 'bid') {
      for (const t of duel) {
        const level = task.bid.start * (low ? 1 / skill[t] : skill[t]) * Math.exp(GUESS * gauss(rnd));
        const k = BIDS[style[t].bid];
        const value = k === null ? (low ? task.bid.max : task.bid.min) : snap(task, low ? level / k : level * k);
        admin({ t: 'bid', value, team: t });
        admin({ t: 'lockBid', team: t });
      }
    } else if (s.step === 'call') {
      const bids = Object.fromEntries(duel.map((t) => [t, s.bids[t].value]));
      for (const w of ids.filter((id) => !duel.includes(id))) admin({ t: 'call', target: CALLS[style[w].call](task, bids, duel, rnd), team: w });
    } else if (s.step === 'ready' || s.step === 'play') admin({ t: 'next' });
    else if (s.step === 'result') {
      for (const t of duel) {
        const done = task.bid.start * (low ? 1 / skill[t] : skill[t]) * Math.exp(SPREAD * gauss(rnd));
        admin({ t: 'setResult', team: t, value: low && done > task.seconds ? null : Math.max(0, done) });
      }
      admin({ t: 'next' });
      for (const [id, p] of Object.entries(s.points)) if (!duel.includes(id)) callPoints += Math.abs(p);
      const round = { direction: task.direction, bids: Object.fromEntries(duel.map((t) => [t, s.bids[t].value])), made: s.made, calls: s.calls, factor: s.doubleFrom !== null && s.round >= s.doubleFrom ? 2 : 1 };
      for (const [v, rule] of Object.entries(VARIANTS)) {
        for (const [id, p] of Object.entries(variantPoints(rule, round))) totals[v][id] = rule.floor ? Math.max(0, totals[v][id] + p) : totals[v][id] + p;
      }
    } else if (s.step === 'score') {
      cuts.push({ scores: { ...s.scores }, seconds });
      admin({ t: 'next' });
    } else if (s.step === 'final') admin({ t: 'finalResult', success: true });
  }
  const rows = viewFor(room, null, 'stage').syna.standings;
  if (ids.some((id) => totals.nu[id] !== s.scores[id])) throw new Error('varianten "nu" ska ge samma poäng som spelet');
  return { rows, scores: s.scores, seconds, callPoints, decidedEarly, ids, skill, totals, leader, cuts, schedule: s.schedule };
}

function study(teams, profile, label, variant = 'nu') {
  const rnd = rng32(teams * 7919 + label.length * 31);
  const out = { wins: profile.map(() => 0), score: profile.map(() => 0), ties: 0, negative: 0, zero: 0, early: 0, bestWins: 0, minutes: [], callShare: 0, margin: 0, led: 0, leaderWins: 0 };
  for (let i = 0; i < N; i++) {
    // Lagen byter plats i schemat varje kväll, så att sättet att spela inte blandas ihop med platsen.
    const order = profile.map((p, k) => k).sort(() => rnd() - 0.5);
    const e = evening(teams, order.map((k) => profile[k]), rnd);
    const total = e.totals[variant];
    const best1 = Math.max(...Object.values(total));
    const winners = e.ids.filter((id) => total[id] === best1);
    if (winners.length > 1) out.ties += 1;
    e.ids.forEach((id, pos) => {
      const who = order[pos];
      out.score[who] += total[id];
      if (winners.includes(id)) out.wins[who] += 1 / winners.length;
    });
    if (Object.values(total).some((p) => p < 0)) out.negative += 1;
    if (Object.values(total).some((p) => p <= 0)) out.zero += 1;
    if (e.leader[variant]) { out.led += 1; if (winners.includes(e.leader[variant])) out.leaderWins += 1 / winners.length; }
    if (e.decidedEarly) out.early += 1;
    const best = e.ids.reduce((x, y) => (e.skill[x] >= e.skill[y] ? x : y));
    if (winners.includes(best)) out.bestWins += 1 / winners.length;
    // Finalen i förtid: ledarna efter varje rond, jämförda med vinnarna efter hela kvällen. Finalen ger inga poäng,
    // så ställningen efter rond k är slutställningen om värden går till finalen där.
    out.schedule ??= e.schedule;
    out.cuts ??= e.cuts.map(() => ({ same: 0, best: 0, ties: 0, minutes: 0 }));
    e.cuts.forEach((c, k) => {
      const top = Math.max(...Object.values(c.scores));
      const lead = e.ids.filter((id) => c.scores[id] === top);
      out.cuts[k].same += lead.filter((id) => winners.includes(id)).length / lead.length;
      if (lead.includes(best)) out.cuts[k].best += 1 / lead.length;
      if (lead.length > 1) out.cuts[k].ties += 1;
      out.cuts[k].minutes += c.seconds / 60;
    });
    out.minutes.push(e.seconds / 60);
    const sum = Object.values(e.scores).reduce((x, y) => x + Math.abs(y), 0);
    out.callShare += sum ? e.callPoints / sum : 0;
    out.margin += best1 - Math.min(...Object.values(total));
  }
  return out;
}

const pct = (x) => `${Math.round(100 * x)} %`;
const same = (teams, bid = 'lagom', call = 'kalkyl') => Array.from({ length: teams }, () => ({ bid, call, skill: 1 }));

console.log(`${N} kvällar per uppställning, genom den riktiga spellogiken.\n`);
console.log('1. Kvällen i stort, när alla lag budar lagom och synar när det lönar sig');
console.log('   lag  ronder  minuter (snitt, 90 % under)  oavgjort i topp  något lag på minus  avgjort före sista ronden  bästa laget vinner  poäng från syn  skillnad etta–sist');
const overall = {};
for (const teams of [2, 3, 4, 5, 6]) {
  const r = study(teams, same(teams), 'lika');
  overall[teams] = r;
  const rounds = (() => { const room = newRoom(teams); room.settings.practice = false; apply(room, null, { t: 'start' }, true, 0, rng32(1)); return room.syna.schedule.length; })();
  const m = [...r.minutes].sort((x, y) => x - y);
  console.log(`   ${teams}    ${rounds}       ${(m.reduce((x, y) => x + y, 0) / N).toFixed(1)}, ${m[Math.floor(N * 0.9)].toFixed(1)}`.padEnd(46)
    + `${pct(r.ties / N)}`.padEnd(17) + `${pct(r.negative / N)}`.padEnd(20) + `${pct(r.early / N)}`.padEnd(26) + `${pct(r.bestWins / N)} (slump ${pct(1 / teams)})`.padEnd(20) + `${pct(r.callShare / N)}`.padEnd(16) + `${(r.margin / N).toFixed(1)}`);
}

console.log('\n2. Ett lag spelar annorlunda än de andra tre (fyra lag, lika skickliga). Andel vinster, 25 % är jämnt');
for (const [label, odd] of [['budar alltid lägsta möjliga', { bid: 'min', call: 'kalkyl' }], ['budar fegt (60 % av sin nivå)', { bid: 'feg', call: 'kalkyl' }], ['budar djärvt (110 % av sin nivå)', { bid: 'djärv', call: 'kalkyl' }],
  ['synar aldrig', { bid: 'lagom', call: 'aldrig' }], ['synar alltid', { bid: 'lagom', call: 'alltid' }]]) {
  const r = study(4, [{ ...odd, skill: 1 }, ...same(3)], label);
  console.log(`   ${label.padEnd(34)} vinner ${pct(r.wins[0] / N).padEnd(6)} snittpoäng ${(r.score[0] / N).toFixed(1)} mot de andras ${((r.score[1] + r.score[2] + r.score[3]) / 3 / N).toFixed(1)}`);
}

console.log('\n3. Ett lag är bättre eller sämre än de andra tre (fyra lag, alla budar lagom). Andel vinster, 25 % är jämnt');
for (const skill of [0.6, 0.8, 1.25, 1.3, 1.5]) {
  const r = study(4, [{ bid: 'lagom', call: 'kalkyl', skill }, ...same(3)], `skill${skill}`);
  console.log(`   laget presterar ${String(Math.round(skill * 100)).padStart(3)} % av de andras nivå: vinner ${pct(r.wins[0] / N).padEnd(6)} snittpoäng ${(r.score[0] / N).toFixed(1)} mot ${((r.score[1] + r.score[2] + r.score[3]) / 3 / N).toFixed(1)}`);
}

console.log('\n4. Är schemat rättvist? Snittpoäng per plats i schemat när alla spelar likadant');
for (const teams of [3, 4, 5, 6]) {
  const rnd = rng32(teams);
  const sum = Array.from({ length: teams }, () => 0);
  for (let i = 0; i < N; i++) { const e = evening(teams, same(teams), rnd); e.ids.forEach((id, k) => { sum[k] += e.scores[id]; }); }
  const avg = sum.map((x) => x / N);
  console.log(`   ${teams} lag: ${avg.map((x) => x.toFixed(2)).join('  ')}   (största skillnad ${(Math.max(...avg) - Math.min(...avg)).toFixed(2)})`);
}

console.log('\n5. Regelvarianter, räknade på samma kvällar. nu: fel syn kostar inget. avdrag: fel syn kostar 1. golv: som avdrag, men ställningen går aldrig under noll');
console.log('   lag  variant  något lag på minus  något lag på noll eller under  ledaren före sista ronden vinner  bästa laget vinner  skillnad etta–sist');
for (const teams of [3, 4, 5, 6]) {
  for (const v of Object.keys(VARIANTS)) {
    const r = study(teams, same(teams), 'lika', v);
    console.log(`   ${teams}    ${v.padEnd(8)} ${pct(r.negative / N).padEnd(19)} ${pct(r.zero / N).padEnd(30)} ${pct(r.leaderWins / Math.max(1, r.led)).padEnd(33)} ${pct(r.bestWins / N).padEnd(19)} ${(r.margin / N).toFixed(1)}`);
  }
}
console.log('   Lönar det sig att alltid syna, eller aldrig? Ett lag av fyra, andel vinster (25 % är jämnt)');
for (const v of Object.keys(VARIANTS)) {
  const always = study(4, [{ bid: 'lagom', call: 'alltid', skill: 1 }, ...same(3)], 'alltid', v);
  const never = study(4, [{ bid: 'lagom', call: 'aldrig', skill: 1 }, ...same(3)], 'aldrig', v);
  const all = study(4, same(4, 'lagom', 'alltid'), 'allaalltid', v);
  console.log(`   ${v.padEnd(6)} synar alltid: ${pct(always.wins[0] / N).padEnd(5)} synar aldrig: ${pct(never.wins[0] / N).padEnd(5)} om alla alltid synar: något lag på minus ${pct(all.negative / N)}, bästa laget vinner ${pct(all.bestWins / N)}`);
}

console.log('\n6. Längsta och kortaste rond, med antagandena om tid ovan');
const times = TASKS.filter((t) => !t.material).map((t) => [t.name, roundSeconds(t, true) / 60]).sort((x, y) => y[1] - x[1]);
console.log(`   längst: ${times.slice(0, 4).map(([n, m]) => `${n} ${m.toFixed(1)} min`).join(', ')}`);
console.log(`   kortast: ${times.slice(-3).map(([n, m]) => `${n} ${m.toFixed(1)} min`).join(', ')}`);

console.log('\n7. Värden går till finalen i förtid. Samma kvällar som i 1, brutna efter varje rond. Sista raden är hela kvällen');
console.log('   lag  efter rond  alla lag lika många dueller  minuter (snitt)  oavgjort i topp  bästa laget leder  ledaren vinner också hela kvällen');
for (const teams of [3, 4, 5, 6]) {
  const r = overall[teams];
  const count = {};
  r.cuts.forEach((c, k) => {
    for (const t of r.schedule[k]) count[t] = (count[t] ?? 0) + 1;
    const even = Object.keys(count).length === teams && new Set(Object.values(count)).size === 1;
    console.log(`   ${teams}    ${String(k + 1).padEnd(11)} ${(even ? 'ja' : 'nej').padEnd(28)} ${(c.minutes / N).toFixed(1).padEnd(16)} ${pct(c.ties / N).padEnd(16)} ${pct(c.best / N).padEnd(18)} ${pct(c.same / N)}`);
  });
}
