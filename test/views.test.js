import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { viewFor } from '../server/room.js';
import { beginRound } from '../games/syna/game.js';
import { taskById } from '../games/syna/tasks.js';
import { player, stage, admin } from '../public/syna.js';
import { setup, playRound } from './helpers.js';

// Sidornas HTML som ren text, så att testerna läser det en människa läser.
const strip = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const phoneHtml = (g, who) => player(viewFor(g.room, `tok-${who}`, 'player'), g.clock.now);
const phone = (g, who) => strip(phoneHtml(g, who));
const lag = (g, id) => `Lag ${g.room.teams.find((t) => t.id === id).name}`;
const num = (n) => String(n).replace('.', ',').replace('-', '−');
const points = (n) => (n > 0 ? `+${num(n)}` : num(n));

// En rond där a klarar ett försiktigt bud, b missar ett djärvt bud och första laget som tittar synar b.
function plan(g, r) {
  const s = g.room.syna;
  const task = taskById(s.tasks[r]);
  const [a, b] = s.schedule[r];
  const watchers = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  const low = task.direction === 'low';
  return {
    task, a, b, watchers,
    bids: { [a]: low ? task.bid.max : task.bid.min, [b]: low ? task.bid.min : task.bid.max },
    results: low ? { [a]: task.bid.max - 1, [b]: null } : { [a]: task.bid.min, [b]: task.bid.min },
    calls: watchers.length ? { [watchers[0]]: b } : {},
  };
}

// Ordet tv för sig, inte bokstäverna i "två": \b räknar inte å, ä och ö som bokstäver.
test('mobilen visar allt som behövs i varje steg av en rond', () => {
  const g = setup(4, 7);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const { task, a, b, watchers, bids, results, calls } = plan(g, 0);
  const [w1, w2] = watchers;
  const everyone = [a, b, w1, w2, 'judge', 'aud'];
  const seen = [];

  playRound(g, { bids, results, calls }, (step) => {
    seen.push(step);
    for (const who of everyone) {
      const text = phone(g, who);
      assert.doesNotMatch(text, /(?<!\p{L})tv(?!\p{L})|storbild/iu, `${step}, ${who}`);
      assert.ok(text.includes(`${lag(g, a)} mot ${lag(g, b)}`), `${step}, ${who}: vilka som möts`);
    }
    const others = everyone.filter((who) => who !== 'judge');
    if (step === 'intro') {
      for (const who of everyone) {
        assert.ok(phone(g, who).includes(task.text), `${who} ser uppdraget`);
        assert.ok(phone(g, who).includes(task.role), `${who} ser den yngstas roll`);
      }
      assert.ok(phone(g, a).includes('Ni tävlar i den här ronden'));
      assert.ok(phone(g, w1).includes('Ni tittar och får syna'));
    }
    if (step === 'bid') {
      assert.ok(phone(g, a).includes('Ert bud'));
      assert.ok(phone(g, w1).includes('lägger sina bud'));
      assert.ok(!phone(g, w1).includes('Ert bud'));
    }
    if (step === 'call') {
      assert.ok(phone(g, w1).includes('Vem missar sitt bud?'));
      for (const who of [a, b, 'judge', 'aud']) {
        assert.ok(phone(g, who).includes(`bud ${bids[a]} ${task.unit}`), `${who} ser buden`);
        assert.ok(phone(g, who).includes(`bud ${bids[b]} ${task.unit}`), `${who} ser buden`);
      }
    }
    if (step === 'ready') {
      for (const who of others) {
        assert.ok(phone(g, who).includes(`bud ${bids[b]} ${task.unit} · synad av ${lag(g, w1)}`), `${who} ser synen`);
        assert.ok(phone(g, who).includes('Kontrollanten startar tiden.'));
      }
      assert.ok(phone(g, 'judge').includes('Starta tiden'));
    }
    if (step === 'play') {
      for (const who of others) assert.ok(phoneHtml(g, who).includes('data-ends='), `${who} ser klockan`);
    }
    if (step === 'result') {
      for (const who of others) assert.ok(phone(g, who).includes('Tiden är ute'));
      assert.ok(phone(g, 'judge').includes('Godkänn resultatet'));
    }
    if (step === 'score') {
      for (const who of everyone) {
        const text = phone(g, who);
        assert.ok(text.includes(`${lag(g, a)} bud ${bids[a]} · klarade`), `${who} ser att a klarade budet`);
        assert.ok(text.includes(`${lag(g, b)} bud ${bids[b]} · missade`), `${who} ser att b missade budet`);
        assert.ok(text.includes(`${lag(g, w1)} synade ${lag(g, b)}: rätt ${points(s.points[w1])}`), `${who} ser synen`);
        for (const t of g.room.teams) assert.ok(text.includes(`Lag ${t.name} ${num(s.scores[t.id])}`), `${who} ser ställningen`);
      }
      assert.ok(phone(g, a).includes(`Ni fick ${points(s.points[a])} poäng`));
      assert.ok(phone(g, w2).includes('Ni fick 0 poäng'));
      assert.ok(phone(g, 'aud').includes('Ronden är klar'));
    }
  });
  for (const step of ['intro', 'bid', 'call', 'ready', 'play', 'result', 'score']) assert.ok(seen.includes(step), step);
});

