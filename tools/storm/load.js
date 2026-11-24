// Laststorm mot en riktig server: det en illvillig eller trasig klient kan ställa till med över nätet.
//
// Startar servern som en egen process och går igenom, i tur och ordning:
//   1. sidorna under tryck                 5. skräp: för stora, binära och trasiga meddelanden
//   2. en storm av anslutningar            6. gissa värdens pinkod
//   3. platserna fylls av spökmobiler      7. en hel kväll medan andra bråkar
//   4. en flod av meddelanden              8. servern dödas mitt i spelet, gång på gång
//
//   node tools/storm/load.js            (tar ungefär en minut)
//
// Skriver mätvärden och en lista över det som inte höll. Avslutar med 1 om något inte höll.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PIN = '7391';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const findings = [];
const rows = [];
const row = (what, value) => { rows.push([what, value]); console.log(`  ${what.padEnd(58)} ${value}`); };
const finding = (text) => { findings.push(text); console.log(`  FYND    ${text}`); };
const pct = (list, p) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let child = null;
let port = 0;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'storm-'));
const base = () => `http://127.0.0.1:${port}`;
async function startServer() {
  child = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PIN: PIN }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.errors = '';
  child.stderr.on('data', (d) => { child.errors += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base()}/halsa`)).ok) return; } catch { /* inte uppe än */ }
    await sleep(50);
  }
  throw new Error('servern startade inte');
}
// Varje prov börjar med en nystartad server och tomt läge, så att det ena provet inte färgar det andra.
async function fresh() {
  if (child) { child.kill('SIGKILL'); await new Promise((resolve) => child.once('exit', resolve)); }
  rmSync(dataDir, { recursive: true, force: true });
  await startServer();
  const c = client();
  await c.wait((m) => m.t === 'welcome');
  return c;
}
const alive = async () => { try { return (await fetch(`${base()}/halsa`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
const rssMb = () => Math.round(Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, 'utf8'))?.[1] ?? 0) / 1024);

// En klient: ansluter, säger hej och samlar det som kommer.
function client(hello = { kind: 'player' }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, state: null, token: null, denied: false, errors: [], states: 0, waiters: [] };
  ws.on('error', () => {});
  c.open = new Promise((resolve) => { ws.on('open', () => { if (hello) ws.send(JSON.stringify({ t: 'hello', ...hello })); resolve(true); }); ws.on('close', () => resolve(false)); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') c.token = m.token;
    if (m.t === 'denied') c.denied = true;
    if (m.t === 'error') c.errors.push(m.error);
    if (m.t === 'state') { c.state = m.state; c.states += 1; }
    for (const w of [...c.waiters]) if (w.test(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); }
  });
  c.send = (m) => { if (ws.readyState === 1) ws.send(typeof m === 'string' || Buffer.isBuffer(m) ? m : JSON.stringify(m)); };
  c.wait = (test, ms = 5000) => new Promise((resolve) => { const w = { test, resolve }; c.waiters.push(w); setTimeout(() => resolve(null), ms); });
  c.ping = async () => { const t = performance.now(); c.send({ t: 'ping', c: 1 }); return (await c.wait((m) => m.t === 'pong', 10_000)) ? performance.now() - t : 10_000; };
  return c;
}
async function pingStats(c, n = 60, gap = 15) {
  const times = [];
  for (let i = 0; i < n; i++) { times.push(await c.ping()); await sleep(gap); }
  return { p50: pct(times, 0.5), p99: pct(times, 0.99) };
}
const ms = (x) => `${x.toFixed(1)} ms`;

// Värden spelar en hel kväll ensam över nätet: lägger bud och synar åt lagen och är kontrollant.
async function playEvening(admin, { until = 'end', limit = 400 } = {}) {
  for (let i = 0; i < limit; i++) {
    const s = admin.state;
    if (!s) { await sleep(20); continue; }
    if (s.phase !== 'game') admin.send({ t: 'start' });
    else {
      const g = s.syna;
      if (g.step === until) return true;
      if (g.step === 'bid') { const t = g.duel.find((id) => !g.bids[id].locked); admin.send(t ? { t: 'lockBid', team: t } : { t: 'next' }); }
      else if (g.step === 'final') admin.send({ t: 'finalResult', success: true });
      else if (g.step === 'end') return true;
      else admin.send({ t: 'next' });
    }
    const before = admin.states;
    for (let k = 0; k < 100 && admin.states === before; k++) await sleep(5);
  }
  return false;
}

async function main() {
  port = await freePort();
  const started = Date.now();
  let honest = await fresh();

  console.log('\n1. Sidorna under tryck');
  {
    const paths = ['/', '/scen', '/admin', '/start', '/style.css', '/syna.js', '/qr.svg', '/lage', '/inter.woff2'];
    const times = [];
    let bad = 0;
    const t0 = performance.now();
    const worker = async (n) => {
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        try { const r = await fetch(base() + paths[i % paths.length]); await r.arrayBuffer(); if (!r.ok) bad += 1; } catch { bad += 1; }
        times.push(performance.now() - t);
      }
    };
    await Promise.all(Array.from({ length: 50 }, () => worker(60)));
    const secs = (performance.now() - t0) / 1000;
    row('3 000 hämtningar, 50 åt gången', `${Math.round(3000 / secs)} per sekund, median ${ms(pct(times, 0.5))}, 99 % under ${ms(pct(times, 0.99))}`);
    if (bad) finding(`${bad} hämtningar misslyckades under tryck`);
  }

  const calm = await pingStats(honest);
  row('svarstid i lugn', `median ${ms(calm.p50)}, 99 % under ${ms(calm.p99)}`);

  console.log('\n2. En storm av anslutningar');
  let crowd = [];
  {
    const t0 = performance.now();
    crowd = Array.from({ length: 500 }, () => client());
    await Promise.all(crowd.map((c) => c.wait((m) => m.t === 'welcome' || m.t === 'error', 20_000)));
    const welcomed = crowd.filter((c) => c.token).length;
    row('500 mobiler ansluter samtidigt', `${welcomed} släpptes in på ${((performance.now() - t0) / 1000).toFixed(1)} s, serverns minne ${rssMb()} MB`);
    const busy = await pingStats(honest, 30);
    row('svarstid med 500 anslutna', `median ${ms(busy.p50)}, 99 % under ${ms(busy.p99)}`);
    if (busy.p99 > 500) finding(`svarstiden med 500 anslutna är ${ms(busy.p99)} i värsta fall`);
  }

  console.log('\n3. Platserna fylls av spökmobiler');
  honest = await fresh();
  {
    // En enda klient säger hej om och om igen och sätter sig i ett lag varje gång. Varje hej blir en ny mobil.
    const ghost = client(null);
    await ghost.open;
    for (let i = 0; i < 400; i++) { ghost.send({ t: 'hello', kind: 'player' }); ghost.send({ t: 'choose', role: 'team', team: 'rod' }); }
    const t0 = performance.now();
    const late = client();
    const answer = await late.wait((m) => m.t === 'welcome' || m.t === 'error', 30_000);
    row('tid tills servern svarar en ny mobil efter floden', `${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (performance.now() - t0 > 3000) finding(`efter 400 falska anslutningar från en enda klient får nästa mobil vänta ${((performance.now() - t0) / 1000).toFixed(1)} s på svar`);
    await sleep(400);
    const seats = (st) => st.teams.reduce((n, t) => n + t.devices.length, 0) + st.audience.length + st.judges.length;
    row('mobiler med plats efter 400 hej från en enda klient', String(seats(honest.state)));
    row('en ny mobil som kommer efteråt', answer?.t === 'welcome' ? 'släpps in' : `nekas: ${answer?.error ?? 'inget svar'}`);
    if (seats(honest.state) > 1 || answer?.t !== 'welcome') finding('en enda klient kan fylla platserna med spökmobiler, så att nya mobiler nekas tills värden nollställer kvällen');
    late.ws.close();
    ghost.ws.close();
    // Känd gräns, inget fynd: den som öppnar 300 egna förbindelser och sätter sig med var och en fyller platserna.
    const army = Array.from({ length: 300 }, () => client());
    await Promise.all(army.map((c) => c.wait((m) => m.t === 'welcome' || m.t === 'error', 20_000)));
    for (const c of army) c.send({ t: 'choose', role: 'audience' });
    await sleep(500);
    const shut = client();
    const reply = await shut.wait((m) => m.t === 'welcome' || m.t === 'error', 5000);
    row('känd gräns: 300 förbindelser som alla sätter sig', reply?.t === 'welcome' ? 'en ny mobil släpps in' : 'en ny mobil nekas tills värden nollställer kvällen');
    for (const c of [...army, shut]) c.ws.terminate();
  }

  console.log('\n4. En flod av meddelanden');
  honest = await fresh();
  {
    // Tjugo mobiler i publiken, som en vanlig kväll, och en som slutat läsa det servern skickar.
    const frozen = client();
    const flooders = Array.from({ length: 20 }, () => client());
    await Promise.all([frozen, ...flooders].map((c) => c.wait((m) => m.t === 'welcome')));
    for (const c of flooders) c.send({ t: 'choose', role: 'audience' });
    await sleep(300);
    const before = rssMb();
    frozen.ws._socket?.pause();
    const t0 = performance.now();
    const flood = (async () => {
      for (let i = 0; i < 1500; i++) { for (const c of flooders) c.send({ t: 'choose', role: 'audience' }); if (i % 50 === 0) await sleep(1); }
    })();
    const during = await pingStats(honest, 40, 25);
    await flood;
    const settle = performance.now();
    await honest.ping();
    row('30 000 giltiga meddelanden från 20 mobiler', `skickade på ${((performance.now() - t0) / 1000).toFixed(1)} s, servern ikapp efter ${((performance.now() - settle) / 1000).toFixed(1)} s till`);
    row('svarstid för en vanlig mobil under floden', `median ${ms(during.p50)}, 99 % under ${ms(during.p99)}`);
    row('serverns minne efter floden', `${rssMb()} MB (${before} MB före)`);
    if (during.p99 > 1000) finding(`under en meddelandeflod får en vanlig mobil vänta upp till ${(during.p99 / 1000).toFixed(1)} s på svar`);
    if (rssMb() - before > 300) finding(`serverns minne växer med ${rssMb() - before} MB av en flod och en mobil som inte läser`);
    frozen.ws.terminate();
  }

  console.log('\n5. Skräp');
  honest = await fresh();
  {
    const junk = client();
    await junk.wait((m) => m.t === 'welcome');
    const big = client();
    await big.wait((m) => m.t === 'welcome');
    big.send('x'.repeat(5000));
    for (const m of ['', '{', 'null', '[]', '"hej"', '{"t":{"t":"next"}}', '{"t":"choose","role":"team","team":{"__proto__":1}}', '{"__proto__":{"isAdmin":true},"t":"start"}',
      JSON.stringify({ t: 'bid', value: '9'.repeat(400) }), '['.repeat(2000) + ']'.repeat(2000), Buffer.from([0xff, 0xfe, 0x00, 0x80])]) junk.send(m);
    junk.send({ t: 'start' });
    await sleep(500);
    row('för stort meddelande (5 000 tecken)', big.ws.readyState === 1 ? 'tas emot' : 'förbindelsen stängs');
    row('trasiga och illvilliga meddelanden', (await alive()) ? 'servern svarar som vanligt' : 'servern svarar inte');
    if (!(await alive())) finding('servern slutar svara efter trasiga meddelanden');
    if (honest.state?.phase === 'game') finding('en vanlig mobil kunde starta spelet');
    junk.ws.close();
  }
  console.log('\n6. Gissa värdens pinkod');
  honest = await fresh();
  {
    const thief = client(null);
    await thief.open;
    const t0 = performance.now();
    let tries = 0;
    let found = null;
    let closed = false;
    thief.ws.on('close', () => { closed = true; });
    thief.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'welcome') found = tries; });
    for (let pin = 0; pin < 10_000 && found === null && !closed && performance.now() - t0 < 20_000; pin++) {
      thief.send({ t: 'hello', kind: 'admin', pin: String(pin).padStart(4, '0') });
      tries += 1;
      if (pin % 200 === 199) await sleep(5);
    }
    await sleep(800);
    const secs = (performance.now() - t0) / 1000;
    if (found !== null) {
      row('alla fyrsiffriga koder skickas på en gång', `koden hittad efter ${secs.toFixed(1)} s`);
      finding(`värdens pinkod går att gissa på ${secs.toFixed(1)} s, eftersom antalet försök inte begränsas`);
    } else row('alla fyrsiffriga koder skickas på en gång', `${tries} försök på ${secs.toFixed(1)} s, koden inte hittad${closed ? ', förbindelsen stängdes' : ''}`);
    thief.ws.terminate();

    // Värden loggar in innan någon börjar gissa, som en vanlig kväll.
    honest = await fresh();
    const host = client({ kind: 'admin', pin: PIN });
    const first = await host.wait((m) => m.t === 'welcome', 8000);

    // Den som gissar tålmodigt, ett försök i taget: pausen fördubblas för varje fel, upp till en halv minut.
    const patient = client(null);
    await patient.open;
    let answered = 0;
    const p0 = performance.now();
    while (performance.now() - p0 < 12_000) {
      patient.send({ t: 'hello', kind: 'admin', pin: '0000' });
      if (await patient.wait((m) => m.t === 'denied' || m.t === 'welcome', 12_000 - (performance.now() - p0))) answered += 1;
    }
    row('ett försök i taget i tolv sekunder', `${answered} försök hann prövas. Med en halv minut mellan försöken tar 10 000 koder 83 timmar`);
    if (answered > 12) finding(`pinkoden går att pröva ${answered} gånger på tolv sekunder`);

    // Medan någon gissar för fullt: värden som redan har loggat in kommer tillbaka direkt.
    let on = true;
    const noise = (async () => { while (on) { for (let i = 0; i < 50; i++) patient.send({ t: 'hello', kind: 'admin', pin: '1111' }); await sleep(10); } })();
    await sleep(300);
    const t1 = performance.now();
    const again = client({ kind: 'admin', pin: 'fel', key: first?.key });
    const backIn = await again.wait((m) => m.t === 'welcome', 5000);
    row('värden kommer tillbaka medan någon gissar', backIn ? `inne på ${ms(performance.now() - t1)}` : 'släpps inte in');
    if (!backIn) finding('värden som redan har loggat in stängs ute medan någon gissar pinkoden');
    // Känd gräns, inget fynd: en helt ny inloggning får köa bakom den som gissar.
    const t2 = performance.now();
    let fresh2 = null;
    while (!fresh2 && performance.now() - t2 < 6000) {
      const c = client({ kind: 'admin', pin: PIN });
      fresh2 = await c.wait((m) => m.t === 'welcome' || m.t === 'denied', 2000);
      if (fresh2?.t !== 'welcome') { fresh2 = null; c.ws.terminate(); await sleep(250); }
    }
    row('känd gräns: en ny inloggning med rätt kod medan någon gissar', fresh2 ? `inne efter ${((performance.now() - t2) / 1000).toFixed(1)} s` : 'kommer inte in på sex sekunder');
    on = false;
    await noise;
    patient.ws.terminate();
    host.ws.terminate();
    again.ws.terminate();
  }

  console.log('\n7. En hel kväll medan andra bråkar');
  honest = await fresh();
  {
    const admin = client({ kind: 'admin', pin: PIN });
    const ok = await admin.wait((m) => m.t === 'state', 8000);
    if (!ok) { finding('värden kommer inte in efter gissningarna'); } else {
      const bullies = Array.from({ length: 10 }, () => client());
      await Promise.all(bullies.map((c) => c.wait((m) => m.t === 'welcome')));
      let on = true;
      const noise = (async () => {
        const junk = [{ t: 'next' }, { t: 'choose', role: 'judge' }, { t: 'choose', role: 'team', team: 'rod' }, { t: 'leave' }, { t: 'lockBid' }, { t: 'count', team: 'rod', delta: 1 }, { t: 'stop', team: 'bla' }, { t: 'undo' }, { t: 'endGame' }, { t: 'start' }];
        while (on) { for (const c of bullies) c.send(junk[Math.floor(Math.random() * junk.length)]); await sleep(2); }
      })();
      const t0 = performance.now();
      const done = await playEvening(admin);
      on = false;
      await noise;
      row('värden spelar en hel kväll medan tio mobiler bråkar', done ? `i mål på ${((performance.now() - t0) / 1000).toFixed(1)} s` : 'kom inte i mål');
      if (!done) finding(`kvällen kom inte i mål medan andra bråkade (stannade i ${admin.state?.syna?.step ?? admin.state?.phase})`);
      for (const c of bullies) c.ws.terminate();
    }
    admin.ws.terminate();
  }

  console.log('\n8. Servern dödas mitt i spelet');
  honest = await fresh();
  {
    let lost = 0;
    let broken = 0;
    let admin = client({ kind: 'admin', pin: PIN });
    await admin.wait((m) => m.t === 'state', 8000);
    let reached = -1;
    for (let round = 0; round < 15; round++) {
      // Spela några steg, vänta ut sparandet, döda utan förvarning.
      await playEvening(admin, { until: 'aldrig', limit: 3 + (round % 5) });
      await sleep(400);
      const g = admin.state?.syna;
      const at = admin.state?.phase === 'game' && g ? g.round * 10 + ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end'].indexOf(g.step) : -1;
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
      try { JSON.parse(readFileSync(path.join(dataDir, 'room.json'), 'utf8')); } catch { broken += 1; }
      await startServer();
      admin = client({ kind: 'admin', pin: PIN });
      await admin.wait((m) => m.t === 'state', 8000);
      const g2 = admin.state?.syna;
      const back = admin.state?.phase === 'game' && g2 ? g2.round * 10 + ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end'].indexOf(g2.step) : -1;
      // Ett försök som pågick får gärna ha gått i mål under tiden. Annars ska läget vara det som sparades.
      if (back < at && !(g?.step === 'play')) lost += 1;
      reached = Math.max(reached, back);
      if (g2?.step === 'end' || admin.state?.phase !== 'game') { admin.send({ t: 'reset' }); await sleep(200); }
    }
    row('servern dödad 15 gånger mitt i spelet', `${broken} trasiga sparfiler, ${lost} gånger tappade spelet steg`);
    if (broken) finding(`${broken} av 15 gånger var det sparade läget trasigt efter att servern dödats`);
    if (lost) finding(`${lost} av 15 gånger hade spelet tappat steg efter en omstart`);
    admin.ws.terminate();
  }

  honest.ws.terminate();
  if (child.errors.trim()) row('serverns fellogg', `${child.errors.trim().split('\n').length} rader, första: ${child.errors.trim().split('\n')[0].slice(0, 90)}`);
  child.kill();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`\nKlart på ${Math.round((Date.now() - started) / 1000)} s. ${findings.length ? `${findings.length} fynd:` : 'Inga fynd.'}`);
  for (const f of findings) console.log(`  - ${f}`);
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => { console.error(e); child?.kill(); process.exit(2); });
