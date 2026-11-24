// Fynden från masstesterna (tools/storm), som tester: felen ska inte komma tillbaka.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDevice, apply } from '../server/room.js';
import { beginRound } from '../games/syna/game.js';
import { runMany } from '../tools/storm/scenarios.js';
import { setup } from './helpers.js';

// Startar ett spel med ett bestämt uppdrag och går fram till ett steg.
function at(taskId, step, teams = 4) {
  const g = setup(teams, 11);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = taskId;
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  const watchers = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  const order = ['intro', 'bid', 'call', 'ready', 'play'];
  if (order.indexOf(step) >= 1) g.admin({ t: 'next' });
  if (order.indexOf(step) >= 2) { g.as(a, { t: 'lockBid' }); g.as(b, { t: 'lockBid' }); }
  if (order.indexOf(step) >= 3) for (const w of watchers) g.as(w, { t: 'call', target: 'pass' });
  if (order.indexOf(step) >= 4) g.as('judge', { t: 'next' });
  assert.equal(s.step, step);
  return { g, s, a, b, watchers };
}

test('masstestet: 150 kvällar där allt krånglar, och inget är fel efteråt', () => {
  const report = runMany(150, 3);
  assert.deepEqual(report.violations, {}, JSON.stringify(report.violations, null, 1).slice(0, 1500));
  assert.equal(report.finished, 150, 'varje kväll kom i mål');
  // Provet är bara värt något om det som ska krångla faktiskt har krånglat.
  assert.ok(report.peeks > 50 && report.restarts > 50 && report.undone > 50 && report.finishers > 200, JSON.stringify(report));
  for (const step of ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score', 'final', 'end']) assert.ok(report.steps[step] > 0, step);
});

test('ett tryck på stopp efter att tiden gått ut räknas som att tiden gick ut', () => {
  // Längst tid är bäst: laget höll hela tiden, inte längre än så.
  const high = at('balansen', 'play');
  high.g.clock.add(63_400);
  assert.equal(high.g.as('judge', { t: 'stop', team: high.a }), null);
  assert.equal(high.s.step, 'result');
  assert.deepEqual([high.s.results[high.a], high.s.results[high.b]], [60, 60]);
  high.g.as('judge', { t: 'next' });
  assert.equal(high.g.room.records.balansen.value, 60, 'rekordet kan inte bli längre än uppdragets tid');

  // Kortast tid är bäst: laget kom inte i mål.
  const low = at('tystnaden', 'play');
  low.g.clock.add(95_000);
  assert.equal(low.g.as('judge', { t: 'stop', team: low.a }), null);
  assert.equal(low.s.step, 'result');
  assert.deepEqual([low.s.results[low.a], low.s.results[low.b]], [null, null]);

  // I tid stoppas klockan som vanligt.
  const ok = at('balansen', 'play');
  ok.g.clock.add(12_340);
  ok.g.as('judge', { t: 'stop', team: ok.a });
  assert.equal(ok.s.results[ok.a], 12.3);
});

test('kontrollantens rättning håller sig inom det möjliga', () => {
  const time = at('masken', 'play');
  time.g.clock.add(70_000);
  time.g.as('judge', { t: 'stop', team: time.a });
  assert.equal(time.s.step, 'result');
  assert.equal(time.g.as('judge', { t: 'setResult', team: time.a, value: 9999 }), null);
  assert.equal(time.s.results[time.a], 60, 'en tid kan inte vara längre än uppdragets tid');
  time.g.as('judge', { t: 'setResult', team: time.a, value: 12.34 });
  assert.equal(time.s.results[time.a], 12.3);
  assert.equal(time.g.as('judge', { t: 'setResult', team: time.a, value: -1 }), 'ogiltigt resultat');

  const count = at('kedjan', 'play');
  count.g.as('judge', { t: 'next' });
  count.g.as('judge', { t: 'next' });
  count.g.as('judge', { t: 'next' });
  assert.equal(count.s.step, 'result');
  count.g.as('judge', { t: 'setResult', team: count.a, value: 3.7 });
  assert.equal(count.s.results[count.a], 4, 'det som räknas är hela tal');
  count.g.as('judge', { t: 'setResult', team: count.a, value: null });
  assert.equal(count.s.results[count.a], null);
});

test('medan buden är hemliga kan ingen byta till motståndarlaget och tjuvkika', () => {
  const { g, s, a, b, watchers } = at('kedjan', 'bid');
  const [w] = watchers;
  g.as(b, { t: 'bid', value: 17 });
  assert.equal(g.as(a, { t: 'leave' }), 'vänta tills buden är lagda');
  assert.equal(g.as(a, { t: 'choose', role: 'team', team: b }), 'vänta tills buden är lagda');
  assert.equal(g.as(a, { t: 'choose', role: 'audience' }), 'vänta tills buden är lagda');
  assert.equal(g.room.devices[`tok-${a}`].team, a);

  // En mobil utan plats får gå med, så att en ny mobil kan ersätta en som dött. Lagen som tittar är inte låsta nu.
  addDevice(g.room, 'tok-ny', 'dev-ny');
  assert.equal(apply(g.room, 'tok-ny', { t: 'choose', role: 'team', team: a }, false), null);
  assert.equal(g.as(w, { t: 'leave' }), null);
  assert.equal(g.as(w, { t: 'choose', role: 'team', team: w }), null);
  // Värden kan fortfarande ta bort en mobil.
  assert.equal(g.admin({ t: 'kick', device: 'dev-ny' }), null);

  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  assert.equal(s.step, 'call');
  // Nu är buden visade: de som duellerar får byta, men lagen som synar sitter kvar tills alla har synat.
  assert.equal(g.as(w, { t: 'leave' }), 'vänta tills alla har synat');
  assert.equal(g.as(a, { t: 'leave' }), null);
  assert.equal(g.as(a, { t: 'choose', role: 'team', team: a }), null);
  for (const id of watchers) g.as(id, { t: 'call', target: 'pass' });
  assert.equal(s.step, 'ready');
  assert.equal(g.as(w, { t: 'leave' }), null);
});

test('under spelet kan ingen ny bli kontrollant så länge det finns en', () => {
  const lobby = setup(4, 1);
  addDevice(lobby.room, 'tok-extra', 'dev-extra');
  assert.equal(apply(lobby.room, 'tok-extra', { t: 'choose', role: 'judge' }, false), null, 'i lobbyn får flera välja kontrollant');

  const { g } = at('kedjan', 'ready');
  assert.equal(g.as('aud', { t: 'choose', role: 'judge' }), 'det finns redan en kontrollant. Värden kan ta bort den');
  assert.equal(g.as('aud', { t: 'next' }), 'bara värden får gå vidare här');
  assert.equal(g.as('judge', { t: 'choose', role: 'judge' }), null, 'kontrollanten själv får välja om');
  // Värden tar bort kontrollanten. Då kan någon annan ta över.
  assert.equal(g.admin({ t: 'kick', device: 'dev-judge' }), null);
  assert.equal(g.as('aud', { t: 'choose', role: 'judge' }), null);
  assert.equal(g.as('aud', { t: 'next' }), null);
});

test('vid lika bud avgör slumpen vem som börjar, inte platsen i schemat', () => {
  const first = {};
  for (let seed = 1; seed <= 200; seed++) {
    const g = setup(4, seed);
    g.admin({ t: 'start' });
    const s = g.room.syna;
    const [a, b] = s.schedule[0];
    g.admin({ t: 'next' });
    g.as(a, { t: 'lockBid' });
    g.as(b, { t: 'lockBid' });
    assert.equal(s.bids[a].value, s.bids[b].value);
    first[s.order[0] === a ? 'först i schemat' : 'sist i schemat'] = (first[s.order[0] === a ? 'först i schemat' : 'sist i schemat'] ?? 0) + 1;
  }
  assert.ok(first['först i schemat'] > 70 && first['sist i schemat'] > 70, JSON.stringify(first));
});
