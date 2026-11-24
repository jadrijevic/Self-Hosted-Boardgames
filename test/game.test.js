import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFor } from '../server/room.js';
import { scoreRound, beginRound } from '../games/syna/game.js';
import { taskById } from '../games/syna/tasks.js';
import { setup, playRound } from './helpers.js';

test('poäng: klarat bud ger 1, djärvaste klarade budet 2 till, missat bud 0', () => {
  const r = scoreRound({ direction: 'high', bids: { a: 12, b: 14 }, results: { a: 13, b: 15 } });
  assert.deepEqual(r.points, { a: 1, b: 3 });
  const miss = scoreRound({ direction: 'high', bids: { a: 12, b: 14 }, results: { a: 13, b: 11 }, calls: { c: 'b', d: 'pass' } });
  assert.deepEqual(miss.made, { a: true, b: false });
  assert.deepEqual(miss.points, { a: 3, b: 0, c: 2, d: 0 });
});

test('poäng: fel syn ger det synade laget 1, och den som synade förlorar inget', () => {
  const r = scoreRound({ direction: 'high', bids: { a: 12, b: 14 }, results: { a: 13, b: 11 }, calls: { c: 'a' } });
  assert.deepEqual(r.points, { a: 4, b: 0, c: 0 });
  // Inget utfall ger någon minuspoäng, inte heller med dubbla poäng och flera syner.
  for (const results of [{ a: 13, b: 15 }, { a: 13, b: 11 }, { a: 1, b: 1 }]) {
    for (const calls of [{ c: 'a', d: 'a' }, { c: 'a', d: 'b' }, { c: 'b', d: 'pass' }]) {
      const { points } = scoreRound({ direction: 'high', bids: { a: 12, b: 14 }, results, calls, factor: 2 });
      assert.ok(Object.values(points).every((p) => p >= 0), JSON.stringify({ results, calls, points }));
    }
  }
});

test('poäng: lika bud delar på bonusen, och ingen bonus om båda missar', () => {
  assert.deepEqual(scoreRound({ direction: 'high', bids: { a: 10, b: 10 }, results: { a: 10, b: 12 } }).points, { a: 2, b: 2 });
  assert.deepEqual(scoreRound({ direction: 'high', bids: { a: 10, b: 9 }, results: { a: 5, b: 5 }, calls: { c: 'a' } }).points, { a: 0, b: 0, c: 2 });
});

test('poäng: vid tid är kortast bud djärvast, och utan sluttid är budet missat', () => {
  assert.deepEqual(scoreRound({ direction: 'low', bids: { a: 40, b: 30 }, results: { a: 38, b: 29 } }).points, { a: 1, b: 3 });
  const r = scoreRound({ direction: 'low', bids: { a: 40, b: 30 }, results: { a: 35, b: null } });
  assert.deepEqual(r.made, { a: true, b: false });
  assert.deepEqual(r.points, { a: 3, b: 0 });
});

test('poäng: dubbla poäng dubblar allt i ronden', () => {
  const r = scoreRound({ direction: 'high', bids: { a: 12, b: 14 }, results: { a: 13, b: 11 }, calls: { c: 'b' }, factor: 2 });
  assert.deepEqual(r.points, { a: 6, b: 0, c: 4 });
});

test('bara värden får starta, och starten ger sex ronder utan material', () => {
  const g = setup();
  assert.equal(g.as('rod', { t: 'start' }), 'bara värden får starta');
  assert.equal(g.admin({ t: 'start' }), null);
  const s = g.room.syna;
  assert.equal(g.room.phase, 'game');
  assert.equal(s.schedule.length, 6);
  assert.equal(new Set(s.tasks).size, 6);
  assert.ok(s.tasks.every((id) => !taskById(id).material));
  assert.equal(s.doubleFrom, 4);
  assert.equal(g.admin({ t: 'start' }), 'spelet är redan igång');
});

test('buden är hemliga tills båda har låst', () => {
  const g = setup();
  g.admin({ t: 'start' });
  g.admin({ t: 'next' });
  const [a, b] = g.room.syna.schedule[0];
  const watcher = g.room.teams.map((t) => t.id).find((id) => id !== a && id !== b);
  const task = taskById(g.room.syna.tasks[0]);
  const bid = task.bid.min + task.bid.step;
  assert.equal(g.as(a, { t: 'bid', value: bid }), null);
  assert.equal(g.as(watcher, { t: 'bid', value: bid }), 'ert lag budar inte i den här ronden');
  assert.equal(g.as(a, { t: 'lockBid' }), null);
  assert.equal(g.as(a, { t: 'bid', value: bid + task.bid.step }), 'budet är redan låst');

  const see = (who, kind = 'player') => viewFor(g.room, who ? `tok-${who}` : null, kind).syna.bids;
  assert.equal(see(a)[a].value, bid);
  assert.deepEqual(see(b)[a], { locked: true, value: null });
  assert.equal(see(null, 'stage')[a].value, null);
  assert.equal(see(null, 'admin')[a].value, bid);

  assert.equal(g.as(b, { t: 'lockBid' }), null);
  assert.equal(g.room.syna.step, 'call');
  assert.equal(see(b)[a].value, bid);
});

