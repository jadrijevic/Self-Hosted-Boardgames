// Masstest av spellogiken: tusentals kvällar där allt som kan gå snett går snett.
//
// Slumpprovet i test/fuzz.test.js kräver bara att inget kastar. Här kontrolleras också att spelet
// fortfarande är rätt: att hemligheter förblir hemliga, att poängen stämmer, att det sparade läget
// går att läsa tillbaka och att värden alltid kan ta kvällen i mål, vad de andra än har gjort.
//
// Varje kväll har 2–6 lag och en egen blandning av folk som krånglar: lag som inte svarar, mobiler
// som lämnar och byter lag, någon som tjuvkikar på motståndarens bud, en obehörig kontrollant,
// en värd som trycker fel och ångrar, omstarter av servern mitt i ett steg och klockor som hoppar.
//
//   node tools/storm/scenarios.js [antal kvällar] [frö]      (standard 400 kvällar, frö 1)
//
// Skriver en sammanställning och avslutar med 1 om någon kontroll föll.

import { pathToFileURL } from 'node:url';
import { newRoom, addDevice, apply, viewFor, normalize, tick } from '../../server/room.js';
import { taskById } from '../../games/syna/tasks.js';
import { stage as stageHtml, player as playerHtml, admin as adminHtml } from '../../public/syna.js';

const STEPS = ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end'];

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Värden ensam tar spelet i mål från vilket läge som helst. Returnerar antalet tryck, eller null om det inte gick.
export function hostFinishes(room, now, rnd, limit = 200) {
  for (let i = 0; i < limit; i++) {
    const s = room.syna;
    if (room.phase !== 'game' || !s) return null;
    if (s.step === 'end') return i;
    const admin = (msg) => apply(room, null, msg, true, now + i, rnd);
    if (s.step === 'bid') {
      const open = s.schedule[s.round].find((t) => !s.bids[t].locked);
      admin(open ? { t: 'lockBid', team: open } : { t: 'next' });
    } else if (s.step === 'final') admin({ t: 'finalResult', success: true });
    else admin({ t: 'next' });
  }
  return null;
}