test('mobilen visar ställningen efter varje rond, döljer den i sista varvet och visar slutresultatet', () => {
  const g = setup(4, 7);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  for (let r = 0; r < 6; r++) {
    const { a, bids, results, calls } = plan(g, r);
    playRound(g, { bids, results, calls });
    for (const who of [a, 'judge', 'aud']) {
      const text = phone(g, who);
      assert.ok(text.includes(`${lag(g, a)} bud ${bids[a]} · klarade`), `rond ${r + 1}, ${who}`);
      if (r >= s.hideFrom) {
        assert.ok(text.includes('Ställningen är dold till efter finalen.'), `rond ${r + 1}, ${who}`);
        for (const t of g.room.teams) assert.ok(!text.includes(`Lag ${t.name} ${num(s.scores[t.id])}`), `rond ${r + 1}: ${who} ser inte ställningen`);
      } else {
        for (const t of g.room.teams) assert.ok(text.includes(`Lag ${t.name} ${num(s.scores[t.id])}`), `rond ${r + 1}, ${who}`);
      }
    }
    if (r >= s.hideFrom) assert.ok(phone(g, a).includes('dubbla poäng'));
    g.admin({ t: 'next' });
  }

  assert.equal(s.step, 'final');
  const final = viewFor(g.room, null, 'stage').syna.final;
  for (const who of [g.room.teams[0].id, 'judge', 'aud']) {
    assert.ok(phone(g, who).includes(final.text), `${who} ser finalen`);
    assert.ok(phone(g, who).includes('Ställningen är dold tills ni har klarat det.'));
  }
  g.admin({ t: 'finalResult', success: false });
  assert.ok(phone(g, 'aud').includes('Försök igen. Ni klarar det.'));
  g.admin({ t: 'finalResult', success: true });

  assert.equal(s.step, 'end');
  const rows = viewFor(g.room, null, 'stage').syna.standings;
  const winner = rows.filter((row) => row.place === 1).map((row) => lag(g, row.team)).join(' och ');
  for (const who of [...g.room.teams.map((t) => t.id), 'judge', 'aud']) {
    const text = phone(g, who);
    assert.ok(text.includes(`${winner} vinner`), `${who} ser vinnaren`);
    for (const row of rows) assert.ok(text.includes(`${row.place}. ${lag(g, row.team)} ${num(row.score)}`), `${who} ser hela slutställningen`);
    assert.doesNotMatch(text, /(?<!\p{L})tv(?!\p{L})|storbild/iu);
  }
  const last = rows.at(-1);
  assert.ok(phone(g, last.team).includes(`Ni kom på plats ${last.place} med ${num(last.score)} poäng.`));
});

