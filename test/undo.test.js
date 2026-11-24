// Ångra och gör om: värden lägger tillbaka läget före det senaste steget, och ett försök går att göra om.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFor } from '../server/room.js';
import { beginRound, tick } from '../games/syna/game.js';
import { taskById } from '../games/syna/tasks.js';
import { admin, judgePanel, undoLabel } from '../public/syna.js';
import { setup, playRound } from './helpers.js';

// Läget utan historiken, som text: två lägen är lika när texterna är lika.
const frozen = (room) => {
  const { history, ...syna } = room.syna;
  return JSON.stringify({ syna, records: room.records });
};
const stepKey = (s) => [s.round, s.step, s.turn, s.tasks[s.round], s.topic].join('|');
const watchersOf = (g, a, b) => g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
const adminView = (g) => viewFor(g.room, null, 'admin').syna;
const label = (g) => undoLabel(adminView(g));

// Startar ett spel med ett bestämt första uppdrag och går fram till stunden före första försöket.
function toReady(taskId, teams = 4) {
  const g = setup(teams, 5);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = taskId;
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  assert.equal(label(g), null, 'i första steget finns inget att ångra');
  assert.equal(g.admin({ t: 'undo' }), 'det finns inget att ångra');
  g.admin({ t: 'next' });
  assert.equal(label(g), 'Ångra: tillbaka till uppdraget');
  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  assert.equal(label(g), 'Ångra: tillbaka till budgivningen');
  for (const w of watchersOf(g, a, b)) g.as(w, { t: 'call', target: 'pass' });
  assert.equal(s.step, 'ready');
  assert.equal(label(g), 'Ångra: tillbaka till synen');
  return { g, s, a, b };
}

test('att ångra lägger tillbaka exakt läget före varje steg: bud, syn, resultat, poäng och rekord', () => {
  for (const [taskId, results] of [['kedjan', (a, b) => ({ [a]: 12, [b]: 9 })], ['balansen', (a, b) => ({ [a]: 20, [b]: 35 })], ['tystnaden', (a, b) => ({ [a]: 40, [b]: null })]]) {
    const g = setup(4, 9);
    g.admin({ t: 'start' });
    const s = g.room.syna;
    s.tasks[0] = taskId;
    beginRound(g.room, g.rng);
    const [a, b] = s.schedule[0];
    const [w1] = watchersOf(g, a, b);

    // Varje meddelande som får spelet att lämna ett steg ska ha sparat läget före. Under ett försök sparas inget.
    const expected = [];
    const watch = (send) => (...args) => {
      const before = s.step === 'play' ? null : frozen(g.room);
      const key = stepKey(s);
      const error = send(...args);
      if (!error && before && stepKey(s) !== key) expected.push(before);
      return error;
    };
    const { task } = playRound({ ...g, admin: watch(g.admin), as: watch(g.as) }, { bids: { [a]: 10, [b]: 20 }, results: results(a, b), calls: { [w1]: b } });
    assert.equal(s.step, 'score');
    const scored = frozen(g.room);
    assert.ok(Object.values(s.scores).some((p) => p !== 0), `${taskId}: ronden gav poäng`);
    assert.ok(g.room.records[task.id], `${taskId}: ronden satte ett rekord`);
    assert.equal(label(g), 'Ångra: tillbaka till resultatet');

    // Tillbaka till resultatet: poängen och rekordet är borta, och samma godkännande ger samma poäng igen.
    assert.equal(g.admin({ t: 'undo', step: 'score' }), null);
    assert.equal(s.step, 'result');
    assert.equal(frozen(g.room), expected.at(-1));
    assert.ok(Object.values(s.scores).every((p) => p === 0), `${taskId}: poängen är tillbaka på noll`);
    assert.equal(g.room.records[task.id], undefined, `${taskId}: rekordet är borta`);
    assert.equal(g.as('judge', { t: 'next' }), null);
    assert.equal(frozen(g.room), scored);

    // Sedan steg för steg bakåt, så långt historiken räcker.
    assert.ok(s.history.length <= 6 && s.history.length >= 5, `${taskId}: ${s.history.length} sparade lägen`);
    let steps = 0;
    while (s.history.length) {
      const want = expected.pop();
      assert.equal(g.admin({ t: 'undo' }), null);
      assert.equal(frozen(g.room), want, `${taskId}: steg ${steps + 1} bakåt`);
      steps += 1;
    }
    assert.ok(steps >= 5, `${taskId}: ${steps} steg bakåt`);
    assert.equal(g.admin({ t: 'undo' }), 'det finns inget att ångra');
  }
});

