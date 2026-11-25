// Nödutgången: värden går till finalen i förtid när tiden inte räcker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFor } from '../server/room.js';
import { fairness } from '../games/syna/game.js';
import { taskById } from '../games/syna/tasks.js';
import { admin } from '../public/syna.js';
import { setup, playRound } from './helpers.js';

const host = (g, armed = '') => admin(viewFor(g.room, null, 'admin'), g.clock.now, armed);
// Spelar en rond där båda lagen klarar lägsta budet.
function quickRound(g) {
  const s = g.room.syna;
  const [a, b] = s.schedule[s.round];
  const task = taskById(s.tasks[s.round]);
  const low = task.direction === 'low';
  const bid = low ? task.bid.max : task.bid.min;
  playRound(g, { bids: { [a]: bid, [b]: bid }, results: { [a]: low ? 1 : task.bid.min, [b]: low ? 1 : task.bid.min } });
}

test('värden går till finalen i förtid: spelade ronder räknas, den pågående gör det inte', () => {
  const g = setup(4, 6);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  quickRound(g);
  g.admin({ t: 'next' });
  quickRound(g);
  const after2 = { ...s.scores };
  assert.ok(Object.values(after2).some((p) => p > 0));

  // Rond 3 har börjat: buden är lagda när värden avbryter.
  g.admin({ t: 'next' });
  g.admin({ t: 'next' });
  const [a, b] = s.schedule[2];
  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  for (const who of [a, 'judge', 'aud']) assert.equal(g.as(who, { t: 'toFinal' }), 'bara värden får gå till finalen', who);
  assert.equal(g.admin({ t: 'toFinal' }), null);
  assert.deepEqual([s.step, s.endsAt], ['final', null]);
  assert.deepEqual(s.scores, after2, 'bara de spelade ronderna räknas');
  assert.equal(g.admin({ t: 'toFinal' }), 'finalen har redan börjat');

  // Ställningen är dold under finalen, som vanligt, och visas efteråt.
  assert.equal(viewFor(g.room, `tok-${a}`, 'player').syna.scores, null);
  assert.equal(viewFor(g.room, null, 'stage').syna.hidden, true);
  assert.doesNotMatch(host(g), /data-do="toFinal"/);
  g.admin({ t: 'finalResult', success: true });
  assert.equal(s.step, 'end');
  assert.deepEqual(viewFor(g.room, null, 'stage').syna.scores, after2);
  assert.equal(viewFor(g.room, null, 'stage').syna.standings.length, 4);
});

test('att gå till finalen går att ångra, och fungerar från övningen och mitt i ett försök', () => {
  const g = setup(4, 6);
  g.room.settings.practice = true;
  g.admin({ t: 'start' });
  const s = g.room.syna;
  assert.equal(s.practice.task, 'masken');
  assert.equal(g.admin({ t: 'toFinal' }), null);
  assert.deepEqual([s.step, s.practice], ['final', null]);
  assert.equal(g.admin({ t: 'undo', step: 'final' }), null);
  assert.deepEqual([s.step, s.practice.task], ['intro', 'masken'], 'tillbaka i övningen');

  g.admin({ t: 'skipPractice' });
  g.admin({ t: 'next' });
  const [a, b] = s.schedule[0];
  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  for (const w of g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b)) g.as(w, { t: 'call', target: 'pass' });
  g.as('judge', { t: 'next' });
  assert.equal(s.step, 'play');
  assert.equal(g.admin({ t: 'toFinal' }), null);
  assert.deepEqual([s.step, s.endsAt, s.startedAt], ['final', null, null]);
  assert.ok(Object.values(s.scores).every((p) => p === 0));
});

test('värdsidan säger om lagen har tävlat lika många gånger, och knappen kräver två tryck', () => {
  const g = setup(4, 6);
  g.admin({ t: 'start' });
  assert.match(host(g), /<h2>Ont om tid\?<\/h2>\s*<button class="btn ghost" data-do="toFinal" data-arm="1">Gå till finalen nu</);
  assert.match(host(g, 'toFinal'), /data-do="toFinal" data-arm="1">Säker\? Tryck igen</);
  // Före första ronden är inget räknat.
  assert.match(host(g), /Ronden som pågår räknas inte: gör klart den först om den ska räknas\. Ingen rond är räknad än, så alla lag slutar på noll\./);
  quickRound(g);
  // Efter rond 1 av ett varv på två ronder har två lag tävlat och två inte.
  assert.match(host(g), /Resten av ronderna stryks\. Lagen har inte tävlat lika många gånger än\. Efter rond 2 är det jämnt\./);
  g.admin({ t: 'next' });
  assert.match(host(g), /Ronden som pågår räknas inte: gör klart den först om den ska räknas\. Lagen har inte tävlat lika många gånger än\. Efter rond 2 är det jämnt\./);
  quickRound(g);
  assert.match(host(g), /Resten av ronderna stryks\. Alla lag har tävlat lika många gånger\./);

  // Efter sista ronden finns inget kvar att stryka: då leder den vanliga knappen till finalen.
  for (let r = 2; r < g.room.syna.schedule.length; r++) { g.admin({ t: 'next' }); quickRound(g); }
  assert.equal(g.room.syna.step, 'score');
  assert.doesNotMatch(host(g), /Ont om tid/);
  assert.match(host(g), /data-do="next">Till finalen</);
  // Bara värden får underlaget.
  assert.equal(viewFor(g.room, 'tok-judge', 'player').syna.fair, undefined);
  assert.equal(viewFor(g.room, null, 'stage').syna.fair, undefined);
});

test('jämnt eller inte räknas ur det verkliga schemat, för två till sex lag och efter varje rond', () => {
  const expected = { 2: [1, 2, 3, 4, 5, 6], 3: [3, 6], 4: [2, 4, 6], 5: [5], 6: [3, 6] };
  for (let n = 2; n <= 6; n++) {
    const g = setup(n, 2);
    g.admin({ t: 'start' });
    const s = g.room.syna;
    const count = Object.fromEntries(g.room.teams.map((t) => [t.id, 0]));
    const evenAt = [];
    s.schedule.forEach((pair, i) => {
      for (const t of pair) count[t] += 1;
      if (new Set(Object.values(count)).size === 1) evenAt.push(i + 1);
    });
    assert.deepEqual(evenAt, expected[n], `${n} lag`);
    assert.deepEqual(fairness(s), { played: 0, even: true, next: evenAt[0] }, `${n} lag före första ronden`);
    for (let r = 0; r < s.schedule.length; r++) {
      if (r > 0) g.admin({ t: 'next' });
      // Mitt i en rond räknas bara ronderna före den.
      assert.equal(fairness(s).played, r, `${n} lag, mitt i rond ${r + 1}`);
      quickRound(g);
      const want = { played: r + 1, even: evenAt.includes(r + 1), next: evenAt.find((k) => k > r + 1) ?? null };
      assert.deepEqual(fairness(s), want, `${n} lag efter rond ${r + 1}`);
    }
  }
});

test('med fem lag säger värdsidan att det blir jämnt först efter sista ronden', () => {
  const g = setup(5, 2);
  g.admin({ t: 'start' });
  quickRound(g);
  assert.match(host(g), /Lagen har inte tävlat lika många gånger än\. Efter rond 5 är det jämnt\./);
});
