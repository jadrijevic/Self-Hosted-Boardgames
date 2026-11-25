// Händelseloggen: en rad per steg, byggd ur storbildens vy, och en sammanfattning av kvällen som text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logKey, logEntry } from '../server/room.js';
import { createLog, parse, evenings, summary } from '../server/log.js';
import { startServer } from '../server/server.js';
import { setup } from './helpers.js';

const START = Date.parse('2026-12-24T18:30:00Z'); // 19:30 i Sverige

// Ett rum där varje ändring går genom loggen, som i servern, men med en klocka som testet styr.
function logged(teams = 4, { practice = false } = {}) {
  const g = setup(teams, 3);
  g.room.settings.practice = practice;
  const lines = [];
  let last = logKey(g.room);
  let now = START;
  const note = (by) => {
    const key = logKey(g.room);
    if (key === last) return;
    last = key;
    lines.push(JSON.parse(JSON.stringify({ at: new Date(now).toISOString(), by, ...logEntry(g.room) })));
  };
  const admin = (msg, sec = 0) => { now += sec * 1000; const e = g.admin(msg); if (!e) note(msg.t); return e; };
  const as = (who, msg, sec = 0) => { now += sec * 1000; const e = g.as(who, msg); if (!e) note(msg.t); return e; };
  const text = () => lines.map((l) => `${JSON.stringify(l)}\n`).join('');
  return { g, lines, admin, as, text, get now() { return now; } };
}

// Spelar en rond med bestämda bud och resultat. Varje steg tar så många sekunder som anges.
function round(l, { bids, results, call = null }) {
  const s = l.g.room.syna;
  const [a, b] = s.practice ? s.practice.duel : s.schedule[s.round];
  const watchers = l.g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  assert.equal(l.admin({ t: 'next' }, 40), null); // uppläsningen tog 40 s
  l.as(a, { t: 'bid', value: bids[0] }, 10);
  l.as(b, { t: 'bid', value: bids[1] });
  l.as(a, { t: 'lockBid' }, 10);
  assert.equal(l.as(b, { t: 'lockBid' }, 10), null); // budgivningen tog 30 s
  watchers.forEach((w, i) => assert.equal(l.as(w, { t: 'call', target: i === 0 && call ? (call === 'a' ? a : b) : 'pass' }, 10), null));
  let guard = 0;
  while (s.step !== 'result') {
    assert.ok(guard++ < 6);
    if (s.step === 'ready') assert.equal(l.as('judge', { t: 'next' }, 15), null); // uppställningen tog 15 s
    else assert.equal(l.as('judge', { t: 'next' }, 20), null); // försöket avbröts efter 20 s
  }
  l.as('judge', { t: 'setResult', team: a, value: results[0] }, 5);
  l.as('judge', { t: 'setResult', team: b, value: results[1] });
  assert.equal(l.as('judge', { t: 'next' }, 5), null); // resultatet tog 10 s
  assert.equal(s.step, 'score');
  return { a, b, watchers };
}

