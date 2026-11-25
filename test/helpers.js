// Hjälpfunktioner som testerna delar: ett rum med mobiler och en rond som spelas från början till slut.

import assert from 'node:assert/strict';
import { newRoom, addDevice, apply } from '../server/room.js';
import { taskById } from '../games/syna/tasks.js';

// Slump som går att upprepa, så att testerna ger samma kväll varje gång.
export function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

// Ett rum med en mobil per lag, en kontrollant och en i publiken.
export function setup(teamCount = 4, seed = 1) {
  const room = newRoom(teamCount);
  // Testerna gäller ronderna som räknas. Övningsronden har egna tester, som slår på den.
  room.settings.practice = false;
  const rng = seeded(seed);
  for (const t of room.teams) {
    addDevice(room, `tok-${t.id}`, `dev-${t.id}`);
    apply(room, `tok-${t.id}`, { t: 'choose', role: 'team', team: t.id });
  }
  addDevice(room, 'tok-judge', 'dev-judge');
  apply(room, 'tok-judge', { t: 'choose', role: 'judge' });
  addDevice(room, 'tok-aud', 'dev-aud');
  apply(room, 'tok-aud', { t: 'choose', role: 'audience' });
  let now = 1_000_000;
  const admin = (msg) => apply(room, null, msg, true, now, rng);
  const as = (who, msg) => apply(room, `tok-${who}`, msg, false, now, rng);
  const clock = { get now() { return now; }, add(ms) { now += ms; } };
  return { room, rng, admin, as, clock };
}

// Spelar en rond: bud, syn och resultat anges per lag. look anropas i varje steg, innan något händer i det.
export function playRound(g, { bids, results, calls = {} }, look = () => {}) {
  const { room, admin, as, clock } = g;
  const s = room.syna;
  const task = taskById(s.tasks[s.round]);
  const [a, b] = s.schedule[s.round];
  assert.equal(s.step, 'intro');
  look('intro');
  assert.equal(admin({ t: 'next' }), null);
  look('bid');
  for (const t of [a, b]) {
    assert.equal(as(t, { t: 'bid', value: bids[t] }), null);
    assert.equal(as(t, { t: 'lockBid' }), null);
  }
  if (s.step === 'call') look('call');
  for (const w of room.teams.map((t) => t.id).filter((id) => id !== a && id !== b)) {
    assert.equal(s.step, 'call');
    assert.equal(as(w, { t: 'call', target: calls[w] ?? 'pass' }), null);
  }
  let guard = 0;
  while (s.step === 'ready') {
    assert.ok(guard++ < 3);
    look('ready');
    assert.equal(as('judge', { t: 'next' }), null);
    assert.equal(s.step, 'play');
    look('play');
    const active = task.mode === 'turns' ? [s.order[s.turn]] : [a, b];
    if (task.measure === 'count') {
      for (const t of active) for (let i = 0; i < results[t]; i++) assert.equal(as('judge', { t: 'count', team: t, delta: 1 }), null);
      assert.equal(as('judge', { t: 'next' }), null);
    } else {
      const start = clock.now;
      const stops = active.filter((t) => results[t] != null).sort((x, y) => results[x] - results[y]);
      for (const t of stops) {
        clock.add(start + results[t] * 1000 - clock.now);
        assert.equal(as('judge', { t: 'stop', team: t }), null);
      }
      if (s.step === 'play') assert.equal(as('judge', { t: 'next' }), null);
    }
  }
  assert.equal(s.step, 'result');
  look('result');
  assert.equal(as('judge', { t: 'next' }), null);
  assert.equal(s.step, 'score');
  look('score');
  return { task, duel: [a, b] };
}