test('synen är hemlig tills alla har valt, och bara lag som tittar får syna', () => {
  const g = setup();
  g.admin({ t: 'start' });
  g.admin({ t: 'next' });
  const [a, b] = g.room.syna.schedule[0];
  const [w1, w2] = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  assert.equal(g.as(a, { t: 'call', target: b }), 'ert lag tittar inte i den här ronden');
  assert.equal(g.as(w1, { t: 'call', target: 'någon' }), 'okänt val');
  assert.equal(g.as(w1, { t: 'call', target: b }), null);
  assert.equal(viewFor(g.room, `tok-${w2}`, 'player').syna.calls[w1], 'hidden');
  assert.equal(viewFor(g.room, `tok-${w1}`, 'player').syna.calls[w1], b);
  assert.equal(g.as(w2, { t: 'call', target: 'pass' }), null);
  assert.equal(g.room.syna.step, 'ready');
  assert.equal(viewFor(g.room, `tok-${w2}`, 'player').syna.calls[w1], b);
});

test('en hel kväll med fyra lag: poäng, dubbla poäng, dold ställning, final och slut', () => {
  const g = setup(4, 7);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const total = Object.fromEntries(g.room.teams.map((t) => [t.id, 0]));
  for (let r = 0; r < 6; r++) {
    const task = taskById(s.tasks[r]);
    const [a, b] = s.schedule[r];
    const [w1] = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
    // a budar försiktigt och klarar det, b budar högt och missar. w1 synar b.
    const low = task.direction === 'low';
    const bids = { [a]: low ? task.bid.max : task.bid.min, [b]: low ? task.bid.min : task.bid.max };
    const results = low ? { [a]: task.bid.max - 1, [b]: null } : { [a]: task.bid.min, [b]: task.bid.min };
    playRound(g, { bids, results, calls: { [w1]: b } });
    const f = r >= 4 ? 2 : 1;
    assert.deepEqual(s.made, { [a]: true, [b]: false }, `rond ${r + 1}: ${task.id}`);
    assert.equal(s.points[a], 3 * f);
    assert.equal(s.points[b], 0);
    assert.equal(s.points[w1], 2 * f);
    total[a] += 3 * f;
    total[w1] += 2 * f;

    const stage = viewFor(g.room, null, 'stage').syna;
    assert.equal(stage.double, r >= 4);
    assert.equal(stage.hidden, r >= 4);
    if (r >= 4) assert.equal(stage.scores, null); else assert.deepEqual(stage.scores, total);
    assert.deepEqual(viewFor(g.room, null, 'admin').syna.scores, total);
    assert.equal(g.as(a, { t: 'next' }), 'bara värden får gå vidare här');
    assert.equal(g.admin({ t: 'next' }), null);
  }
  assert.equal(s.step, 'final');
  assert.equal(viewFor(g.room, null, 'stage').syna.scores, null);
  assert.equal(g.as('judge', { t: 'finalResult', success: true }), 'bara värden avgör finalen');
  assert.equal(g.admin({ t: 'finalResult', success: false }), null);
  assert.equal(s.final.tries, 1);
  assert.equal(g.admin({ t: 'finalResult', success: true }), null);
  assert.equal(s.step, 'end');
  const end = viewFor(g.room, null, 'stage').syna;
  assert.deepEqual(end.scores, total);
  assert.equal(end.standings[0].place, 1);
  assert.ok(end.standings.every((row, i) => i === 0 || row.score <= end.standings[i - 1].score));
  assert.equal(g.admin({ t: 'endGame' }), null);
  assert.equal(g.room.phase, 'lobby');
  assert.ok(Object.keys(g.room.records).length >= 1);
});

test('när lagen turas om går det djärvaste budet sist', () => {
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = 'djuren';
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  playRound(g, { bids: { [a]: 9, [b]: 5 }, results: { [a]: 9, [b]: 6 } });
  assert.deepEqual(s.order, [b, a]);
  assert.deepEqual(s.results, { [a]: 9, [b]: 6 });
  assert.deepEqual(s.made, { [a]: true, [b]: true });
});