test('ett försök som startats av misstag går att börja om, av kontrollanten eller värden', () => {
  for (const who of ['judge', 'admin']) {
    const { g, s, a, b } = toReady('balansen');
    const send = (msg) => (who === 'admin' ? g.admin(msg) : g.as('judge', msg));
    const before = frozen(g.room);
    assert.equal(g.as('judge', { t: 'undo', step: 'ready' }), 'bara värden får ångra', 'kontrollanten ångrar bara under ett försök');

    assert.equal(g.as('judge', { t: 'next' }), null);
    assert.equal(s.step, 'play');
    g.clock.add(5000);
    assert.equal(g.as('judge', { t: 'stop', team: a }), null);
    assert.equal(s.results[a], 5);
    assert.equal(label(g), 'Börja om försöket');
    assert.match(judgePanel(viewFor(g.room, 'tok-judge', 'player'), g.clock.now), /data-do="undo" data-step="play">Startade tiden av misstag\? Börja om försöket</);

    for (const t of [a, b, 'aud']) assert.equal(g.as(t, { t: 'undo', step: 'play' }), 'bara värden får ångra', t);
    assert.equal(send({ t: 'undo', step: 'result' }), 'läget ändrades, försök igen');
    assert.equal(send({ t: 'undo', step: 'play' }), null);
    assert.equal(frozen(g.room), before, 'läget är som före starten');
    assert.equal(s.step, 'ready');
    assert.equal(s.endsAt, null);
    assert.equal(s.results[a], null);
    assert.equal(tick(g.room, g.clock.now + 600_000), false, 'ingen klocka går');

    // Försöket görs om och ronden går klart som vanligt.
    assert.equal(g.as('judge', { t: 'next' }), null);
    g.clock.add(30_000);
    assert.equal(g.as('judge', { t: 'stop', team: a }), null);
    assert.equal(g.as('judge', { t: 'stop', team: b }), null);
    assert.equal(s.step, 'result');
    assert.equal(s.results[a], 30);
    assert.equal(g.as('judge', { t: 'next' }), null);
    assert.equal(s.step, 'score');
  }
});

test('efter ett försök kan värden göra om det, och bara laget som just tävlade tävlar igen', () => {
  const { g, s } = toReady('kedjan');
  const [first, second] = s.order;
  const count = (team, n) => { for (let i = 0; i < n; i++) assert.equal(g.as('judge', { t: 'count', team, delta: 1 }), null); };

  g.as('judge', { t: 'next' });
  count(first, 4);
  g.as('judge', { t: 'next' }); // tiden avbryts: lag två står på tur
  assert.deepEqual([s.step, s.turn, s.results[first]], ['ready', 1, 4]);
  assert.equal(label(g), 'Gör om försöket');
  const card = admin(viewFor(g.room, null, 'admin'), g.clock.now, '');
  assert.match(card, /<h2>Blev det fel\?<\/h2>\s*<button class="btn ghost" data-do="undo" data-step="ready" data-arm="1">Gör om försöket</);
  assert.match(card, /Tiden och räkningen nollställs för laget som just tävlade\./);
  assert.match(admin(viewFor(g.room, null, 'admin'), g.clock.now, 'undo'), /data-do="undo" data-step="ready" data-arm="1">Säker\? Tryck igen</);

  assert.equal(g.admin({ t: 'undo', step: 'ready' }), null);
  assert.deepEqual([s.step, s.turn, s.results[first]], ['ready', 0, null], 'lag ett står på tur igen, utan resultat');

  g.as('judge', { t: 'next' });
  count(first, 7);
  g.as('judge', { t: 'next' });
  g.as('judge', { t: 'next' });
  count(second, 3);
  g.as('judge', { t: 'next' });
  assert.deepEqual([s.step, s.results[first], s.results[second]], ['result', 7, 3]);

  // Vid resultatet gäller ångrandet det senaste försöket: lag två gör om, och lag etts resultat står kvar.
  assert.equal(label(g), 'Gör om försöket');
  assert.equal(g.admin({ t: 'undo', step: 'result' }), null);
  assert.deepEqual([s.step, s.turn, s.results[first], s.results[second]], ['ready', 1, 7, null]);
});

