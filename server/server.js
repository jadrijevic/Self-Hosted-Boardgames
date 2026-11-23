// Webbserver och WebSocket-synk. Servern äger hela spelläget; klienterna skickar avsikter
// och får tillbaka en ögonblicksbild av läget, filtrerad efter sin roll.

import http from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { newRoom, addDevice, apply, viewFor, prune, isValidRoom, normalize, tick } from './room.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const PAGES = { '/': 'index.html', '/scen': 'scen.html', '/admin': 'admin.html' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const KINDS = ['stage', 'player', 'admin'];
const MAX_DEVICES = 300;

function load(file) {
  try {
    const room = JSON.parse(readFileSync(file, 'utf8'));
    if (isValidRoom(room)) return normalize(room);
  } catch { /* ingen sparad kväll: börja om */ }
  return newRoom();
}

export async function startServer({ port = 8080, dataDir = './data', adminPin, publicUrl = '' } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'room.json');
  const pin = adminPin ? String(adminPin) : String(randomInt(1000, 10000));
  const room = load(file);
  const conns = new Map(); // ws -> { token, kind, isAdmin }
  let saveTimer = null;

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

  // Varje ändring höjer versionen, går ut till alla och sparas strax efteråt.
  function changed() {
    room.v += 1;
    const on = online();
    for (const [ws, c] of conns) send(ws, { t: 'state', state: viewFor(room, c.token, c.kind, on) });
    if (!saveTimer) saveTimer = setTimeout(save, 150);
  }

  const joinUrl = (req) => publicUrl || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
  const reply = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/halsa') return reply(res, 200, 'text/plain; charset=utf-8', 'ok');
      if (pathname === '/adress') return reply(res, 200, 'text/plain; charset=utf-8', joinUrl(req));
      if (pathname === '/qr.svg') {
        const svg = await QRCode.toString(joinUrl(req), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        return reply(res, 200, TYPES['.svg'], svg);
      }
      const name = PAGES[pathname] ?? pathname.slice(1);
      if (!/^[a-z0-9-]+\.[a-z]+$/i.test(name)) return reply(res, 404, 'text/plain; charset=utf-8', 'Finns inte');
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
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;

      // Klockjämförelse: klienten räknar ut skillnaden mot serverns tid.
      if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });

      if (m.t === 'hello') {
        const kind = KINDS.includes(m.kind) ? m.kind : 'player';
        if (kind === 'admin' && String(m.pin ?? '') !== pin) return send(ws, { t: 'denied' });
        let token = null;
        if (kind === 'player') {
          const known = typeof m.token === 'string' && Object.hasOwn(room.devices, m.token);
          if (!known && Object.keys(room.devices).length >= MAX_DEVICES) prune(room, online());
          if (!known && Object.keys(room.devices).length >= MAX_DEVICES) return send(ws, { t: 'error', error: 'för många enheter' });
          token = known ? m.token : randomBytes(16).toString('hex');
          addDevice(room, token, randomBytes(3).toString('hex'));
        }
        conns.set(ws, { token, kind, isAdmin: kind === 'admin' });
        send(ws, { t: 'welcome', token, now: Date.now() });
        return changed();
      }

      const c = conns.get(ws);
      if (!c) return;
      const err = apply(room, c.token, m, c.isAdmin, Date.now());
      if (err) return send(ws, { t: 'error', error: err });
      changed();
    });
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
  const clock = setInterval(() => { if (tick(room, Date.now())) changed(); }, 250);

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
      for (const ws of wss.clients) ws.terminate();
      conns.clear();
      await save();
      await new Promise((resolve) => wss.close(() => server.close(resolve)));
    },
  };
}