test('tidsuppdrag: stoppad klocka ger tiden, ostoppad ger hela tiden eller missat bud', () => {
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const [a, b] = s.schedule[0];

  s.tasks[0] = 'balansen';
  beginRound(g.room, g.rng);
  playRound(g, { bids: { [a]: 10, [b]: 60 }, results: { [a]: 12.3, [b]: null } });
  assert.deepEqual(s.results, { [a]: 12.3, [b]: 60 });
  assert.deepEqual(s.made, { [a]: true, [b]: true });
  assert.equal(s.points[b], 3);

  g.admin({ t: 'next' });
  const [c, d] = s.schedule[1];
  s.tasks[1] = 'tystnaden';
  beginRound(g.room, g.rng);
  playRound(g, { bids: { [c]: 45, [d]: 30 }, results: { [c]: 40, [d]: null } });
  assert.deepEqual(s.results, { [c]: 40, [d]: null });
  assert.deepEqual(s.made, { [c]: true, [d]: false });
});

test('klockan avslutar tiden av sig själv', async () => {
  const { tick } = await import('../server/room.js');
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = 'tornet';
  beginRound(g.room, g.rng);
  g.admin({ t: 'next' });
  g.admin({ t: 'next' });
  g.admin({ t: 'next' });
  assert.equal(s.step, 'ready');
  g.admin({ t: 'next' });
  assert.equal(s.step, 'play');
  assert.equal(tick(g.room, g.clock.now + 59_000), false);
  assert.equal(tick(g.room, g.clock.now + 60_000), true);
  assert.equal(s.step, 'result');
});

test('kontrollantens mening syns bara för kontrollant och värd', () => {
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = 'viskningen';
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  assert.notEqual(s.notes[a], s.notes[b]);
  assert.equal(viewFor(g.room, 'tok-judge', 'player').syna.notes[a], s.notes[a]);
  assert.ok(viewFor(g.room, null, 'admin').syna.notes);
  for (const who of [a, b, 'aud']) assert.equal(viewFor(g.room, `tok-${who}`, 'player').syna.notes, undefined);
  assert.ok(!JSON.stringify(viewFor(g.room, null, 'stage')).includes(s.notes[a]));
});

test('bara kontrollant och värd räknar, och värden kan agera åt ett lag', () => {
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = 'tornet';
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  const [w1, w2] = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  g.admin({ t: 'next' });
  assert.equal(g.admin({ t: 'bid', team: a, value: 7 }), null);
  assert.equal(g.admin({ t: 'lockBid', team: a }), null);
  assert.equal(g.admin({ t: 'lockBid', team: b }), null);
  assert.equal(g.admin({ t: 'call', team: w1, target: a }), null);
  assert.equal(g.admin({ t: 'call', team: w2, target: 'pass' }), null);
  g.admin({ t: 'next' });
  assert.equal(g.as('aud', { t: 'count', team: a, delta: 1 }), 'bara kontrollanten får räkna');
  assert.equal(g.as(a, { t: 'count', team: a, delta: 1 }), 'bara kontrollanten får räkna');
  assert.equal(g.admin({ t: 'count', team: a, delta: 1 }), null);
  assert.equal(g.as('judge', { t: 'count', team: a, delta: 5 }), 'ogiltigt steg');
  assert.equal(s.results[a], 1);
});

test('uppdraget kan bytas före budgivningen, och rekordet följer med till nästa kväll', () => {
  const g = setup();
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const before = s.tasks[0];
  assert.equal(g.as('judge', { t: 'swapTask' }), 'bara värden får byta uppdrag');
  assert.equal(g.admin({ t: 'swapTask' }), null);
  assert.notEqual(s.tasks[0], before);
  assert.equal(new Set(s.tasks).size, 6);

  s.tasks[0] = 'tornet';
  beginRound(g.room, g.rng);
  const [a, b] = s.schedule[0];
  playRound(g, { bids: { [a]: 5, [b]: 6 }, results: { [a]: 9, [b]: 7 } });
  assert.equal(s.newRecord, a);
  assert.equal(g.room.records.tornet.value, 9);
  assert.equal(viewFor(g.room, null, 'stage').syna.record.value, 9);
  g.admin({ t: 'endGame' });
  g.admin({ t: 'start' });
  assert.equal(g.room.records.tornet.value, 9);
});

test('två lag hoppar över synen, och udda antal lag har inga dubbla poäng', () => {
  const two = setup(2);
  two.admin({ t: 'start' });
  two.admin({ t: 'next' });
  const [a, b] = two.room.syna.schedule[0];
  two.as(a, { t: 'lockBid' });
  two.as(b, { t: 'lockBid' });
  assert.equal(two.room.syna.step, 'ready');
  assert.equal(two.room.syna.doubleFrom, 5);

  for (const n of [3, 5]) {
    const g = setup(n);
    g.admin({ t: 'start' });
    assert.equal(g.room.syna.doubleFrom, null);
    assert.equal(g.room.syna.hideFrom, g.room.syna.schedule.length - 1);
  }
});
