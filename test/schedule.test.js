import test from 'node:test';
import assert from 'node:assert/strict';
import { newSchedule, assignKinds, dropout, DUELS_PER_TEAM } from '../games/syna/schedule.js';

const count = (schedule) => schedule.flat().reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
const show = (schedule) => schedule.map(([a, b]) => a + b).join(' ');

test('alla lag får lika många dueller vid 2–6 lag', () => {
  for (let n = 2; n <= 6; n++) {
    const teams = [...'ABCDEF'.slice(0, n)];
    const s = newSchedule(teams);
    const per = count(s);
    assert.deepEqual(new Set(Object.values(per)), new Set([DUELS_PER_TEAM[n]]), `${n} lag: ${show(s)}`);
    assert.equal(Object.keys(per).length, n);
  }
});

test('fyra lag: alla möter alla en gång och sista varvet är ett helt varv', () => {
  const s = newSchedule([...'ABCD']);
  assert.equal(show(s), 'AD BC AC DB AB CD');
  assert.deepEqual(new Set(s.slice(-2).flat()), new Set('ABCD'));
});

test('fem och sex lag: inget par möts två gånger', () => {
  for (const n of [5, 6]) {
    const s = newSchedule([...'ABCDEF'.slice(0, n)]);
    const pairs = s.map(([a, b]) => [a, b].sort().join(''));
    assert.equal(new Set(pairs).size, pairs.length, show(s));
  }
});

test('sorterna sprids: fyra lag får en av varje', () => {
  const s = newSchedule([...'ABCD']);
  const kinds = assignKinds(s);
  for (const t of 'ABCD') {
    const mine = s.map((p, i) => (p.includes(t) ? kinds[i] : null)).filter(Boolean);
    assert.equal(new Set(mine).size, 3, `lag ${t}: ${mine}`);
  }
});

test('avhopp bland fyra lag: resten slutar på lika många dueller', () => {
  const s = newSchedule([...'ABCD']);
  const expected = { 1: [5, 3], 2: [5, 3], 3: [5, 3], 4: [7, 4], 5: [7, 4] };
  for (let after = 1; after <= 5; after++) {
    const r = dropout(s, after, 'D');
    assert.deepEqual([r.total, r.target], expected[after], `efter rond ${after}`);
    const per = count([...s.slice(0, after), ...r.rest].map((p) => p.filter((t) => t !== 'D')));
    assert.deepEqual(new Set(Object.values(per)), new Set([r.target]), `efter rond ${after}: ${show(r.rest)}`);
  }
});

test('avhopp som inte går att jämna ut ger target null', () => {
  const s = newSchedule([...'ABC']);
  const r = dropout(s, 2, 'C');
  assert.equal(r.target, null);
  assert.ok(r.rest.every(([a, b]) => a !== 'C' && b !== 'C'));
});
