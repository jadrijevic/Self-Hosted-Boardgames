// Uppdragen ska gå att spela utan material i alla sorter, och varje uppdrag ska hänga ihop:
// budets gränser, tiden i texten och det som lottas per rond.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../games/syna/tasks.js';
import { viewFor } from '../server/room.js';
import { beginRound } from '../games/syna/game.js';
import { player, stage, judgePanel } from '../public/syna.js';
import { setup } from './helpers.js';

const KINDS = ['kropp', 'röst', 'huvud'];
const strip = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('varje sort har minst fem uppdrag utan material', () => {
  for (const kind of KINDS) {
    const free = TASKS.filter((t) => t.kind === kind && !t.material).map((t) => t.name);
    assert.ok(free.length >= 5, `${kind}: ${free.join(', ')}`);
  }
  assert.equal(new Set(TASKS.map((t) => t.id)).size, TASKS.length, 'varje uppdrag har ett eget id');
  assert.equal(new Set(TASKS.map((t) => t.name)).size, TASKS.length, 'varje uppdrag har ett eget namn');
});

test('långa uppdrag och uppdrag med material är avslagna tills värden slår på dem', () => {
  const long = TASKS.filter((t) => t.long).map((t) => t.id);
  assert.deepEqual(long.sort(), ['ryggen', 'vaskan']);
  const pool = (settings) => {
    const seen = new Set();
    for (let seed = 1; seed <= 150; seed++) {
      const g = setup(4, seed);
      Object.assign(g.room.settings, settings);
      g.admin({ t: 'start' });
      for (const id of g.room.syna.tasks) seen.add(id);
      // Byt uppdrag håller sig också till urvalet.
      g.admin({ t: 'swapTask' });
      seen.add(g.room.syna.tasks[0]);
    }
    return TASKS.filter((t) => seen.has(t.id));
  };
  const base = pool({});
  assert.equal(base.length, 13, base.map((t) => t.name).join(', '));
  assert.ok(base.every((t) => !t.long && !t.material));
  assert.equal(pool({ long: true }).length, 15);
  assert.equal(pool({ long: true, material: true }).length, 18);
  // Också utan de långa finns minst fyra av varje sort, så att två går att spela och två att byta till.
  for (const kind of KINDS) assert.ok(base.filter((t) => t.kind === kind).length >= 4, kind);

  const g = setup(4, 1);
  assert.equal(g.room.settings.long, false);
  assert.equal(g.as('rod', { t: 'setLong', on: true }), 'bara värden får göra det');
  assert.equal(g.admin({ t: 'setLong', on: true }), null);
  assert.equal(g.room.settings.long, true);
  g.admin({ t: 'start' });
  assert.equal(g.admin({ t: 'setLong', on: false }), 'inställningen kan bara ändras i lobbyn');
});