test('loggen får en rad per steg, och ett hemligt bud står aldrig i den', () => {
  const l = logged(4);
  assert.equal(l.admin({ t: 'start' }), null);
  const s = l.g.room.syna;
  s.tasks[0] = 'kedjan'; // räknas, högst är bäst, ett lag i taget
  const [a, b] = s.schedule[0];
  l.admin({ t: 'swapTask' }); // ger ett nytt uppdrag och en rad till
  s.tasks[0] = 'kedjan';
  assert.equal(l.admin({ t: 'next' }), null);
  assert.equal(l.as(a, { t: 'bid', value: 9 }), null);
  assert.equal(l.as(a, { t: 'lockBid' }), null);
  // Budgivningen pågår: ett bud är lagt och låst, men loggen har bara steget.
  const bidLine = l.lines.at(-1);
  assert.deepEqual([bidLine.step, bidLine.by, bidLine.bids], ['bid', 'next', { [a]: null, [b]: null }]);
  assert.doesNotMatch(l.text(), /"bids":\{[^}]*\d/);
  assert.equal(l.as(b, { t: 'bid', value: 7 }), null);
  assert.equal(l.as(b, { t: 'lockBid' }), null);
  // Nu är buden visade för alla, och då står de i loggen. Synen är fortfarande hemlig.
  const callLine = l.lines.at(-1);
  assert.deepEqual([callLine.step, callLine.by, callLine.bids], ['call', 'lockBid', { [a]: 9, [b]: 7 }]);
  const [w1, w2] = l.g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  assert.equal(l.as(w1, { t: 'call', target: a }), null);
  assert.equal(l.lines.at(-1), callLine, 'en syn som inte avslutar steget ger ingen rad');
  assert.equal(l.as(w2, { t: 'call', target: 'pass' }), null);
  assert.deepEqual([l.lines.at(-1).step, l.lines.at(-1).calls], ['ready', { [w1]: a, [w2]: 'pass' }]);

  // Ingen rad innehåller en mobils token eller namn, och varje rad har det som behövs för att läsa den ensam.
  for (const line of l.lines) {
    assert.doesNotMatch(JSON.stringify(line), /tok-|dev-/);
    assert.deepEqual(Object.keys(line.teams).length, 4);
    assert.ok(line.at && line.game === 'syna' && line.phase === 'game' && line.taskName && Number.isFinite(line.startBid));
  }
  assert.deepEqual(l.lines.map((x) => `${x.by}:${x.step}`), ['start:intro', 'swapTask:intro', 'next:bid', 'lockBid:call', 'call:ready']);
});