test('ett bytt uppdrag och en ny rond går att ångra, och knappen säger vart man kommer', () => {
  const g = setup(4, 2);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const original = [s.tasks[0], s.topic];
  assert.equal(g.admin({ t: 'swapTask' }), null);
  assert.notEqual(s.tasks[0], original[0]);
  assert.equal(label(g), 'Ångra: tillbaka till uppdraget');
  assert.equal(g.admin({ t: 'undo' }), null);
  assert.deepEqual([s.tasks[0], s.topic], original);

  const [a, b] = s.schedule[0];
  const [w1] = watchersOf(g, a, b);
  const { min } = taskById(s.tasks[0]).bid;
  playRound(g, { bids: { [a]: min, [b]: min }, results: { [a]: 1, [b]: 1 }, calls: { [w1]: 'pass' } });
  const score = frozen(g.room);
  assert.equal(g.admin({ t: 'next' }), null);
  assert.deepEqual([s.round, s.step], [1, 'intro']);
  assert.equal(label(g), 'Ångra: tillbaka till rond 1');
  assert.equal(g.admin({ t: 'undo', step: 'intro' }), null);
  assert.equal(frozen(g.room), score);
});

test('det sparade läget före ett steg når aldrig en mobil eller storbilden', () => {
  const { g, s, a, b } = toReady('viskningen');
  const secret = s.notes[a];
  assert.ok(s.history.length >= 3 && JSON.stringify(s.history).includes(secret), 'historiken innehåller kontrollantens lappar och buden');
  for (const [token, kind] of [[`tok-${a}`, 'player'], [`tok-${b}`, 'player'], ['tok-aud', 'player'], [null, 'stage']]) {
    const sent = JSON.stringify(viewFor(g.room, token, kind));
    assert.ok(!sent.includes('history') && !sent.includes('"back"') && !sent.includes(secret), `${token ?? 'storbilden'}`);
  }
  // Värden och kontrollanten får bara veta vilket steg ett ångrande leder till.
  assert.deepEqual(adminView(g).back, { step: 'call', round: 0 });
  assert.deepEqual(viewFor(g.room, 'tok-judge', 'player').syna.back, { step: 'call', round: 0 });
  assert.ok(!JSON.stringify(viewFor(g.room, null, 'admin')).includes('history'));

  // Tillbaka till budgivningen: buden är hemliga igen för dem som inte lagt dem.
  g.admin({ t: 'undo' });
  g.admin({ t: 'undo' });
  assert.equal(s.step, 'bid');
  const other = viewFor(g.room, `tok-${a}`, 'player').syna.bids[b];
  assert.equal(other.value, null);
});

test('ett sparat läge från versionen före saknar historik och går att spela vidare', () => {
  const { g, s } = toReady('djuren');
  delete s.history;
  assert.equal(viewFor(g.room, null, 'admin').syna.back, undefined);
  assert.equal(g.admin({ t: 'undo' }), 'det finns inget att ångra');
  assert.equal(g.as('judge', { t: 'next' }), null);
  assert.equal(s.history.length, 1);
  assert.equal(g.admin({ t: 'undo', step: 'play' }), null);
  assert.equal(s.step, 'ready');
  // En historik som inte går att använda fäller ingenting.
  for (const broken of ['trasig', [null], [{ syna: null }], [{ syna: {} }], 7]) {
    s.history = broken;
    assert.doesNotThrow(() => viewFor(g.room, null, 'admin'));
    assert.equal(g.admin({ t: 'undo' }), 'det finns inget att ångra');
  }
  s.history = 'trasig';
  assert.equal(g.as('judge', { t: 'next' }), null);
  assert.equal(s.history.length, 1, 'nästa steg börjar en ny historik');
});
