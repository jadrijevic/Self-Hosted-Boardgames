// Prov med riktiga WebSocket-klienter mot en riktig server på en ledig port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/server.js';

function client(port, hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const seen = [];
  const waiting = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    seen.push(m);
    for (const w of [...waiting]) if (w.test(m)) { waiting.splice(waiting.indexOf(w), 1); w.resolve(m); }
  });
  const next = (pred) => new Promise((resolve, reject) => {
    const w = { test: pred, resolve };
    waiting.push(w);
    setTimeout(() => reject(new Error('fick inget svar i tid')), 2000);
  });
  const ready = new Promise((resolve) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...hello })); resolve(); }));
  return { ws, seen, next, ready, send: (m) => ws.send(JSON.stringify(m)) };
}

const rod = (m) => m.t === 'state' && m.state.teams[0].devices;

test('lobbyn synkar mellan tv och mobil, och mobilen känns igen när den kommer tillbaka', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'boardgames-'));
  let app = await startServer({ port: 0, dataDir, adminPin: '4321' });
  try {
    const stage = client(app.port, { kind: 'stage' });
    await stage.ready;
    const first = await stage.next((m) => m.t === 'state');
    assert.equal(first.state.teams.length, 4);
    assert.equal(first.state.me, null);

    const phone = client(app.port, { kind: 'player' });
    const welcome = await phone.next((m) => m.t === 'welcome');
    assert.match(welcome.token, /^[0-9a-f]{32}$/);
    phone.send({ t: 'choose', role: 'team', team: 'rod' });
    const joined = await stage.next((m) => rod(m)?.length === 1 && rod(m)[0].online);
    const deviceId = joined.state.teams[0].devices[0].id;

    phone.ws.close();
    await stage.next((m) => rod(m)?.length === 1 && !rod(m)[0].online);

    const back = client(app.port, { kind: 'player', token: welcome.token });
    const mine = await back.next((m) => m.t === 'state' && m.state.me?.role === 'team');
    assert.equal(mine.state.me.id, deviceId);
    assert.equal(mine.state.me.team, 'rod');
    await stage.next((m) => rod(m)?.length === 1 && rod(m)[0].online);

    const wrong = client(app.port, { kind: 'admin', pin: '0000' });
    await wrong.next((m) => m.t === 'denied');
    back.send({ t: 'setTeamCount', count: 2 });
    await back.next((m) => m.t === 'error');

    const admin = client(app.port, { kind: 'admin', pin: '4321' });
    await admin.next((m) => m.t === 'state');
    admin.send({ t: 'setTeamCount', count: 3 });
    await stage.next((m) => m.t === 'state' && m.state.teams.length === 3);

    const ping = Date.now();
    back.send({ t: 'ping', c: ping });
    const pong = await back.next((m) => m.t === 'pong');
    assert.equal(pong.c, ping);
    assert.ok(Math.abs(pong.s - ping) < 1000);

    for (const c of [stage, back, wrong, admin]) c.ws.close();
  } finally {
    await app.close();
  }

  // Läget ligger på disk och överlever en omstart.
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'room.json'), 'utf8'));
  assert.equal(saved.teams.length, 3);
  assert.equal(Object.values(saved.devices).filter((d) => d.team === 'rod').length, 1);
  app = await startServer({ port: 0, dataDir, adminPin: '4321' });
  try {
    const stage = client(app.port, { kind: 'stage' });
    const again = await stage.next((m) => m.t === 'state');
    assert.equal(again.state.teams.length, 3);
    assert.equal(again.state.teams[0].devices.length, 1);
    assert.equal(again.state.teams[0].devices[0].online, false);
    stage.ws.close();
  } finally {
    await app.close();
  }
});

test('sidorna, QR-koden och hälsokollen svarar', async () => {
  const app = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'boardgames-')), publicUrl: 'https://syna.example.org' });
  try {
    const get = (p) => fetch(`http://127.0.0.1:${app.port}${p}`);
    for (const p of ['/', '/scen', '/admin']) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/);
    }
    assert.equal(await (await get('/halsa')).text(), 'ok');
    assert.equal(await (await get('/adress')).text(), 'https://syna.example.org');
    const qr = await get('/qr.svg');
    assert.match(qr.headers.get('content-type'), /svg/);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await get('/../package.json')).status, 404);
    assert.equal((await get('/finns-inte.html')).status, 404);
    assert.match(app.pin, /^\d{4}$/);
  } finally {
    await app.close();
  }
});

test('spelet startas av värden, och ett bud syns bara för det egna laget tills båda har låst', async () => {
  const app = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'boardgames-')), adminPin: '4321' });
  try {
    const phones = {};
    for (const team of ['rod', 'bla', 'gron', 'gul']) {
      phones[team] = client(app.port, { kind: 'player' });
      await phones[team].next((m) => m.t === 'welcome');
      phones[team].send({ t: 'choose', role: 'team', team });
      await phones[team].next((m) => m.t === 'state' && m.state.me?.team === team);
    }
    const admin = client(app.port, { kind: 'admin', pin: '4321' });
    await admin.next((m) => m.t === 'state');
    phones.rod.send({ t: 'start' });
    await phones.rod.next((m) => m.t === 'error');
    admin.send({ t: 'start' });
    const started = await admin.next((m) => m.t === 'state' && m.state.syna?.step === 'intro');
    const [a, b] = started.state.syna.duel;
    admin.send({ t: 'next' });
    await phones[a].next((m) => m.t === 'state' && m.state.syna?.step === 'bid');

    const { min, step } = started.state.syna.task.bid;
    phones[a].send({ t: 'bid', value: min + step });
    const own = await phones[a].next((m) => m.t === 'state' && m.state.syna.bids[a].value === min + step);
    assert.equal(own.state.syna.bids[b].value, null);
    phones[a].send({ t: 'lockBid' });
    const other = await phones[b].next((m) => m.t === 'state' && m.state.syna.bids[a].locked);
    assert.equal(other.state.syna.bids[a].value, null);
    phones[b].send({ t: 'lockBid' });
    const open = await phones[b].next((m) => m.t === 'state' && m.state.syna.step === 'call');
    assert.equal(open.state.syna.bids[a].value, min + step);
    for (const c of [...Object.values(phones), admin]) c.ws.close();
  } finally {
    await app.close();
  }
});

