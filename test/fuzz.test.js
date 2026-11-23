// Slumpade och trasiga meddelanden mot spellogiken i alla lägen. Ingenting får kasta ett undantag:
// ett sådant skulle annars bli ett serverfel mitt i en kväll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, addDevice, apply, viewFor, tick } from '../server/room.js';
import { seeded } from './helpers.js';

const TYPES = ['hello', 'ping', 'choose', 'leave', 'setTeamCount', 'renameTeam', 'kick', 'reset', 'setMaterial', 'start', 'bid', 'lockBid', 'call', 'count', 'stop', 'setResult', 'next', 'swapTask', 'finalResult', 'endGame', 'okänd', undefined, null, 5, {}, '__proto__', 'constructor', 'toString'];
const ODD = [undefined, null, 0, -1, 1, 2, 7, 1e9, -1e9, NaN, Infinity, 0.5, '', 'x', 'rod', 'bla', 'gron', 'gul', 'lila', 'rosa', 'pass', 'team', 'audience', 'judge', '__proto__', 'constructor', 'hasOwnProperty', 'toString', [], [1], {}, { a: 1 }, true, false, 'a'.repeat(5000), '<script>', 'dev-rod', 'dev-judge'];
const KEYS = ['role', 'team', 'name', 'count', 'device', 'on', 'value', 'target', 'delta', 'success', 'kind', 'pin', 'token', 'c', '__proto__', 'constructor'];

// Som meddelandet ser ut efter JSON över nätet. Servern släpper bara igenom objekt.
function wire(value) {
  const json = JSON.stringify(value);
  return json === undefined ? undefined : JSON.parse(json);
}

test('spellogiken kastar aldrig, vilka meddelanden som än kommer', () => {
  const rnd = seeded(2026);
  const pick = (list) => {
    const v = list[Math.floor(rnd() * list.length)];
    return v && typeof v === 'object' ? structuredClone(v) : v;
  };
  const steps = new Set();
  const games = Number(process.env.FUZZ_SPEL) || 60;
  let sent = 0;
  for (let game = 0; game < games; game++) {
    // Vartannat spel får löpa hela vägen: värden trycker oftare på nästa, och ingen nollställer eller avslutar.
    const deep = game % 2 === 0;
    const types = deep ? TYPES.filter((t) => t !== 'reset' && t !== 'endGame') : TYPES;
    const room = newRoom(2 + Math.floor(rnd() * 5));
    const tokens = [];
    for (const t of room.teams) {
      addDevice(room, `tok-${t.id}`, `dev-${t.id}`);
      apply(room, `tok-${t.id}`, { t: 'choose', role: 'team', team: t.id });
      tokens.push(`tok-${t.id}`);
    }
    addDevice(room, 'tok-judge', 'dev-judge');
    apply(room, 'tok-judge', { t: 'choose', role: 'judge' });
    addDevice(room, 'tok-aud', 'dev-aud');
    apply(room, 'tok-aud', { t: 'choose', role: 'audience' });
    tokens.push('tok-judge', 'tok-aud');
    let now = 1_000_000;
    for (let i = 0; i < 500; i++) {
      const s = room.syna;
      const odd = { t: pick(types) };
      for (let k = 0; k < 3; k++) if (rnd() < 0.7) odd[pick(KEYS)] = pick(ODD);
      // Giltiga drag ibland, så att spelet rör sig genom alla steg.
      const valid = pick([
        ...(deep ? [{ t: 'next' }, { t: 'next' }, { t: 'next' }] : []),
        { t: 'start' }, { t: 'next' }, { t: 'lockBid' }, { t: 'call', target: 'pass' }, { t: 'swapTask' },
        { t: 'count', team: s?.schedule?.[s.round]?.[0], delta: 1 }, { t: 'stop', team: s?.schedule?.[s.round]?.[1] },
        { t: 'finalResult', success: rnd() < 0.5 }, { t: 'bid', value: Math.floor(rnd() * 40) }, { t: 'setMaterial', on: rnd() < 0.5 },
      ]);
      const msg = wire(rnd() < 0.45 ? valid : rnd() < 0.05 ? pick(ODD) : odd);
      const isAdmin = rnd() < (deep ? 0.7 : 0.4);
      const token = isAdmin ? null : pick([...tokens, 'okänd-token', null]);
      now += Math.floor(rnd() * 3000);
      sent += 1;
      const where = `spel ${game}, drag ${i}, steg ${s?.step ?? room.phase}: ${JSON.stringify(msg)?.slice(0, 120)}`;
      assert.doesNotThrow(() => apply(room, token, msg, isAdmin, now, rnd), where);
      assert.doesNotThrow(() => tick(room, now), `klockan efter ${where}`);
      assert.doesNotThrow(() => {
        JSON.stringify(viewFor(room, null, 'stage'));
        JSON.stringify(viewFor(room, null, 'admin'));
        for (const t of tokens) JSON.stringify(viewFor(room, t, 'player'));
      }, `vyerna efter ${where}`);
      steps.add(room.syna?.step ?? room.phase);
    }
  }
  assert.equal(sent, games * 500);
  // Provet är bara värt något om spelet faktiskt har rört sig genom alla steg.
  for (const step of ['lobby', 'intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end']) {
    assert.ok(steps.has(step), `steget ${step} nåddes aldrig`);
  }
});
