// Övningsronden: en första rond som går som en vanlig men inte ger poäng eller rekord.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, normalize, viewFor } from '../server/room.js';
import { taskById } from '../games/syna/tasks.js';
import { player, stage, admin } from '../public/syna.js';
import { setup, playRound } from './helpers.js';

const strip = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const frozen = (room) => { const { history, ...syna } = room.syna; return JSON.stringify({ syna, records: room.records }); };

// Ett spel med övningsrond. Testhjälpen slår annars av den.
function withPractice(teams = 4, seed = 4) {
  const g = setup(teams, seed);
  g.room.settings.practice = true;
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const [a, b] = s.practice?.duel ?? [];
  const watchers = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  return { g, s, a, b, watchers };
}

// Spelar övningen fram till poängen: a klarar ett försiktigt bud, b missar ett djärvt, första laget som tittar synar b.
function playPractice({ g, s, a, b, watchers }) {
  assert.equal(g.admin({ t: 'next' }), null);
  for (const [t, value] of [[a, 10], [b, 40]]) { g.as(t, { t: 'bid', value }); g.as(t, { t: 'lockBid' }); }
  watchers.forEach((w, i) => g.as(w, { t: 'call', target: i === 0 ? b : 'pass' }));
  assert.equal(s.step, 'ready');
  g.as('judge', { t: 'next' });
  g.clock.add(15_000);
  g.as('judge', { t: 'stop', team: b });
  g.clock.add(5_000);
  g.as('judge', { t: 'stop', team: a });
  assert.equal(s.step, 'result');
  g.as('judge', { t: 'next' });
  assert.equal(s.step, 'score');
}

test('övningsronden är på från början, spelas före rond 1 med Masken och ligger utanför schemat', () => {
  assert.equal(newRoom(4).settings.practice, true);
  assert.equal(normalize({ phase: 'lobby', game: 'syna', teams: [], devices: {}, settings: { material: false } }).settings.practice, true, 'ett sparat läge från versionen före får övningsronden');

  for (const teams of [2, 3, 4, 5, 6]) {
    for (let seed = 1; seed <= 40; seed++) {
      const { g, s, a, b } = withPractice(teams, seed);
      assert.deepEqual([s.practice.task, s.round, s.step], ['masken', 0, 'intro']);
      assert.equal(s.schedule.length, teams === 5 ? 5 : 6, 'schemat är lika långt som utan övning');
      assert.ok(!s.tasks.includes('masken'), 'Masken kommer inte igen senare under kvällen');
      const first = s.schedule[0];
      // Med fyra lag eller fler duellerar två lag som inte möts i rond 1.
      if (teams >= 4) assert.ok(!first.includes(a) && !first.includes(b), `${teams} lag: ${[a, b]} mot ${first}`);
      else assert.ok(first.includes(a) || first.includes(b));
      const view = viewFor(g.room, null, 'stage').syna;
      assert.deepEqual([view.practice, view.task.id, view.round, view.record], [true, 'masken', 0, null]);
      assert.equal(g.admin({ t: 'swapTask' }), 'övningsronden har ett fast uppdrag. Hoppa över den i stället');
    }
  }
});

test('övningsronden visar vad poängen hade blivit, men rör varken ställningen eller rekordboken', () => {
  const p = withPractice();
  const { g, s, a, b, watchers } = p;
  const big = () => strip(stage(viewFor(g.room, null, 'stage'), g.clock.now));
  const phone = (who) => strip(player(viewFor(g.room, `tok-${who}`, 'player'), g.clock.now));
  const host = () => admin(viewFor(g.room, null, 'admin'), g.clock.now, '');

  assert.match(big(), /^Övningsrond Räknas inte Masken /);
  assert.match(big(), /Övningsrond: inga poäng och inga rekord\./);
  assert.doesNotMatch(big(), /Rond 1 av 6|släktrekord/i);
  assert.match(phone(a), /Övningsrond · Masken .* räknas inte/);
  assert.match(host(), /<h2>Övningsrond: Masken<\/h2>/);
  assert.match(host(), /data-do="skipPractice">Hoppa över övningen</);
  assert.doesNotMatch(host(), /data-do="swapTask"/);

  playPractice(p);
  assert.deepEqual([s.points[a], s.points[b], s.points[watchers[0]]], [3, 0, 2], 'poängen räknas ut som i en vanlig rond');
  assert.ok(Object.values(s.scores).every((x) => x === 0), 'ställningen är orörd');
  assert.deepEqual(g.room.records, {}, 'rekordboken är orörd');
  assert.ok(Object.values(s.recordsSet).every((x) => x === 0));
  assert.equal(s.newRecord, null);
  assert.match(phone(a), /Det hade gett er \+3 poäng/);
  assert.match(phone(watchers[0]), /Det hade gett er \+2 poäng/);
  assert.match(phone('aud'), /Övningen är klar/);
  assert.match(big(), /Så hade poängen blivit\. Övningen räknas inte: nu börjar spelet\./);
  assert.match(host(), /data-do="next">Börja spelet: rond 1</);

  // Sedan börjar rond 1, som om övningen aldrig hade funnits.
  assert.equal(g.admin({ t: 'next' }), null);
  assert.deepEqual([s.practice, s.round, s.step], [null, 0, 'intro']);
  const view = viewFor(g.room, null, 'stage').syna;
  assert.equal(view.practice, false);
  assert.notEqual(view.task.id, 'masken');
  assert.match(big(), /^Rond 1 av 6 /);
  assert.doesNotMatch(big(), /Övningsrond|Räknas inte/);
  assert.match(host(), /data-do="swapTask"/);
  for (let i = 0; i < 20; i++) { g.admin({ t: 'swapTask' }); assert.notEqual(s.tasks[0], 'masken'); }

  const [c, d] = s.schedule[0];
  const task = taskById(s.tasks[0]);
  const low = task.direction === 'low';
  playRound(g, { bids: { [c]: low ? task.bid.max : task.bid.min, [d]: low ? task.bid.max : task.bid.min }, results: { [c]: low ? 1 : task.bid.max, [d]: low ? 1 : task.bid.max } });
  assert.ok(s.scores[c] > 0 && s.scores[d] > 0, 'rond 1 räknas');
  assert.ok(g.room.records[task.id], 'rond 1 sätter rekord');
});

