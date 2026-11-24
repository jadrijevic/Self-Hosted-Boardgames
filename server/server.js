// Webbserver och WebSocket-synk. Servern äger hela spelläget; klienterna skickar avsikter
// och får tillbaka en ögonblicksbild av läget, filtrerad efter sin roll.

import http from 'node:http';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { newRoom, addDevice, apply, viewFor, prune, isValidRoom, normalize, tick } from './room.js';
import { wifiPayload } from './wifi.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const PAGES = { '/': 'index.html', '/scen': 'scen.html', '/admin': 'admin.html', '/start': 'start.html' };
// Sidor som en QR-kod får peka på, utöver mobilsidan.
const QR_TARGETS = { admin: '/admin', scen: '/scen', start: '/start' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const KINDS = ['stage', 'player', 'admin'];
const MAX_DEVICES = 300;
const CAST_MS = 20; // ändringar som kommer tätare än så går ut som en enda uppdatering
const SLOW_BYTES = 1_000_000; // en mobil som inte läser får vänta på nästa uppdatering
const PIN_QUEUE = 5; // fler samtidiga försök på pinkoden än så nekas direkt
const PIN_MAX_MS = 30_000; // längsta pausen efter många fel försök i rad

function load(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return newRoom(); } // ingen sparad kväll: börja om
  try {
    const room = JSON.parse(raw);
    if (isValidRoom(room)) return normalize(room);
  } catch { /* går inte att tolka: hanteras nedan */ }
  // En fil som inte går att använda skrivs aldrig över tyst. Rekordboken kan ligga i den.
  const aside = `${file}.olasbar-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    renameSync(file, aside);
    console.error(`Det sparade läget gick inte att läsa. Det ligger kvar som ${aside}, och spelet börjar om.`);
  } catch (e) {
    console.error('Det sparade läget gick inte att läsa och inte att flytta undan:', e.message);
  }
  return newRoom();
}

// Sätter en omvänd proxy sådana här rubriker kommer anropet inte direkt från nätet hemma.
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

// logic går att byta ut i tester. I drift är det alltid spellogiken i room.js.
// wifi är gästnätets namn och lösenord ({ ssid, password }), eller null. Med wifi visar storbilden en wifi-kod före spelets kod.
// pinDelay är pausen efter ett fel försök på pinkoden, i millisekunder.
export async function startServer({ port = 8080, dataDir = './data', adminPin, publicUrl = '', wifi = null, pinDelay = 300, logic = { apply, tick } } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'room.json');
  const pin = adminPin ? String(adminPin) : String(randomInt(1000, 10000));
  const room = load(file);
  const conns = new Map(); // ws -> { token, kind, isAdmin }
  let saveTimer = null;
  let castTimer = null;
  let lastChange = Date.now();

  const online = () => new Set([...conns.values()].map((c) => c.token).filter(Boolean));
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  async function save() {
    saveTimer = null;
    try {
      prune(room, online());
      await writeFile(`${file}.tmp`, JSON.stringify(room));
      await rename(`${file}.tmp`, file);
    } catch (e) {
      console.error('Kunde inte spara läget:', e.message);
    }
  }

  // Hela läget går ut till alla. En mobil som inte läser det den får hoppas över: nästa uppdatering är ändå hela läget.
  function cast() {
    castTimer = null;
    const on = online();
    for (const [ws, c] of conns) {
      if (ws.bufferedAmount < SLOW_BYTES) send(ws, { t: 'state', state: viewFor(room, c.token, c.kind, on) });
    }
  }

  // Varje ändring höjer versionen, går ut till alla och sparas strax efteråt. Ändringar som kommer tätt slås ihop,
  // så att en mobil som skickar hundratals meddelanden i sekunden inte får servern att skicka lika många svar till alla.
  function changed() {
    room.v += 1;
    lastChange = Date.now();
    if (!castTimer) castTimer = setTimeout(cast, CAST_MS);
    if (!saveTimer) saveTimer = setTimeout(save, 150);
  }

  // Pinkoden prövas ett försök i taget, och ett fel försök håller grinden stängd en stund för nästa.
  // Pausen fördubblas för varje fel i rad, upp till en halv minut, och nollställs av ett rätt försök.
  // Då tar det dygn i stället för sekunder att gissa sig fram. Den som redan har loggat in får en nyckel
  // och släpps in igen utan att köa, så att värden inte stängs ute medan någon annan gissar.
  const adminKeys = new Set();
  let pinGate = Promise.resolve();
  let pinWaiting = 0;
  let pinMisses = 0;
  function tryPin(given) {
    if (pinWaiting >= PIN_QUEUE) return Promise.resolve(false);
    pinWaiting += 1;
    const result = pinGate.then(() => String(given ?? '') === pin);
    pinGate = result
      .then((ok) => {
        if (ok) { pinMisses = 0; return null; }
        pinMisses += 1;
        if (pinMisses === 10) console.error('Tio felaktiga pinkoder i rad. Någon gissar, eller så har värden glömt koden.');
        const pause = Math.min(PIN_MAX_MS, pinDelay * 2 ** Math.min(pinMisses - 1, 20));
        return new Promise((resolve) => { setTimeout(resolve, pause).unref(); });
      })
      .finally(() => { pinWaiting -= 1; });
    return result;
  }

  const joinUrl = (req) => publicUrl || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
  // Wifi-koden är nätets lösenord i klartext. Den lämnas ut till den som når servern direkt, och som alltså redan
  // är på nätet hemma, men aldrig genom en omvänd proxy. Görs spelet nåbart utifrån den vägen följer lösenordet inte med.
  const wifiFor = (req) => (wifi && !PROXY_HEADERS.some((h) => req.headers[h]) ? wifi : null);
  // Sidorna hämtas alltid på nytt, så att en uppdatering syns direkt. Typsnittet ändras inte och får ligga kvar en vecka.
  const reply = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': type === TYPES['.woff2'] ? 'public, max-age=604800' : 'no-cache' });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname, searchParams } = new URL(req.url, 'http://localhost');
      if (pathname === '/halsa') return reply(res, 200, 'text/plain; charset=utf-8', 'ok');
      // Läget i korthet, utan hemligheter. Uppdateringsskriptet läser det för att inte starta om mitt i ett spel.
      if (pathname === '/lage') {
        const body = { phase: room.phase, online: conns.size, idleSec: Math.floor((Date.now() - lastChange) / 1000), v: room.v };
        return reply(res, 200, 'application/json; charset=utf-8', JSON.stringify(body));
      }
      if (pathname === '/adress') return reply(res, 200, 'text/plain; charset=utf-8', joinUrl(req));
      if (pathname === '/qr.svg') {
        const target = joinUrl(req) + (QR_TARGETS[searchParams.get('till')] ?? '');
        const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        return reply(res, 200, TYPES['.svg'], svg);
      }
      if (pathname === '/wifi') return reply(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ssid: wifiFor(req)?.ssid ?? null }));
      if (pathname === '/wifi.svg') {
        const net = wifiFor(req);
        if (!net) return reply(res, 404, 'text/plain; charset=utf-8', 'Finns inte');
        const svg = await QRCode.toString(wifiPayload(net), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'Content-Type': TYPES['.svg'], 'Cache-Control': 'no-store' }); // lösenordet ska inte ligga kvar i webbläsarens cache
        return res.end(svg);
      }
      const name = PAGES[pathname] ?? pathname.slice(1);
      if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(name)) return reply(res, 404, 'text/plain; charset=utf-8', 'Finns inte');
      const body = await readFile(path.join(PUBLIC, name));
      return reply(res, 200, TYPES[path.extname(name)] ?? 'application/octet-stream', body);
    } catch (e) {
      const missing = e.code === 'ENOENT';
      return reply(res, missing ? 404 : 500, 'text/plain; charset=utf-8', missing ? 'Finns inte' : 'Serverfel');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { if (conns.delete(ws)) changed(); });
    // Medan värdens pinkod prövas väntar förbindelsens övriga meddelanden på sin tur, i den ordning de kom.
    let waiting = null;
    const queue = (job) => {
      const turn = (waiting ?? Promise.resolve()).then(job).catch((e) => console.error('Fel i ett köat meddelande:', e)).finally(() => { if (waiting === turn) waiting = null; });
      waiting = turn;
    };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (waiting) queue(() => handle(m));
      else handle(m);
    });
    function handle(m) {

      // Klockjämförelse: klienten räknar ut skillnaden mot serverns tid.
      if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });

      if (m.t === 'hello') {
        // En förbindelse säger hej en gång. Annars kan en enda klient skapa hur många mobiler som helst.
        if (conns.has(ws)) return;
        const kind = KINDS.includes(m.kind) ? m.kind : 'player';
        if (kind === 'admin') {
          const known = typeof m.key === 'string' && adminKeys.has(m.key);
          return queue(() => (known ? Promise.resolve(true) : tryPin(m.pin)).then((ok) => {
            if (ws.readyState !== 1 || conns.has(ws)) return;
            if (!ok) return send(ws, { t: 'denied' });
            const key = known ? m.key : randomBytes(16).toString('hex');
            adminKeys.add(key);
            conns.set(ws, { token: null, kind, isAdmin: true });
            send(ws, { t: 'welcome', token: null, key, now: Date.now() });
            changed();
          }));
        }
        let token = null;
        if (kind === 'player') {
          const known = typeof m.token === 'string' && Object.hasOwn(room.devices, m.token);
          if (!known && Object.keys(room.devices).length >= MAX_DEVICES) prune(room, online());
          if (!known && Object.keys(room.devices).length >= MAX_DEVICES) return send(ws, { t: 'error', error: 'för många enheter' });
          token = known ? m.token : randomBytes(16).toString('hex');
          addDevice(room, token, randomBytes(3).toString('hex'));
        }
        conns.set(ws, { token, kind, isAdmin: false });
        send(ws, { t: 'welcome', token, now: Date.now() });
        return changed();
      }

      const c = conns.get(ws);
      if (!c) return;
      // Ett fel i spellogiken får inte fälla servern mitt i en kväll. Felet loggas och spelet går vidare.
      let err;
      try {
        err = logic.apply(room, c.token, m, c.isAdmin, Date.now());
      } catch (e) {
        console.error(`Fel i spellogiken (${String(m.t).slice(0, 30)}):`, e);
        return send(ws, { t: 'error', error: 'serverfel, försök igen' });
      }
      if (err) return send(ws, { t: 'error', error: err });
      changed();
    }
  });

  // En mobil som somnar stänger inte alltid förbindelsen själv. Pinga och rensa de som inte svarar.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  // Spelets klocka: när tiden för ett uppdrag har gått ut går servern själv vidare.
  const clock = setInterval(() => {
    try {
      if (logic.tick(room, Date.now())) changed();
    } catch (e) {
      console.error('Fel i spelets klocka:', e);
    }
  }, 250);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });

  return {
    port: server.address().port,
    pin,
    async close() {
      clearInterval(beat);
      clearInterval(clock);
      clearTimeout(saveTimer);
      clearTimeout(castTimer);
      for (const ws of wss.clients) ws.terminate();
      conns.clear();
      await save();
      await new Promise((resolve) => wss.close(() => server.close(resolve)));
    },
  };
}
