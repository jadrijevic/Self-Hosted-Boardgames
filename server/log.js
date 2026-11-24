// Händelseloggen: en rad per steg i spelet, i filen events.jsonl bredvid det sparade läget.
// Efter en kväll eller ett provspel visar den hur lång tid varje steg tog och vad lagen budade och klarade,
// det som annars är gissningar. Raderna byggs ur storbildens vy (logEntry i room.js), så loggen innehåller
// aldrig något som inte redan har visats för alla.

import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { logKey, logEntry } from './room.js';
import { GAMES } from './games.js';

// En kväll ger ungefär 60 rader på 600 tecken. Filen läggs undan vid start när den har vuxit sig stor.
const MAX_BYTES = 5_000_000;
const SHOWN = 5; // så många kvällar visar sammanfattningen

export function createLog(dataDir) {
  const file = path.join(dataDir, 'events.jsonl');
  let last = null;
  let pending = Promise.resolve();
  let failed = false;
  // Raderna skrivs en i taget och i ordning. Går det inte att skriva sägs det en gång, och spelet går vidare.
  const write = (line) => {
    const text = `${JSON.stringify(line)}\n`;
    pending = pending.then(() => appendFile(file, text)).then(() => { failed = false; }, (e) => {
      if (!failed) console.error('Kunde inte skriva händelseloggen:', e.message);
      failed = true;
    });
  };
  const line = (room, by, now) => ({ at: new Date(now).toISOString(), by, ...logEntry(room) });
  return {
    file,
    // Vid start: en för stor fil läggs undan, och en rad säger att servern startade och i vilket läge.
    async boot(room, now = Date.now()) {
      try {
        if ((await stat(file)).size > MAX_BYTES) await rename(file, path.join(dataDir, 'events.1.jsonl'));
      } catch { /* filen finns inte än */ }
      last = logKey(room);
      write(line(room, 'serverStart', now));
    },
    // Efter varje ändring: en rad om spelet har bytt steg, uppdrag eller lag på tur. by är meddelandet som ledde dit.
    note(room, by, now = Date.now()) {
      const key = logKey(room);
      if (key === last) return;
      last = key;
      write(line(room, by, now));
    },
    flush: () => pending,
    async raw() {
      await pending;
      try { return await readFile(file, 'utf8'); } catch { return ''; }
    },
  };
}

// Rader som inte går att läsa hoppas över: en rad kan vara halvskriven om servern dog mitt i den.
export function parse(text) {
  const out = [];
  for (const row of text.split('\n')) {
    if (!row.trim()) continue;
    try {
      const l = JSON.parse(row);
      if (l && typeof l === 'object' && Number.isFinite(Date.parse(l.at))) out.push(l);
    } catch { /* trasig rad */ }
  }
  return out;
}

// Delar loggen i kvällar: från att ett spel startar till att det avslutas. Raden som avslutar följer med, för sluttiden.
export function evenings(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.phase === 'game') {
      if (!cur) { cur = []; out.push(cur); }
      cur.push(l);
    } else {
      if (cur) cur.push(l);
      cur = null;
    }
  }
  return out;
}

// Datum och klockslag i en tidszon. En tidszon som inte finns ger svensk tid, och i sista hand UTC.
function clock(zone) {
  for (const timeZone of [zone, 'Europe/Stockholm', 'UTC']) {
    try {
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const time = new Intl.DateTimeFormat('sv-SE', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
      return { day: (ms) => date.format(ms), hm: (ms) => time.format(ms) };
    } catch { /* okänd tidszon: prova nästa */ }
  }
  return { day: (ms) => new Date(ms).toISOString().slice(0, 10), hm: (ms) => new Date(ms).toISOString().slice(11, 16) };
}

// Sammanfattningen som text, den senaste kvällen först. Klockslag visas i husets tidszon.
export function summary(text, now = Date.now(), zone = process.env.TZ || 'Europe/Stockholm') {
  const fmt = clock(zone);
  const blocks = evenings(parse(text))
    .map((lines) => GAMES[lines[0].game]?.logSummary?.(lines, fmt) ?? '')
    .filter(Boolean)
    .reverse();
  const head = ['Händelselogg', `Hämtad ${fmt.day(now)} ${fmt.hm(now)}.`];
  if (!blocks.length) return [...head, 'Inget spel är loggat än.', ''].join('\n');
  head.push(`${blocks.length} ${blocks.length === 1 ? 'kväll' : 'kvällar'} i loggen${blocks.length > 1 ? ', den senaste först' : ''}${blocks.length > SHOWN ? `. Här visas de ${SHOWN} senaste` : ''}.`);
  head.push('Bara det som har visats på storbilden står här. Rådata: /logg.jsonl');
  return `${[head.join('\n'), ...blocks.slice(0, SHOWN)].join(`\n\n${'-'.repeat(72)}\n\n`)}\n`;
}