export function runEvening(seed, report) {
  const rnd = rng32(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const chance = (p) => rnd() < p;
  const fail = (type, detail) => {
    const v = report.violations[type] ??= { count: 0, examples: [] };
    v.count += 1;
    if (v.examples.length < 3) v.examples.push({ seed, step: room.syna?.step ?? room.phase, round: room.syna?.round, detail });
  };

  let now = 1_700_000_000_000;
  let room = newRoom(2 + Math.floor(rnd() * 5));
  const devices = []; // { token, kind: 'team' | 'audience' | 'judge', team, absent }
  let nextId = 0;
  const join = (role, team) => {
    const token = `tok-${nextId}`;
    addDevice(room, token, `dev-${nextId++}`);
    apply(room, token, { t: 'choose', role, team }, false, now, rnd);
    const d = { token, home: team ?? null };
    devices.push(d);
    return d;
  };
  for (const t of room.teams) {
    join('team', t.id).absent = chance(0.12);
    if (chance(0.3)) join('team', t.id);
  }
  for (let i = Math.floor(rnd() * 4); i > 0; i--) join('audience');
  const judges = chance(0.15) ? 0 : chance(0.85) ? 1 : 2;
  for (let i = 0; i < judges; i++) join('judge');
  // Hur mycket som krånglar i kväll.
  const chaos = pick([0, 0.05, 0.15, 0.35]);
  const cheater = chance(0.3) ? pick(devices) : null;

  // Varje meddelande följs av alla kontroller, så att inget steg passerar osett.
  let check = () => {};
  const send = (token, msg, isAdmin = false) => {
    report.sent += 1;
    let error;
    try {
      error = apply(room, token, msg, isAdmin, now, rnd);
    } catch (e) {
      fail('spellogiken kastade', `${JSON.stringify(msg)}: ${e.message}`);
      return 'kastade';
    }
    check();
    return error;
  };
  const admin = (msg) => send(null, msg, true);
  const dev = (d) => room.devices[d.token];
  const phoneOf = (team) => devices.find((d) => dev(d)?.role === 'team' && dev(d).team === team && !d.absent);
  const judge = () => devices.find((d) => dev(d)?.role === 'judge');

  admin({ t: 'start' });
  let game = room.syna;
  let ledger = {};
  const sawBid = new Map(); // token -> lag vars bud mobilen har fått se under den här budgivningen
  let bidKey = '';
  let waited = 0;

  check = (msg) => {
    const s = room.syna;
    if (room.phase !== 'game' || !s) { game = null; ledger = {}; return; }
    if (s !== game) { game = s; ledger = {}; }
    report.steps[s.step] = (report.steps[s.step] ?? 0) + 1;
    const task = taskById(s.tasks[s.round]);
    const duel = s.schedule[s.round] ?? [];
    const ids = room.teams.map((t) => t.id);

    // Läget hänger ihop.
    if (!STEPS.includes(s.step)) fail('okänt steg', s.step);
    if (!task) return fail('okänt uppdrag', String(s.tasks[s.round]));
    if (duel.length !== 2 || !duel.every((t) => ids.includes(t))) fail('duellen har lag som inte finns', duel.join(','));
    if ((s.step === 'play') !== (s.endsAt != null)) fail('klockan går utanför ett försök, eller står still under ett', `${s.step}, endsAt ${s.endsAt}`);
    if (![0, 1].includes(s.turn) || [...s.order].sort().join() !== [...duel].sort().join()) fail('turordningen stämmer inte med duellen', `${s.order} / ${duel}`);
    if ((s.history?.length ?? 0) > 6) fail('historiken växer', String(s.history.length));
    for (const t of duel) {
      const { value } = s.bids[t] ?? {};
      if (!(value >= task.bid.min && value <= task.bid.max) || (value - task.bid.min) % task.bid.step !== 0) fail('bud utanför uppdragets gränser', `${task.id}: ${value}`);
      const r = s.results[t];
      if (r != null && (!Number.isFinite(r) || r < 0)) fail('resultat som inte är ett tal', `${task.id}: ${r}`);
      if (r != null && task.measure === 'time' && r > task.seconds) fail('tid längre än uppdragets tid', `${task.id}: ${r} s av ${task.seconds}`);
      if (r != null && task.measure === 'count' && !Number.isInteger(r)) fail('räkning som inte är ett heltal', `${task.id}: ${r}`);
    }
    for (const [id, p] of Object.entries(s.scores)) {
      if (!Number.isFinite(p) || (p * 2) % 1 !== 0) fail('poäng som inte är hela eller halva', `${id}: ${p}`);
    }
    for (const [id, rec] of Object.entries(room.records)) {
      const t = taskById(id);
      if (!t || !Number.isFinite(rec.value) || rec.value < 0 || (t.measure === 'time' && rec.value > t.seconds)) fail('orimligt rekord i rekordboken', `${id}: ${rec.value}`);
    }

    // Poängen är summan av rondernas poäng.
    if (['score', 'final', 'end'].includes(s.step) && s.points) ledger[s.round] = { ...s.points };
    const expected = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const [r, pts] of Object.entries(ledger)) {
      if (Number(r) < s.round || ['score', 'final', 'end'].includes(s.step)) for (const [id, p] of Object.entries(pts)) expected[id] = (expected[id] ?? 0) + p;
    }
    if (!msg?.skipLedger && ids.some((id) => (s.scores[id] ?? 0) !== expected[id])) fail('ställningen är inte summan av rondernas poäng', `${JSON.stringify(s.scores)} mot ${JSON.stringify(expected)}`);

    // Hemligheter: ingen mobil får se båda lagens bud under samma budgivning, kontrollantens lappar eller historiken.
    const key = `${s.round}|${s.tasks[s.round]}`;
    if (s.step !== 'bid' || key !== bidKey) { sawBid.clear(); bidKey = s.step === 'bid' ? key : ''; }
    const secrets = s.notes ? Object.values(s.notes) : [];
    for (const d of devices) {
      const view = viewFor(room, d.token, 'player');
      const g = view.syna;
      const role = dev(d)?.role;
      const text = JSON.stringify(view);
      if (text.includes('"history"')) fail('historiken når en mobil', d.token);
      if (role !== 'judge' && secrets.some((n) => text.includes(n))) fail('kontrollantens lapp når en mobil som inte är kontrollant', `${role}`);
      if (s.step === 'bid' && bidKey) {
        const seen = sawBid.get(d.token) ?? new Set();
        for (const t of duel) if (g.bids[t].value !== null && (s.bids[t].locked || s.bids[t].value !== task.bid.start)) seen.add(t);
        sawBid.set(d.token, seen);
        if (seen.size === 2) fail('en mobil har sett båda lagens hemliga bud', `${d.token} (${role} ${dev(d)?.team ?? ''})`);
      }
      if (g.hidden && g.scores !== null) fail('ställningen visas fast den ska vara dold', d.token);
    }
    const stage = JSON.stringify(viewFor(room, null, 'stage'));
    if (stage.includes('"history"') || secrets.some((n) => stage.includes(n))) fail('en hemlighet når storbilden', '');

    if (s.step === 'end') {
      const rows = viewFor(room, null, 'stage').syna.standings;
      const top = Math.max(...Object.values(s.scores));
      if (rows[0].score !== top || rows.some((r, i) => i && r.score > rows[i - 1].score)) fail('slutställningen är inte i ordning', JSON.stringify(rows));
    }

    // Sidorna går att rita i varje läge, och ett lagnamn med taggar blir aldrig HTML.
    if (report.sent % 7 === 0) {
      try {
        const html = stageHtml(viewFor(room, null, 'stage'), now) + adminHtml(viewFor(room, null, 'admin'), now, '') + devices.slice(0, 3).map((d) => playerHtml(viewFor(room, d.token, 'player'), now)).join('');
        if (html.includes('<b>Fet')) fail('ett lagnamn blir HTML på en sida', '');
        if (/\bundefined\b|\bNaN\b|\[object/.test(html.replace(/<[^>]*>/g, ' '))) fail('en sida visar undefined, NaN eller ett objekt', html.replace(/<[^>]*>/g, ' ').match(/.{0,40}(undefined|NaN|\[object).{0,40}/)?.[0]);
      } catch (e) {
        fail('en sida gick inte att rita', e.message);
      }
    }
  };

  // Servern startas om: det sparade läget ska ge exakt samma bild för alla.
  function restart() {
    const before = devices.map((d) => JSON.stringify(viewFor(room, d.token, 'player')));
    const adminBefore = JSON.stringify(viewFor(room, null, 'admin'));
    room = normalize(JSON.parse(JSON.stringify(room)));
    game = room.syna;
    const after = devices.map((d) => JSON.stringify(viewFor(room, d.token, 'player')));
    if (before.some((b, i) => b !== after[i]) || adminBefore !== JSON.stringify(viewFor(room, null, 'admin'))) fail('läget ändras av att sparas och läsas', '');
    report.restarts += 1;
  }

  function trouble() {
    const s = room.syna;
    const d = pick(devices);
    const teams = room.teams.map((t) => t.id);
    const kind = pick(['leave', 'switch', 'judge', 'rogue', 'spam', 'mistap', 'undo', 'kick', 'rename', 'lobbyOnly', 'restart', 'clock', 'newPhone', 'swap']);
    report.trouble[kind] = (report.trouble[kind] ?? 0) + 1;
    if (kind === 'leave') { send(d.token, { t: 'leave' }); if (chance(0.7)) send(d.token, { t: 'choose', role: d.home ? 'team' : 'audience', team: d.home }); }
    else if (kind === 'switch') send(d.token, { t: 'choose', role: 'team', team: pick(teams) });
    else if (kind === 'judge') send(d.token, { t: 'choose', role: 'judge' });
    else if (kind === 'rogue') {
      const who = judge() ?? d;
      const team = pick(s?.schedule?.[s.round] ?? teams);
      send(who.token, pick([{ t: 'next' }, { t: 'count', team, delta: pick([1, -1]) }, { t: 'stop', team }, { t: 'setResult', team, value: pick([0, 0.1, 59, 9999, 1e9, null]) }, { t: 'undo', step: s?.step }]));
    } else if (kind === 'spam') send(d.token, pick([{ t: 'next' }, { t: 'lockBid' }, { t: 'bid', value: pick([-5, 0, 3.7, 1e6]) }, { t: 'call', target: pick([...teams, 'pass']) }, { t: 'start' }, { t: 'endGame' }, { t: 'swapTask' }, { t: 'finalResult', success: true }, { t: 'undo' }]));
    else if (kind === 'mistap') { admin({ t: 'next' }); if (chance(0.5)) admin({ t: 'next' }); }
    else if (kind === 'undo') { if (admin({ t: 'undo' }) === null) report.undone += 1; }
    else if (kind === 'kick') admin({ t: 'kick', device: dev(d)?.id });
    else if (kind === 'rename') admin({ t: 'renameTeam', team: pick(teams), name: pick(['Mormors gäng', 'X', '  ', 'A'.repeat(40), '<b>Fet</b>']) });
    else if (kind === 'lobbyOnly') admin(pick([{ t: 'setTeamCount', count: pick([2, 3, 6]) }, { t: 'setMaterial', on: chance(0.5) }, { t: 'setLong', on: chance(0.5) }, { t: 'start' }]));
    else if (kind === 'restart') restart();
    else if (kind === 'clock') { now += pick([0, 1000, 44_000, 200_000]); try { tick(room, now); } catch (e) { fail('klockan kastade', e.message); } check(); }
    else if (kind === 'newPhone') join('team', pick(teams));
    else if (kind === 'swap') admin({ t: 'swapTask' });
  }

  // Det som för kvällen framåt, gjort av dem som ska göra det. Den som inte svarar ersätts av värden efter en stund.
  function progress() {
    const s = room.syna;
    const task = taskById(s.tasks[s.round]);
    const duel = s.schedule[s.round];
    const j = judge();
    waited += 1;
    const late = waited > 6;
    if (s.step === 'intro' || s.step === 'score') admin({ t: 'next' });
    else if (s.step === 'bid') {
      const t = duel.find((id) => !s.bids[id].locked);
      const phone = phoneOf(t);
      const { min, max, step } = task.bid;
      const value = min + Math.floor(rnd() * ((max - min) / step + 1)) * step;
      if (phone) { send(phone.token, { t: 'bid', value }); send(phone.token, { t: 'lockBid' }); } else if (late) admin({ t: 'lockBid', team: t });
    } else if (s.step === 'call') {
      const w = room.teams.map((t) => t.id).find((id) => !duel.includes(id) && !s.calls[id]);
      const phone = phoneOf(w);
      if (phone) send(phone.token, { t: 'call', target: pick([...duel, 'pass']) }); else if (late) admin({ t: 'next' });
    } else if (s.step === 'ready') { if (j && !late) send(j.token, { t: 'next' }); else admin({ t: 'next' }); }
    else if (s.step === 'play') {
      const who = j && !late ? j.token : null;
      const act = (msg) => send(who, msg, who === null);
      now += 1000 + Math.floor(rnd() * 20_000);
      const active = task.mode === 'turns' ? [s.order[s.turn]] : duel;
      if (task.measure === 'count') { for (let i = Math.floor(rnd() * 8); i > 0; i--) act({ t: 'count', team: pick(active), delta: 1 }); if (chance(0.5)) act({ t: 'next' }); }
      else if (chance(0.7)) act({ t: 'stop', team: pick(active) });
      try { tick(room, now); } catch (e) { fail('klockan kastade', e.message); }
      check();
    } else if (s.step === 'result') { if (j && !late) send(j.token, { t: 'next' }); else admin({ t: 'next' }); }
    else if (s.step === 'final') admin({ t: 'finalResult', success: chance(0.6) });
  }

  let last = '';
  for (let i = 0; i < 600 && room.phase === 'game' && room.syna?.step !== 'end'; i++) {
    // Fuskaren byter till motståndarlaget mitt i budgivningen för att se deras bud.
    const s = room.syna;
    if (cheater && s.step === 'bid' && dev(cheater)?.role === 'team' && chance(0.4)) {
      const other = s.schedule[s.round].find((t) => t !== dev(cheater).team);
      if (s.schedule[s.round].includes(dev(cheater).team)) { send(cheater.token, { t: 'leave' }); send(cheater.token, { t: 'choose', role: 'team', team: other }); report.peeks += 1; }
    } else if (chance(chaos)) trouble();
    else progress();
    if (room.phase !== 'game') break;
    const at = `${room.syna.round}|${room.syna.step}|${room.syna.turn}`;
    if (at !== last) { last = at; waited = 0; }
    // Då och då: kan värden ensam ta kvällen i mål härifrån?
    if (i % 40 === 17) {
      const copy = normalize(JSON.parse(JSON.stringify(room)));
      if (hostFinishes(copy, now, rng32(seed + i)) === null) fail('värden kan inte ta spelet i mål', `rond ${room.syna.round}, steg ${room.syna.step}`);
      report.finishers += 1;
    }
  }
  if (room.phase === 'game' && room.syna.step === 'end') report.finished += 1;
  else if (room.phase === 'game') {
    if (hostFinishes(room, now, rnd) === null) fail('kvällen kom aldrig i mål', `rond ${room.syna.round}, steg ${room.syna.step}`);
    else { check({ skipLedger: true }); report.rescued += 1; }
  } else report.ended += 1;
}

export function runMany(evenings = 400, seed = 1) {
  const report = { evenings, seed, sent: 0, finished: 0, rescued: 0, ended: 0, restarts: 0, undone: 0, peeks: 0, finishers: 0, steps: {}, trouble: {}, violations: {} };
  for (let i = 0; i < evenings; i++) runEvening(seed * 100_003 + i, report);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = Date.now();
  const report = runMany(Number(process.argv[2]) || 400, Number(process.argv[3]) || 1);
  const kinds = Object.entries(report.violations).sort((a, b) => b[1].count - a[1].count);
  console.log(`${report.evenings} kvällar, ${report.sent} meddelanden, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`i mål av sig själva: ${report.finished} · i mål med värdens hjälp: ${report.rescued} · avslutade av någon: ${report.ended}`);
  console.log(`omstarter: ${report.restarts} · ångrade steg: ${report.undone} · tjuvkikar: ${report.peeks} · prov av att värden kan ta det i mål: ${report.finishers}`);
  console.log(`steg: ${STEPS.map((s) => `${s} ${report.steps[s] ?? 0}`).join(', ')}`);
  if (!kinds.length) console.log('Inga fel.');
  for (const [type, v] of kinds) {
    console.log(`\nFEL ${v.count} gånger: ${type}`);
    for (const e of v.examples) console.log(`    frö ${e.seed}, rond ${e.round}, steg ${e.step}: ${e.detail}`);
  }
  process.exit(kinds.length ? 1 : 0);
}