test('sammanfattningen visar tid per steg, bud mot resultat och vad som hände under kvällen', () => {
  const l = logged(4, { practice: true });
  assert.equal(l.admin({ t: 'start' }), null);
  const s = l.g.room.syna;
  // Övningen: Masken, i sekunder med startbud 20, längst är bäst. Ena laget synas och missar.
  const p = round(l, { bids: [5, 10], results: [7, 5], call: 'b' });
  assert.equal(l.admin({ t: 'next' }, 25), null); // poängen visades i 25 s
  assert.equal(s.practice, null);

  // Rond 1 med ett bestämt uppdrag: Kedjan, startbud och gränser ur uppdraget.
  s.tasks[0] = 'kedjan';
  l.admin({ t: 'swapTask' }, 5);
  const swappedTo = s.tasks[0];
  s.tasks[0] = 'kedjan';
  const r1 = round(l, { bids: [10, 8], results: [12, 8] });
  // Värden ångrar poängen och godkänner igen: ronden ska stå en gång, med tiden från båda gångerna.
  assert.equal(l.admin({ t: 'undo', step: 'score' }, 10), null);
  assert.equal(s.step, 'result');
  assert.equal(l.as('judge', { t: 'next' }, 10), null);
  assert.equal(l.admin({ t: 'next' }, 20), null);

  // Rond 2 börjar, och sedan räcker inte tiden.
  assert.equal(l.admin({ t: 'next' }, 30), null);
  assert.equal(l.admin({ t: 'toFinal' }, 15), null);
  assert.equal(l.admin({ t: 'finalResult', success: false }, 60), null);
  assert.equal(l.admin({ t: 'finalResult', success: true }, 45), null);
  assert.equal(s.step, 'end');
  assert.equal(l.admin({ t: 'endGame' }, 600), null);

  const text = summary(l.text(), START + 3_600_000, 'Europe/Stockholm');
  const lag = (id) => l.g.room.teams.find((t) => t.id === id).name;
  assert.match(text, /^Händelselogg\nHämtad 2026-12-24 20:30\.\n1 kväll i loggen\.\nBara det som har visats på storbilden står här\. Rådata: \/logg\.jsonl\n/);
  assert.match(text, /Kvällen 2026-12-24, 19:30–19:\d\d, [\d,]+ min\. 4 lag: /);
  assert.match(text, /Övningsrond och 1 av 6 ronder räknade\. Final: lyckades på försök 2\./);
  assert.match(text, /Ångrat: 1\. Bytt uppdrag: 1 \(.+ i rond 1\)\. Till finalen i förtid: ja\. Omstarter av servern: 0\./);

  // Tiderna: övningen tog 40 s uppläsning, 30 s bud, 20 s syn (två lag tittar) och 25 s poäng.
  const times = text.slice(text.indexOf('Tid per steg'), text.indexOf('Bud och resultat'));
  const row = (key) => times.split('\n').find((x) => x.startsWith(`${key} `)).split(/\s{2,}/);
  if (process.env.VISA) console.log(text);
  const prov = row('övn');
  assert.deepEqual([prov[1], prov[2], prov[3], prov[4], prov[7], prov[8]], ['Masken', '0:40', '0:30', '0:20', '0:10', '0:25']);
  // Rond 1: resultatet tog 10 s första gången och 10 s efter ångrandet. Poängen visades 10 s och sedan 20 s.
  const one = row('1');
  assert.deepEqual([one[1], one[7], one[8]], ['Kedjan', '0:20', '0:30']);
  assert.ok(swappedTo);
  // Rond 2 hann bara börja: tiden står med, men inga bud.
  assert.deepEqual(row('2').slice(2, 5), ['0:30', '0:15', '–']);
  assert.deepEqual(row('final').at(-1), '1:45');

  // Bud och resultat. Övningens poäng står inom parentes.
  const facts = text.slice(text.indexOf('Bud och resultat'));
  assert.match(facts, new RegExp(`övn\\s+Masken\\s+20 sekunder\\s+${lag(p.a)}\\s+5\\s+7\\s+ja\\s+\\(3\\)\\s+–`));
  assert.match(facts, new RegExp(`${lag(p.b)}\\s+10\\s+5\\s+nej\\s+\\(0\\)\\s+${lag(p.watchers[0])} \\(rätt\\)`));
  assert.match(facts, new RegExp(`1\\s+Kedjan\\s+10 ord\\s+${lag(r1.a)}\\s+10\\s+12\\s+ja\\s+3\\s+–`));
  assert.match(facts, new RegExp(`${lag(r1.b)}\\s+8\\s+8\\s+ja\\s+1\\s+–`));
  assert.doesNotMatch(facts, /\n2\s/, 'en rond utan poäng står inte bland buden');
  // Buden mot startbudet: 5/20, 10/20, 10/10 och 8/10. Resultaten: 7/20, 5/20, 12/10 och 8/10.
  assert.match(text, /Buden: snitt 0,64 över 4 bud\. Klarade bud: 3 av 4\./);
  assert.match(text, /Resultaten: snitt 0,65 över 4 resultat\./);
  assert.match(text, /Slutställning: 1\. .+ 3 p, 2\. .+ 1 p, /);
});

test('loggen delas i kvällar, tål trasiga rader och säger när den är tom', () => {
  assert.match(summary('', START), /Inget spel är loggat än\./);
  // En tidszon som inte finns ger svensk tid i stället för ett fel.
  assert.match(summary('', START, 'Ingen/Zon'), /Hämtad 2026-12-24 19:30\./);
  assert.match(summary('', START, 'America/New_York'), /Hämtad 2026-12-24 13:30\./);
  const l = logged(3);
  l.admin({ t: 'start' });
  l.admin({ t: 'next' }, 30);
  l.admin({ t: 'endGame' }, 30);
  l.admin({ t: 'start' }, 3600);
  l.admin({ t: 'next' }, 20);
  const broken = `${l.text()}{"at":"2026-12-24T22:00:00Z","by":"next","pha`;
  assert.equal(parse(`inte json\n${broken}\n\n{"by":"utan tid"}\n`).length, l.lines.length);
  assert.deepEqual(evenings(parse(broken)).map((e) => e.length), [3, 2]);
  const text = summary(broken, START + 7_200_000);
  assert.match(text, /2 kvällar i loggen, den senaste först\./);
  // Den senaste kvällen står först, och den som avslutades i förtid säger det.
  assert.ok(text.indexOf('20:31') < text.indexOf('19:30'));
  assert.match(text, /0 av 6 ronder räknade\. Final: inte nådd\./);
});

