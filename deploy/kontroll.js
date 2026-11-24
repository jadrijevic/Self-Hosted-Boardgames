// Kontroll av en körande server: svarar sidorna, går WebSocket fram och hamnar läget på disk?
// Körs i containern av installationsskriptet (docker exec boardgames node deploy/kontroll.js)
// och i CI mot den byggda avbilden. En container som är uppe behöver inte fungera, så varje del provas.
// Skriver en rad per prov och avslutar med 1 om något föll.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

const port = Number(process.env.PORT) || 8080;
const dataDir = process.env.DATA_DIR || './data';
const base = `http://127.0.0.1:${port}`;
let failed = 0;
const ok = (text) => console.log(`  OK      ${text}`);
const fel = (text) => { failed += 1; console.log(`  FEL     ${text}`); };
const varn = (text) => console.log(`  VARNING ${text}`);

async function get(pathname) {
  const res = await fetch(base + pathname, { signal: AbortSignal.timeout(3000) });
  return { status: res.status, body: await res.text() };
}

async function page(pathname, needle, label) {
  try {
    const { status, body } = await get(pathname);
    if (status === 200 && body.includes(needle)) ok(label);
    else fel(`${label}: ${pathname} svarade ${status}${status === 200 ? ' utan väntat innehåll' : ''}`);
  } catch (e) {
    fel(`${label}: ${pathname} svarar inte (${e.cause?.code ?? e.name})`);
  }
}

// Ansluter som storbild, som inte lämnar någon enhet efter sig i spelet.
function socket() {
  return new Promise((resolve) => {
    const seen = { welcome: false, state: null, pong: false };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const done = (error) => { clearTimeout(timer); ws.terminate(); resolve({ ...seen, error }); };
    const timer = setTimeout(() => done('inget svar inom 3 sekunder'), 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', kind: 'stage' }));
      ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') seen.welcome = true;
      if (m.t === 'pong') seen.pong = true;
      if (m.t === 'state') seen.state = m.state;
      if (seen.welcome && seen.pong && seen.state) done(null);
    });
    ws.on('error', (e) => done(e.code ?? e.message));
  });
}

await page('/halsa', 'ok', 'servern svarar');
await page('/', 'id="app"', 'mobilsidan');
await page('/scen', 'id="game"', 'storbilden');
await page('/admin', 'id="app"', 'värdsidan');
await page('/start', 'kom igång', 'startsidan');
await page('/syna.js', 'export function player', 'spelets vyer');
await page('/qr.svg', '<svg', 'QR-koden');

const started = Date.now();
const s = await socket();
if (s.error) fel(`WebSocket: ${s.error}`);
else if (!Array.isArray(s.state?.teams) || s.state.teams.length < 2) fel('WebSocket: läget saknar lag');
else ok(`WebSocket: läget kom fram (${s.state.teams.length} lag, ${s.state.phase === 'game' ? 'spel pågår' : 'lobby'})`);

// Anslutningen ovan ändrar läget, och servern sparar strax efter varje ändring.
await new Promise((resolve) => setTimeout(resolve, 600));
const file = path.join(dataDir, 'room.json');
try {
  const room = JSON.parse(await readFile(file, 'utf8'));
  const { mtimeMs } = await stat(file);
  if (!Array.isArray(room.teams)) fel(`${file} går inte att läsa som ett spelläge`);
  else if (s.error || mtimeMs < started - 1000) fel(`${file} skrevs inte efter en ändring`);
  else ok(`läget sparas i ${dataDir}`);
} catch (e) {
  fel(`läget sparas inte i ${dataDir} (${e.code ?? e.message})`);
}

try {
  const lage = JSON.parse((await get('/lage')).body);
  ok(`läge: ${lage.phase === 'game' ? 'spel pågår' : 'lobby'}, ${lage.online} anslutna`);
} catch {
  fel('/lage svarar inte med läget');
}

if (process.env.WIFI_SSID) await page('/wifi.svg', '<svg', `wifi-koden till nätet ${process.env.WIFI_SSID}`);
else console.log('  ..      ingen wifi-kod är inställd (WIFI_SSID)');

if (process.env.ADMIN_PIN) ok('värdens pinkod är fast (ADMIN_PIN)');
else varn('ADMIN_PIN saknas: värdens pinkod slumpas vid varje start och står i loggen');

process.exit(failed ? 1 : 0);
