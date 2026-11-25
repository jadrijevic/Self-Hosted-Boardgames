// Slumpade och trasiga meddelanden mot spellogiken i alla lägen. Ingenting får kasta ett undantag:
// ett sådant skulle annars bli ett serverfel mitt i en kväll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, addDevice, apply, viewFor, tick, logKey, logEntry } from '../server/room.js';
import { seeded } from './helpers.js';

const TYPES = ['hello', 'ping', 'choose', 'leave', 'setTeamCount', 'renameTeam', 'kick', 'reset', 'setMaterial', 'setLong', 'setPractice', 'skipPractice', 'toFinal', 'start', 'bid', 'lockBid', 'call', 'count', 'stop', 'setResult', 'next', 'swapTask', 'undo', 'finalResult', 'endGame', 'okänd', undefined, null, 5, {}, '__proto__', 'constructor', 'toString'];
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
  let undone = 0;
  for (let game = 0; game < games; game++) {
    // Vartannat spel får löpa hela vägen: värden trycker oftare på nästa, och ingen nollställer eller avslutar.
    const deep = game % 2 === 0;
    const types = deep ? TYPES.filter((t) => t !== 'reset' && t !== 'endGame' && t !== 'toFinal') : TYPES;
    const room = newRoom(2 + Math.floor(rnd() * 5));
    // Hälften av de djupa spelen går utan övningsrond, så att de hinner fram till slutet.
    if (deep && game % 4 === 0) room.settings.practice = false;
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
    // De djupa spelen får fler drag: med övningsronden är vägen till slutet en rond längre.
    for (let i = 0; i < (deep ? 800 : 500); i++) {
      const s = room.syna;
      const odd = { t: pick(types) };
      for (let k = 0; k < 3; k++) if (rnd() < 0.7) odd[pick(KEYS)] = pick(ODD);
      // Giltiga drag ibland, så att spelet rör sig genom alla steg.
      const valid = pick([
        ...(deep ? [{ t: 'next' }, { t: 'next' }, { t: 'next' }] : []),
        { t: 'start' }, { t: 'next' }, { t: 'lockBid' }, { t: 'call', target: 'pass' }, { t: 'swapTask' },
        { t: 'count', team: s?.schedule?.[s.round]?.[0], delta: 1 }, { t: 'stop', team: s?.schedule?.[s.round]?.[1] },
        // Ångrandet är sällsynt i de djupa spelen, så att de ändå hinner fram till finalen.
        ...(deep && rnd() < 0.8 ? [] : [{ t: 'undo' }, { t: 'undo', step: s?.step }]),
        { t: 'finalResult', success: rnd() < 0.5 }, { t: 'bid', value: Math.floor(rnd() * 40) }, { t: 'setMaterial', on: rnd() < 0.5 }, { t: 'setLong', on: rnd() < 0.5 }, { t: 'setPractice', on: rnd() < 0.5 }, { t: 'skipPractice' }, ...(deep ? [] : [{ t: 'toFinal' }]),
      ]);
      const msg = wire(rnd() < 0.45 ? valid : rnd() < 0.05 ? pick(ODD) : odd);
      const isAdmin = rnd() < (deep ? 0.7 : 0.4);
      const token = isAdmin ? null : pick([...tokens, 'okänd-token', null]);
      now += Math.floor(rnd() * 3000);
      sent += 1;
      const where = `spel ${game}, drag ${i}, steg ${s?.step ?? room.phase}: ${JSON.stringify(msg)?.slice(0, 120)}`;
      let error;
      assert.doesNotThrow(() => { error = apply(room, token, msg, isAdmin, now, rnd); }, where);
      if (msg?.t === 'undo' && error === null) undone += 1;
      assert.doesNotThrow(() => tick(room, now), `klockan efter ${where}`);
      assert.doesNotThrow(() => {
        JSON.stringify(viewFor(room, null, 'stage'));
        JSON.stringify(viewFor(room, null, 'admin'));
        for (const t of tokens) JSON.stringify(viewFor(room, t, 'player'));
      }, `vyerna efter ${where}`);
      assert.doesNotThrow(() => { logKey(room); JSON.stringify(logEntry(room)); }, `händelseloggen efter ${where}`);
      steps.add(room.syna?.step ?? room.phase);
      if (room.syna?.practice) steps.add('övning');
    }
  }
  assert.equal(sent, games * 650);
  assert.ok(undone > 50, `bara ${undone} steg ångrades`);
  // Provet är bara värt något om spelet faktiskt har rört sig genom alla steg.
  for (const step of ['lobby', 'övning', 'intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end']) {
    assert.ok(steps.has(step), `steget ${step} nåddes aldrig`);
  }
});