test('läget i korthet visar fas, anslutna och tid sedan senaste ändring, utan hemligheter', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'boardgames-'));
  const app = await startServer({ port: 0, dataDir, adminPin: '4321' });
  try {
    const lage = async () => (await fetch(`http://127.0.0.1:${app.port}/lage`)).json();
    assert.deepEqual(Object.keys(await lage()).sort(), ['idleSec', 'online', 'phase', 'v']);
    assert.equal((await lage()).phase, 'lobby');
    assert.equal((await lage()).online, 0);

    const admin = client(app.port, { kind: 'admin', pin: '4321' });
    await admin.next((m) => m.t === 'state');
    assert.equal((await lage()).online, 1);
    admin.send({ t: 'start' });
    await admin.next((m) => m.t === 'state' && m.state.phase === 'game');
    const now = await lage();
    assert.equal(now.phase, 'game');
    assert.ok(now.idleSec <= 1);
    assert.doesNotMatch(JSON.stringify(now), /4321|token/);
    admin.ws.close();
  } finally {
    await app.close();
  }
});

test('ett fel i spellogiken fäller inte servern', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'boardgames-'));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let ticks = 0;
  // En spellogik som går sönder på beställning: ett meddelande som kastar, och en klocka som kastar varannan gång.
  const logic = {
    apply(room, token, msg) {
      if (msg.t === 'krasch') throw new Error('trasig logik');
      return msg.t === 'nej' ? 'nej tack' : null;
    },
    tick() {
      ticks += 1;
      if (ticks % 2) throw new Error('trasig klocka');
      return false;
    },
  };
  const app = await startServer({ port: 0, dataDir, adminPin: '4321', logic });
  try {
    const phone = client(app.port, { kind: 'player' });
    await phone.next((m) => m.t === 'state');
    phone.send({ t: 'krasch' });
    assert.equal((await phone.next((m) => m.t === 'error')).error, 'serverfel, försök igen');
    phone.send({ t: 'nej' });
    assert.equal((await phone.next((m) => m.t === 'error' && m.error === 'nej tack')).error, 'nej tack');
    phone.send({ t: 'ping', c: 1 });
    await phone.next((m) => m.t === 'pong');
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(ticks >= 2, 'klockan går vidare efter ett fel');
    assert.equal(await (await fetch(`http://127.0.0.1:${app.port}/halsa`)).text(), 'ok');
    assert.ok(errors.some((e) => e.includes('Fel i spellogiken (krasch)')));
    assert.ok(errors.some((e) => e.includes('Fel i spelets klocka')));
    phone.ws.close();
  } finally {
    console.error = original;
    await app.close();
  }
});

test('ett sparat läge som inte går att läsa läggs undan i stället för att skrivas över', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'boardgames-'));
  writeFileSync(path.join(dataDir, 'room.json'), '{"records": {"djuren": {"value": 14}}, "teams": "trasigt"');
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  const app = await startServer({ port: 0, dataDir, adminPin: '4321' });
  try {
    const stage = client(app.port, { kind: 'stage' });
    const first = await stage.next((m) => m.t === 'state');
    assert.equal(first.state.phase, 'lobby');
    assert.equal(first.state.teams.length, 4);
    stage.ws.close();
    const aside = readdirSync(dataDir).filter((f) => f.startsWith('room.json.olasbar-'));
    assert.equal(aside.length, 1);
    assert.match(readFileSync(path.join(dataDir, aside[0]), 'utf8'), /"djuren": \{"value": 14\}/);
    assert.ok(errors.some((e) => e.includes('gick inte att läsa')));
  } finally {
    console.error = original;
    await app.close();
  }
});

test('typsnittet följer med appen och används av alla sidor', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'boardgames-'));
  const app = await startServer({ port: 0, dataDir, adminPin: '4321' });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const font = await fetch(`${base}/inter.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('cache-control'), /max-age=604800/);
    const bytes = Buffer.from(await font.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
    assert.ok(bytes.length > 30_000 && bytes.length < 120_000, `oväntad storlek: ${bytes.length}`);

    const css = await (await fetch(`${base}/style.css`)).text();
    assert.match(css, /@font-face\{font-family:Syna;src:url\(\/inter\.woff2\) format\("woff2"\);font-weight:100 900;/);
    assert.match(css, /body\{[^}]*font-family:Syna,/);
    for (const page of ['/', '/scen', '/admin']) {
      assert.match(await (await fetch(base + page)).text(), /<link rel="stylesheet" href="\/style\.css">/, page);
    }
    const license = await fetch(`${base}/inter-licens.txt`);
    assert.equal(license.status, 200);
    assert.match(await license.text(), /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.equal((await fetch(`${base}/style.css`)).headers.get('cache-control'), 'no-cache');
  } finally {
    await app.close();
  }
});
