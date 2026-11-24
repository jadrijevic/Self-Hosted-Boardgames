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
    assert.match(t.role, /^(Bara l|L)agets yngsta /, where);
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