test('värden kan hoppa över övningen i vilket steg som helst, och ingen annan kan det', () => {
  const reach = {
    intro: () => {},
    bid: (p) => p.g.admin({ t: 'next' }),
    call: (p) => { reach.bid(p); p.g.as(p.a, { t: 'lockBid' }); p.g.as(p.b, { t: 'lockBid' }); },
    ready: (p) => { reach.call(p); for (const w of p.watchers) p.g.as(w, { t: 'call', target: 'pass' }); },
    play: (p) => { reach.ready(p); p.g.as('judge', { t: 'next' }); },
    score: (p) => playPractice(p),
  };
  for (const [step, go] of Object.entries(reach)) {
    const p = withPractice();
    go(p);
    assert.equal(p.s.step, step);
    for (const who of [p.a, 'judge', 'aud']) assert.equal(p.g.as(who, { t: 'skipPractice' }), 'bara värden får hoppa över övningen', `${step}, ${who}`);
    assert.equal(p.g.admin({ t: 'skipPractice' }), null, step);
    assert.deepEqual([p.s.practice, p.s.round, p.s.step, p.s.endsAt], [null, 0, 'intro', null], step);
    assert.ok(Object.values(p.s.scores).every((x) => x === 0));
    assert.deepEqual(p.g.room.records, {});
    assert.equal(p.g.admin({ t: 'skipPractice' }), 'det finns ingen övningsrond att hoppa över');
  }
});

test('övningsronden går att slå av i lobbyn, av värden', () => {
  const g = setup(4, 1);
  g.room.settings.practice = true;
  assert.equal(g.as('rod', { t: 'setPractice', on: false }), 'bara värden får göra det');
  assert.equal(g.admin({ t: 'setPractice', on: false }), null);
  assert.equal(g.room.settings.practice, false);
  g.admin({ t: 'start' });
  assert.equal(g.room.syna.practice, undefined);
  assert.equal(viewFor(g.room, null, 'stage').syna.practice, false);
  assert.equal(g.admin({ t: 'setPractice', on: true }), 'inställningen kan bara ändras i lobbyn');
  assert.equal(g.admin({ t: 'skipPractice' }), 'det finns ingen övningsrond att hoppa över');
});

test('ångra fungerar i övningen och över gränsen till rond 1', () => {
  const p = withPractice();
  const { g, s } = p;
  const intro = frozen(g.room);
  g.admin({ t: 'next' });
  assert.equal(g.admin({ t: 'undo', step: 'bid' }), null);
  assert.equal(frozen(g.room), intro);

  playPractice(p);
  const score = frozen(g.room);
  g.admin({ t: 'next' });
  assert.equal(s.practice, null);
  assert.equal(g.admin({ t: 'undo', step: 'intro' }), null);
  assert.equal(frozen(g.room), score, 'tillbaka i övningens poängsida');
  assert.equal(s.practice.task, 'masken');

  // Att hoppa över övningen går också att ångra.
  const again = withPractice();
  const before = frozen(again.g.room);
  again.g.admin({ t: 'skipPractice' });
  assert.equal(again.g.admin({ t: 'undo' }), null);
  assert.equal(frozen(again.g.room), before);
});
