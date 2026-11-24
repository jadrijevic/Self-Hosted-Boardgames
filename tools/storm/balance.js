// Spelteori och längd: tusentals kvällar genom den riktiga spellogiken, med lag som budar och synar på olika sätt.
//
// Frågorna är de som avgör om spelet håller som spel:
//   - Lönar det sig att buda fegt, eller att alltid syna? Då faller budgivningen ihop.
//   - Vinner det bästa laget oftare än de andra, men inte alltid?
//   - Hur ofta är kvällen avgjord före sista ronden, slutar oavgjord eller ger ett lag minuspoäng?
//   - Är schemat rättvist mellan lagen?
//   - Hur lång blir kvällen?
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
  // Synar bara om budet ser ut att klaras mindre än två gånger av tre. Där går gränsen för att det lönar sig.
  kalkyl: (task, bids, duel, rnd) => { const t = CALLS.alltid(task, bids, duel, rnd); return chanceToMake(task, bids[t]) < 2 / 3 ? t : 'pass'; },
};

// Tiden en rond tar utöver själva försöket, i sekunder. Antaganden: uppläsning i 14 tecken per sekund plus 6 s,
// budgivning 30 s, syn 20 s, uppställning 15 s per försök, resultat 10 s, poäng 20 s.
const roundSeconds = (task, watchers) => (task.text.length + task.role.length) / 14 + 6 + 30 + (watchers ? 20 : 0)
  + (task.mode === 'turns' ? 2 : 1) * (15 + task.seconds * (task.measure === 'time' ? 0.7 : 1)) + 10 + 20;
const FINAL_SECONDS = 150;

function evening(teams, profile, rnd) {
  const room = newRoom(teams);
  const admin = (msg) => apply(room, null, msg, true, 0, rnd);
  admin({ t: 'start' });
  const s = room.syna;
  const ids = room.teams.map((t) => t.id);
  const skill = Object.fromEntries(ids.map((id, i) => [id, profile[i].skill * Math.exp(0.2 * gauss(rnd))]));
  const style = Object.fromEntries(ids.map((id, i) => [id, profile[i]]));
  let seconds = FINAL_SECONDS;
  let callPoints = 0;
  let decidedEarly = false;
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
    } else if (s.step === 'score') admin({ t: 'next' });
    else if (s.step === 'final') admin({ t: 'finalResult', success: true });
  }
  const rows = viewFor(room, null, 'stage').syna.standings;
  return { rows, scores: s.scores, seconds, callPoints, decidedEarly, ids, skill };
}

function study(teams, profile, label) {
  const rnd = rng32(teams * 7919 + label.length * 31);
  const out = { wins: profile.map(() => 0), score: profile.map(() => 0), ties: 0, negative: 0, early: 0, bestWins: 0, minutes: [], callShare: 0, margin: 0 };
  for (let i = 0; i < N; i++) {
    // Lagen byter plats i schemat varje kväll, så att sättet att spela inte blandas ihop med platsen.
    const order = profile.map((p, k) => k).sort(() => rnd() - 0.5);
    const e = evening(teams, order.map((k) => profile[k]), rnd);
    const winners = e.rows.filter((r) => r.place === 1).map((r) => r.team);
    if (winners.length > 1) out.ties += 1;
    e.ids.forEach((id, pos) => {
      const who = order[pos];
      out.score[who] += e.scores[id];
      if (winners.includes(id)) out.wins[who] += 1 / winners.length;
    });
    if (Object.values(e.scores).some((p) => p < 0)) out.negative += 1;
    if (e.decidedEarly) out.early += 1;
    const best = e.ids.reduce((x, y) => (e.skill[x] >= e.skill[y] ? x : y));
    if (winners.includes(best)) out.bestWins += 1 / winners.length;
    out.minutes.push(e.seconds / 60);
    const total = Object.values(e.scores).reduce((x, y) => x + Math.abs(y), 0);
    out.callShare += total ? e.callPoints / total : 0;
    out.margin += e.rows[0].score - e.rows.at(-1).score;
  }
  return out;
}

const pct = (x) => `${Math.round(100 * x)} %`;
const same = (teams, bid = 'lagom', call = 'kalkyl') => Array.from({ length: teams }, () => ({ bid, call, skill: 1 }));

console.log(`${N} kvällar per uppställning, genom den riktiga spellogiken.\n`);
console.log('1. Kvällen i stort, när alla lag budar lagom och synar när det lönar sig');
console.log('   lag  ronder  minuter (snitt, 90 % under)  oavgjort i topp  något lag på minus  avgjort före sista ronden  bästa laget vinner  poäng från syn  skillnad etta–sist');
for (const teams of [2, 3, 4, 5, 6]) {
  const r = study(teams, same(teams), 'lika');
  const rounds = (() => { const room = newRoom(teams); apply(room, null, { t: 'start' }, true, 0, rng32(1)); return room.syna.schedule.length; })();
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
for (const skill of [0.6, 0.8, 1.25, 1.5]) {
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

console.log('\n5. Längsta och kortaste rond, med antagandena om tid ovan');
const times = TASKS.filter((t) => !t.material).map((t) => [t.name, roundSeconds(t, true) / 60]).sort((x, y) => y[1] - x[1]);
console.log(`   längst: ${times.slice(0, 4).map(([n, m]) => `${n} ${m.toFixed(1)} min`).join(', ')}`);
console.log(`   kortast: ${times.slice(-3).map(([n, m]) => `${n} ${m.toFixed(1)} min`).join(', ')}`);