test('varje uppdrag hänger ihop: sort, bud, tid, text och det som lottas', () => {
  for (const t of TASKS) {
    const where = t.name;
    assert.match(t.id, /^[a-z]+$/, where);
    assert.ok(KINDS.includes(t.kind), where);
    assert.ok(['together', 'turns'].includes(t.mode), where);
    assert.ok(['count', 'time'].includes(t.measure), where);
    assert.ok(['high', 'low'].includes(t.direction), where);
    assert.equal(Boolean(t.needs), t.material, `${where}: material och needs följs åt`);
    // Reglerna: ett uppdrag tar 45–90 sekunder.
    assert.ok(t.seconds >= 45 && t.seconds <= 90, `${where}: ${t.seconds} sekunder`);

    const { min, max, step, start } = t.bid;
    assert.ok(min < max && step > 0, `${where}: budets gränser`);
    assert.equal((max - min) % step, 0, `${where}: högsta budet nås med hela steg`);
    assert.ok(start >= min && start <= max && (start - min) % step === 0, `${where}: budet börjar på ett giltigt värde`);
    if (t.measure === 'time') assert.ok(max <= t.seconds, `${where}: budet ryms i tiden`);

    assert.ok(t.text.endsWith('?'), `${where}: texten slutar med frågan som budet svarar på`);
    assert.ok(t.text.length <= 200, `${where}: texten är ${t.text.length} tecken`);
    assert.match(t.role, /^Lagets yngsta /, where);
    // Den yngsta ser, väljer eller bestämmer, men står aldrig ensam under tidspress: inte först i ett led,
    // inte den som ska säga det första svaret och inte den enda som får göra något.
    assert.doesNotMatch(t.role, /säger första|får \S+ först|enda som|Bara lagets yngsta/, `${where}: ${t.role}`);
    assert.doesNotMatch(t.text, /lagets yngsta/, `${where}: uppdraget ska inte hänga på den yngsta`);
    // Nämner texten en tid ska det vara uppdragets tid.
    const said = /(\d+) sekunder/.exec(t.text)?.[1] ?? (/en minut/.test(t.text) ? '60' : null);
    if (said) assert.equal(Number(said), t.seconds, `${where}: tiden i texten`);

    if (t.topics) assert.ok(new Set(t.topics).size === t.topics.length && t.topics.length >= 4, `${where}: minst fyra olika ämnen`);
    if (t.prompts) assert.ok(new Set(t.prompts).size === t.prompts.length && t.prompts.length >= 2, `${where}: lagen ska kunna få var sitt`);
    assert.equal(Boolean(t.topicLabel) && !t.topics, false, `${where}: en rubrik utan ämnen`);
  }
});

test('det som lottas per rond når rätt skärmar: ämnet alla, kontrollantens lapp bara kontrollanten', () => {
  for (const task of TASKS) {
    const g = setup(4, 7);
    g.admin({ t: 'start' });
    const s = g.room.syna;
    s.tasks[0] = task.id;
    beginRound(g.room, g.rng);
    const [a, b] = s.schedule[0];
    const view = (who) => viewFor(g.room, `tok-${who}`, 'player');
    const big = strip(stage(viewFor(g.room, null, 'stage'), g.clock.now));
    const phone = strip(player(view(a), g.clock.now));
    assert.ok(big.includes(task.name) && big.includes(task.text) && big.includes(task.role), `${task.name}: storbilden`);
    assert.ok(phone.includes(task.text) && phone.includes(task.role), `${task.name}: mobilen`);

    if (task.topics) {
      assert.ok(task.topics.includes(s.topic), task.name);
      const line = `${task.topicLabel ?? 'Ämne'}: ${s.topic}`;
      assert.ok(big.includes(line), `${task.name}: storbilden visar "${line}"`);
      assert.ok(phone.includes(line), `${task.name}: mobilen visar "${line}"`);
    } else {
      assert.equal(s.topic, null, task.name);
    }

    if (task.prompts) {
      assert.ok(task.prompts.includes(s.notes[a]) && task.prompts.includes(s.notes[b]), task.name);
      assert.notEqual(s.notes[a], s.notes[b], `${task.name}: lagen får olika`);
      g.admin({ t: 'next' });
      g.as(a, { t: 'lockBid' });
      g.as(b, { t: 'lockBid' });
      for (const w of g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b)) g.as(w, { t: 'call', target: 'pass' });
      assert.equal(s.step, 'ready', task.name);
      const judge = strip(judgePanel(view('judge'), g.clock.now));
      assert.ok(judge.includes(s.notes[s.order[0]]), `${task.name}: kontrollanten ser lappen till laget som står på tur`);
      for (const who of [a, b, 'aud']) {
        const seen = JSON.stringify(view(who));
        assert.ok(!seen.includes(s.notes[a]) && !seen.includes(s.notes[b]), `${task.name}: ${who} ser inte lapparna`);
      }
      assert.ok(!JSON.stringify(viewFor(g.room, null, 'stage')).includes(s.notes[a]), `${task.name}: storbilden visar inte lapparna`);
    }
    // Listorna med ämnen och lappar lämnar aldrig servern.
    const sent = view(a).syna.task;
    assert.equal(sent.topics, undefined, task.name);
    assert.equal(sent.prompts, undefined, task.name);
  }
});