test('servern skriver loggen bredvid det sparade läget och lämnar ut den som text', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logg-'));
  let app = await startServer({ port: 0, dataDir: dir, adminPin: '1234', pinDelay: 0 });
  const get = async (p) => { const r = await fetch(`http://127.0.0.1:${app.port}${p}`); return { status: r.status, type: r.headers.get('content-type'), sniff: r.headers.get('x-content-type-options'), cache: r.headers.get('cache-control'), text: await r.text() }; };
  const first = await get('/logg');
  assert.deepEqual([first.status, first.type, first.sniff, first.cache], [200, 'text/plain; charset=utf-8', 'nosniff', 'no-store']);
  assert.match(first.text, /Inget spel är loggat än\./);

  const host = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  const states = [];
  host.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === 'state') states.push(m.state); });
  await new Promise((resolve) => host.addEventListener('open', resolve));
  const until = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(ok()); };
  host.send(JSON.stringify({ t: 'hello', kind: 'admin', pin: '1234' }));
  host.send(JSON.stringify({ t: 'setPractice', on: false }));
  host.send(JSON.stringify({ t: 'start' }));
  host.send(JSON.stringify({ t: 'next' }));
  await until(() => states.at(-1)?.syna?.step === 'bid');
  const raw = await get('/logg.jsonl');
  assert.deepEqual([raw.status, raw.type], [200, 'text/plain; charset=utf-8']);
  assert.deepEqual(parse(raw.text).map((x) => `${x.by}:${x.phase}:${x.step ?? ''}`), ['serverStart:lobby:', 'start:game:intro', 'next:game:bid']);
  host.close();
  await app.close();
  assert.equal(readFileSync(path.join(dir, 'events.jsonl'), 'utf8'), raw.text, 'filen ligger bredvid room.json');
  assert.ok(existsSync(path.join(dir, 'room.json')));

  // Efter en omstart fortsätter samma fil, med en rad som säger att servern startade mitt i spelet.
  app = await startServer({ port: 0, dataDir: dir, adminPin: '1234', pinDelay: 0 });
  const after = parse((await get('/logg.jsonl')).text);
  assert.deepEqual(after.map((x) => x.by), ['serverStart', 'start', 'next', 'serverStart']);
  assert.deepEqual([after.at(-1).phase, after.at(-1).step], ['game', 'bid']);
  assert.match((await get('/logg')).text, /Omstarter av servern: 1\./);
  await app.close();

  // En fil som vuxit sig stor läggs undan vid start.
  writeFileSync(path.join(dir, 'events.jsonl'), `${'x'.repeat(5_000_001)}\n`);
  app = await startServer({ port: 0, dataDir: dir, adminPin: '1234', pinDelay: 0 });
  await app.close();
  assert.ok(existsSync(path.join(dir, 'events.1.jsonl')));
  assert.equal(parse(readFileSync(path.join(dir, 'events.jsonl'), 'utf8')).length, 1);
});

test('går loggen inte att skriva går spelet vidare ändå', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logg-'));
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    // En katalog där filen skulle ligga gör att varje skrivning misslyckas.
    const log = createLog(path.join(dir, 'finns-inte'));
    const l = logged(4);
    await log.boot(l.g.room, START);
    l.admin({ t: 'start' });
    log.note(l.g.room, 'start', START);
    l.admin({ t: 'next' });
    log.note(l.g.room, 'next', START);
    await log.flush();
    assert.equal(await log.raw(), '');
    assert.equal(errors.length, 1, 'felet sägs en gång, inte för varje rad');
    assert.match(errors[0], /Kunde inte skriva händelseloggen/);
  } finally {
    console.error = original;
  }
});