test('ämnet står på mobilen när uppdraget har ett ämne', () => {
  const g = setup(4, 3);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  s.tasks[0] = 'kedjan';
  beginRound(g.room, g.rng);
  assert.ok(s.topic);
  const [a, b] = s.schedule[0];
  const watcher = g.room.teams.map((t) => t.id).find((id) => id !== a && id !== b);
  for (const who of [a, watcher, 'judge', 'aud']) assert.ok(phone(g, who).includes(`Ämne: ${s.topic}`), `intro, ${who}`);
  assert.doesNotMatch(taskById('kedjan').text + taskById('alfabetet').text, /tv/);
  g.admin({ t: 'next' });
  assert.ok(phone(g, a).includes(`Ämne: ${s.topic}`), 'laget som budar ser ämnet');
  g.as(a, { t: 'lockBid' });
  g.as(b, { t: 'lockBid' });
  assert.ok(phone(g, watcher).includes(`Ämne: ${s.topic}`), 'laget som synar ser ämnet');

  // Ett uppdrag kan ge ämnet en egen rubrik, som säger vad det är.
  s.tasks[1] = 'rimmet';
  s.round = 1;
  beginRound(g.room, g.rng);
  const [c] = s.schedule[1];
  assert.ok(phone(g, c).includes(`Rimord: ${s.topic}`), phone(g, c));
  assert.ok(!phone(g, c).includes('Ämne:'));
});

test('värden kan läsa upp uppdraget och rondens poäng utan storbild', () => {
  const g = setup(4, 7);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  const host = () => strip(admin(viewFor(g.room, null, 'admin'), g.clock.now, false));
  const { task, a, b, watchers, bids, results, calls } = plan(g, 0);
  assert.ok(host().includes(task.text));
  assert.ok(host().includes(task.role));
  assert.ok(!host().includes('Rondens poäng'));
  playRound(g, { bids, results, calls });
  assert.ok(host().includes('Rondens poäng'));
  assert.ok(host().includes(`${lag(g, a)} bud ${bids[a]} · klarade`));
  assert.ok(host().includes(`${lag(g, watchers[0])} synade ${lag(g, b)}: rätt ${points(s.points[watchers[0]])}`));
});

test('storbilden drar ihop raderna när fler än två lag har synat', () => {
  const big = (g) => stage(viewFor(g.room, null, 'stage'), g.clock.now);
  for (const [callers, tight] of [[2, false], [4, true]]) {
    const g = setup(6, 5);
    g.admin({ t: 'start' });
    const { b, watchers, bids, results } = plan(g, 0);
    assert.equal(watchers.length, 4);
    const calls = Object.fromEntries(watchers.slice(0, callers).map((w) => [w, b]));
    playRound(g, { bids, results, calls });
    assert.equal(big(g).includes('class="rrows tight"'), tight, `${callers} lag synar`);
    assert.equal((big(g).match(/class="rrow"/g) ?? []).length, 2 + callers);
  }
});

test('varje element som sidornas skript hämtar finns i sidan', () => {
  const dir = new URL('../public/', import.meta.url);
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.deepEqual(pages.sort(), ['admin.html', 'index.html', 'scen.html', 'start.html']);
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8');
    const ids = [...html.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, page);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${page} saknar elementet ${id}`);
  }
});

test('ingen text på storbilden är mindre än 3,5 % av bildhöjden', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.stage\{--min:3\.5vh;/);
  const small = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const size = /font-size:([\d.]+)vh/.exec(body);
    if (size && Number(size[1]) < 3.5) small.push(selector.trim());
  }
  // Värdens egna knappar syns bara i lobbyn.
  assert.deepEqual(small, ['.ctl']);
});
