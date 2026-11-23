// Spelläget för en kväll: lag, enheter och fas.
// Ren logik utan nätverk, så att den går att testa för sig.

import { GAMES } from './games.js';

export const TEAM_PRESETS = [
  { id: 'rod', name: 'Röd', color: '#E4572E' },
  { id: 'bla', name: 'Blå', color: '#2D7DD2' },
  { id: 'gron', name: 'Grön', color: '#3FA773' },
  { id: 'gul', name: 'Gul', color: '#EFA91F' },
  { id: 'lila', name: 'Lila', color: '#7A5BD1' },
  { id: 'rosa', name: 'Rosa', color: '#D14E9C' },
];
export const ROLES = ['team', 'audience', 'judge'];
export const MIN_TEAMS = 2;
export const MAX_TEAMS = TEAM_PRESETS.length;

export function newRoom(teamCount = 4) {
  const n = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, Math.trunc(Number(teamCount)) || 4));
  return {
    v: 0,
    game: 'syna',
    phase: 'lobby',
    teams: TEAM_PRESETS.slice(0, n).map((t) => ({ ...t })),
    devices: {}, // hemlig token -> { id, role, team, name }
    settings: { material: false },
    records: {}, // rekordboken: uppdrag -> { value, team, date }. Följer med mellan kvällarna.
  };
}

// Fyller på fält som saknas i ett läge som sparats av en äldre version.
export function normalize(room) {
  room.settings ??= { material: false };
  room.records ??= {};
  if (room.phase !== 'game' || !room[room.game]) room.phase = 'lobby';
  return room;
}

export function addDevice(room, token, id) {
  room.devices[token] ??= { id, role: null, team: null, name: '' };
  return room.devices[token];
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function unseat(dev) {
  dev.role = null;
  dev.team = null;
}

// Tar emot en avsikt från en enhet. Returnerar null om den gick igenom, annars en feltext.
export function apply(room, token, msg, isAdmin = false, now = Date.now(), rng = Math.random) {
  if (!msg || typeof msg !== 'object') return 'okänt meddelande';
  const dev = token ? room.devices[token] : null;
  switch (msg?.t) {
    case 'choose': {
      if (!dev) return 'okänd enhet';
      if (!ROLES.includes(msg.role)) return 'okänd roll';
      if (msg.role === 'team' && !room.teams.some((t) => t.id === msg.team)) return 'okänt lag';
      dev.role = msg.role;
      dev.team = msg.role === 'team' ? msg.team : null;
      if (msg.name !== undefined) dev.name = clean(msg.name, 20);
      return null;
    }
    case 'leave': {
      if (!dev) return 'okänd enhet';
      unseat(dev);
      return null;
    }
    case 'setTeamCount': {
      if (!isAdmin) return 'bara värden får göra det';
      if (room.phase !== 'lobby') return 'antalet lag kan bara ändras i lobbyn';
      const n = Number(msg.count);
      if (!Number.isInteger(n) || n < MIN_TEAMS || n > MAX_TEAMS) return `antal lag måste vara ${MIN_TEAMS}–${MAX_TEAMS}`;
      while (room.teams.length < n) {
        const next = TEAM_PRESETS.find((p) => !room.teams.some((t) => t.id === p.id));
        room.teams.push({ ...next });
      }
      while (room.teams.length > n) {
        const gone = room.teams.pop();
        for (const d of Object.values(room.devices)) if (d.team === gone.id) unseat(d);
      }
      return null;
    }
    case 'renameTeam': {
      if (!isAdmin) return 'bara värden får göra det';
      const team = room.teams.find((t) => t.id === msg.team);
      const name = clean(msg.name, 14);
      if (!team) return 'okänt lag';
      if (!name) return 'namnet får inte vara tomt';
      team.name = name;
      return null;
    }
    case 'kick': {
      if (!isAdmin) return 'bara värden får göra det';
      const target = Object.values(room.devices).find((d) => d.id === msg.device);
      if (!target) return 'okänd enhet';
      unseat(target);
      return null;
    }
    case 'reset': {
      if (!isAdmin) return 'bara värden får göra det';
      room.phase = 'lobby';
      room[room.game] = null;
      for (const d of Object.values(room.devices)) unseat(d);
      return null;
    }
    case 'setMaterial': {
      if (!isAdmin) return 'bara värden får göra det';
      if (room.phase !== 'lobby') return 'inställningen kan bara ändras i lobbyn';
      room.settings.material = Boolean(msg.on);
      return null;
    }
    case 'start': {
      if (!isAdmin) return 'bara värden får starta';
      if (room.phase !== 'lobby') return 'spelet är redan igång';
      return GAMES[room.game].start(room, now, rng);
    }
    default:
      // Allt annat hör till spelet som pågår.
      if (room.phase === 'game') return GAMES[room.game].apply(room, { device: dev, isAdmin }, msg, now, rng);
      return 'okänt meddelande';
  }
}

// Det en viss enhet får se av läget. Token lämnar aldrig servern till någon annan än ägaren,
// och här ska också hemliga bud filtreras bort när ronderna byggs.
export function viewFor(room, token, kind, online = new Set()) {
  const entries = Object.entries(room.devices);
  const pub = ([tok, d]) => ({ id: d.id, name: d.name, online: online.has(tok) });
  const me = token ? room.devices[token] : null;
  const view = {
    v: room.v,
    game: room.game,
    phase: room.phase,
    teams: room.teams.map((t) => ({
      ...t,
      devices: entries.filter(([, d]) => d.role === 'team' && d.team === t.id).map(pub),
    })),
    audience: entries.filter(([, d]) => d.role === 'audience').map(pub),
    judges: entries.filter(([, d]) => d.role === 'judge').map(pub),
    me: me ? { id: me.id, role: me.role, team: me.team, name: me.name } : null,
    settings: room.settings,
  };
  if (room.phase === 'game') {
    view[room.game] = GAMES[room.game].view(room, { device: me, isAdmin: kind === 'admin' });
  }
  if (kind === 'admin') {
    view.unseated = entries.filter(([tok, d]) => !d.role && online.has(tok)).length;
  }
  return view;
}

// Enheter som varken har en roll eller är anslutna behöver inte sparas.
export function prune(room, online = new Set()) {
  for (const [tok, d] of Object.entries(room.devices)) {
    if (!d.role && !online.has(tok)) delete room.devices[tok];
  }
}

// Låter spelet som pågår sköta sin klocka. Returnerar true om läget ändrades.
export function tick(room, now = Date.now()) {
  return room.phase === 'game' ? GAMES[room.game].tick(room, now) : false;
}

export function isValidRoom(room) {
  return Boolean(room && Array.isArray(room.teams) && room.teams.length >= MIN_TEAMS
    && room.devices && typeof room.devices === 'object' && typeof room.v === 'number');
}
