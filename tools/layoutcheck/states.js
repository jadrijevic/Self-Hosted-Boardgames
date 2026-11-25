// Skriver ut spellägen att prova layouten med, som JSON: varje uppdrag i varje steg med fyra lag,
// och de trängsta fallen med sex lag, långa lagnamn och syn från alla lag som tittar.
// Lägena kommer ur den riktiga spellogiken, så sidorna ritar exakt det servern skulle skicka.

import { viewFor } from '../../server/room.js';
import { beginRound } from '../../games/syna/game.js';
import { TASKS, taskById } from '../../games/syna/tasks.js';
import { setup, playRound } from '../../test/helpers.js';

const LONG = ['Mormors gänget', 'Kusinerna Berg', 'Farfars pojkar', 'Tomtenissarna', 'Glöggmästarna', 'Pepparkakorna'];
const cases = [];

function snap(g, name) {
  const { room, clock } = g;
  const s = room.syna;
  const duel = s ? s.practice?.duel ?? s.schedule[s.round] : [];
  const watcher = room.teams.map((t) => t.id).find((id) => !duel.includes(id));
  const phones = { publik: viewFor(room, 'tok-aud', 'player'), kontrollant: viewFor(room, 'tok-judge', 'player') };
  if (duel[0]) phones.tavlar = viewFor(room, `tok-${duel[0]}`, 'player');
  if (watcher) phones.tittar = viewFor(room, `tok-${watcher}`, 'player');
  cases.push({ name, now: clock.now, stage: viewFor(room, null, 'stage'), phones, admin: viewFor(room, null, 'admin') });
}

// Bud och resultat som ger de bredaste siffrorna. Lag a klarar sitt bud, lag b missar.
function wide(g, r) {
  const s = g.room.syna;
  const task = taskById(s.tasks[r]);
  const [a, b] = s.schedule[r];
  const watchers = g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b);
  const low = task.direction === 'low';
  return {
    a, b, watchers,
    bids: { [a]: low ? task.bid.max : task.bid.max - task.bid.step, [b]: low ? task.bid.min : task.bid.max },
    results: low ? { [a]: task.bid.max - 1, [b]: null } : { [a]: task.bid.max - task.bid.step, [b]: task.bid.min },
  };
}

function longNames(g) {
  g.room.teams.forEach((t, i) => g.admin({ t: 'renameTeam', team: t.id, name: LONG[i] }));
}

// 1. Varje uppdrag, fyra lag, båda lagen som tittar synar samma lag.
for (const task of TASKS) {
  const g = setup(4, 11);
  g.room.settings.material = true;
  g.admin({ t: 'start' });
  g.room.syna.tasks[0] = task.id;
  beginRound(g.room, g.rng);
  const { b, watchers, bids, results } = wide(g, 0);
  const seen = new Set();
  playRound(g, { bids, results, calls: Object.fromEntries(watchers.map((w) => [w, b])) }, (step) => {
    if (seen.has(step)) return;
    seen.add(step);
    snap(g, `${task.id}-${step}`);
  });
}

// 2. Sex lag med långa namn. Alla fyra lag som tittar synar samma lag.
for (const id of ['viskningen', 'alfabetet', 'tystnaden']) {
  const g = setup(6, 5);
  longNames(g);
  g.admin({ t: 'start' });
  g.room.syna.tasks[0] = id;
  beginRound(g.room, g.rng);
  const { b, watchers, bids, results } = wide(g, 0);
  const seen = new Set();
  playRound(g, { bids, results, calls: Object.fromEntries(watchers.map((w) => [w, b])) }, (step) => {
    if (seen.has(step)) return;
    seen.add(step);
    snap(g, `sex-lag-${id}-${step}`);
  });
}

// 3. Sex lag: sista varvet med dubbla poäng och dold ställning, finalen och ett slut med delad seger.
{
  const g = setup(6, 5);
  longNames(g);
  g.admin({ t: 'start' });
  const s = g.room.syna;
  for (let r = 0; r < s.schedule.length; r++) {
    const { b, watchers, bids, results } = wide(g, r);
    const seen = new Set();
    const look = r === s.doubleFrom ? (step) => {
      if (seen.has(step) || !['intro', 'ready', 'score'].includes(step)) return;
      seen.add(step);
      snap(g, `sex-lag-dubbelt-${step}`);
    } : undefined;
    playRound(g, { bids, results, calls: Object.fromEntries(watchers.map((w) => [w, b])) }, look);
    g.admin({ t: 'next' });
  }
  snap(g, 'sex-lag-final');
  g.admin({ t: 'finalResult', success: false });
  snap(g, 'sex-lag-final-igen');
  const top = Math.max(...Object.values(s.scores));
  const ids = g.room.teams.map((t) => t.id);
  s.scores[ids[0]] = top;
  s.scores[ids[1]] = top;
  s.recordsSet[ids[0]] = 0;
  s.recordsSet[ids[1]] = 0;
  g.admin({ t: 'finalResult', success: true });
  snap(g, 'sex-lag-slut-delad-seger');
}

// 4. Lobbyn med sex lag och långa namn. Mobilerna finns men är inte anslutna, vilket ger den längsta statustexten.
// Övningsronden med sex lag och långa namn: den har egna rubriker och en egen rad om poängen.
{
  const g = setup(6, 3);
  g.room.settings.practice = true;
  longNames(g);
  g.admin({ t: 'start' });
  const [a, b] = g.room.syna.practice.duel;
  snap(g, 'övning-intro');
  g.admin({ t: 'next' });
  snap(g, 'övning-bid');
  for (const [t, value] of [[a, 55], [b, 60]]) { g.as(t, { t: 'bid', value }); g.as(t, { t: 'lockBid' }); }
  snap(g, 'övning-call');
  for (const w of g.room.teams.map((t) => t.id).filter((id) => id !== a && id !== b)) g.as(w, { t: 'call', target: b });
  snap(g, 'övning-ready');
  g.as('judge', { t: 'next' });
  snap(g, 'övning-play');
  g.clock.add(58_000);
  g.as('judge', { t: 'stop', team: b });
  g.clock.add(1_000);
  g.as('judge', { t: 'stop', team: a });
  snap(g, 'övning-result');
  g.as('judge', { t: 'next' });
  snap(g, 'övning-score');
}

const lobby = setup(6, 5);
longNames(lobby);

process.stdout.write(JSON.stringify({ lobby: lobby.room, cases }));
