// Vyerna för Syna under spelet: storbild, mobil, kontrollant och värd.
// Varje funktion tar hela läget och ger tillbaka HTML. Knappar bär sin avsikt i data-do.
// Mobilen visar allt som storbilden visar, så att spelet går att spela utan storbild.

import { esc } from './common.js';

const T = (s, id) => s.teams.find((t) => t.id === id);
const lag = (s, id) => `Lag ${esc(T(s, id)?.name)}`;
const col = (s, id) => esc(T(s, id)?.color ?? '#1B2430');
const fmt = (n) => (n == null ? '–' : String(n).replace('.', ',').replace('-', '−'));
const sign = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const secs = (g, now) => Math.max(0, Math.ceil((g.endsAt - now) / 1000));
const clock = (g, now) => `<div class="clock" data-ends="${g.endsAt}">${secs(g, now)}</div>`;

// Gör om en knapps data-attribut till ett meddelande till servern.
export function action(d) {
  switch (d.do) {
    case 'bid': return { t: 'bid', value: Number(d.v), team: d.team };
    case 'lockBid': return { t: 'lockBid', team: d.team };
    case 'call': return { t: 'call', target: d.target, team: d.team };
    case 'count': return { t: 'count', team: d.team, delta: Number(d.delta) };
    case 'stop': return { t: 'stop', team: d.team };
    case 'setResult': return { t: 'setResult', team: d.team, value: Number(d.v) };
    case 'finalResult': return { t: 'finalResult', success: d.ok === '1' };
    case 'setMaterial': case 'setLong': case 'setPractice': return { t: d.do, on: d.on === '1' };
    case 'next': case 'swapTask': case 'skipPractice': case 'start': case 'endGame': return { t: d.do };
    // Steget följer med, så att servern säger nej om läget har hunnit ändras.
    case 'undo': return { t: 'undo', step: d.step };
    default: return null;
  }
}

function result(g, t) {
  const r = g.results[t];
  if (r == null) return g.task.measure === 'time' ? 'inte i mål' : '0';
  return `${fmt(r)} ${esc(g.task.unit)}`;
}

function live(g, t) {
  const r = g.results[t];
  if (g.task.measure === 'count') return r == null ? '–' : fmt(r);
  if (r != null) return `${fmt(r)} s`;
  return g.performing.includes(t) ? 'tiden går' : '–';
}

function short(g, t) {
  const r = g.results[t];
  if (r == null) return '–';
  return g.task.measure === 'time' ? `${fmt(r)} s` : fmt(r);
}

// Vilken rond det är, som det står överst på alla skärmar.
const roundLabel = (g) => (g.practice ? 'Övningsrond' : `Rond ${g.round + 1} av ${g.rounds}`);
const PRACTICE_NOTE = 'Övningsrond: inga poäng och inga rekord.';

function recordLine(g) {
  if (g.practice) return PRACTICE_NOTE;
  if (!g.record) return 'Inget släktrekord ännu. Det sätts i kväll.';
  return `Släktrekord: ${fmt(g.record.value)} ${esc(g.task.unit)}, Lag ${esc(g.record.team)} ${esc(g.record.date)}`;
}

// Lagen som har synat ett visst lag, som text. Tom sträng om ingen har synat.
// Fler än två räknas i stället för att räknas upp. Vilka det var står i rondens poäng.
function calledBy(s, g, t) {
  const who = g.watchers.filter((w) => g.calls[w] === t);
  return who.length > 2 ? `${who.length} lag` : who.map((w) => lag(s, w)).join(' och ');
}

function callers(s, g, t) {
  const by = calledBy(s, g, t);
  return by ? `<div class="stamp">Synad av ${by}</div>` : '';
}

const deciding = (s, g) => g.watchers.map((w) => `${lag(s, w)} ${g.calls[w] ? 'har bestämt sig' : 'funderar …'}`).join(' · ');
const TURNS = 'Ett lag i taget. Lag två får inte upprepa lag ett.';
const finalNote = (g) => (g.final.tries ? 'Försök igen. Ni klarar det.' : 'Alla tillsammans. Ställningen är dold tills ni har klarat det.');
const winners = (s, g) => `${g.standings.filter((r) => r.place === 1).map((r) => lag(s, r.team)).join(' och ')} vinner`;

function scoreboard(s, g) {
  if (g.practice) return '<p class="hiddenscore">Så hade poängen blivit. Övningen räknas inte: nu börjar spelet.</p>';
  if (!g.scores) return '<p class="hiddenscore">Ställningen är dold till efter finalen.</p>';
  const rows = [...s.teams].sort((x, y) => g.scores[y.id] - g.scores[x.id]);
  return `<div class="board">${rows.map((t) => `<div class="brow" style="--c:${esc(t.color)}"><span>Lag ${esc(t.name)}</span><b>${fmt(g.scores[t.id])}</b></div>`).join('')}</div>`;
}

function roundRows(s, g) {
  const [a, b] = g.duel;
  const duel = [a, b].map((t) => `
    <div class="rrow" style="--c:${col(s, t)}">
      <span class="rn">${lag(s, t)}</span>
      <span class="rd">bud ${fmt(g.bids[t].value)} · ${g.made[t] ? 'klarade' : 'missade'} (${result(g, t)})</span>
      <b class="${g.points[t] > 0 ? 'pos' : ''}">${sign(g.points[t])}</b>
    </div>`).join('');
  const calls = g.watchers.filter((w) => g.calls[w] && g.calls[w] !== 'pass').map((w) => `
    <div class="rrow" style="--c:${col(s, w)}">
      <span class="rn">${lag(s, w)}</span>
      <span class="rd">synade ${lag(s, g.calls[w])}: ${g.made[g.calls[w]] ? 'fel' : 'rätt'}</span>
      <b class="${g.points[w] > 0 ? 'pos' : 'neg'}">${sign(g.points[w])}</b>
    </div>`).join('');
  const rec = g.newRecord ? `<div class="newrec">Nytt släktrekord: ${lag(s, g.newRecord)}, ${result(g, g.newRecord)}</div>` : '';
  const many = g.watchers.filter((w) => g.calls[w] && g.calls[w] !== 'pass').length > 2;
  return `<div class="rrows${many ? ' tight' : ''}">${duel + calls + rec}</div>`;
}

// Duellens två lag med bud, syn och ett valfritt värde till höger. Används på mobilen.
function duelRows(s, g, value) {
  return `<div class="rrows">${g.duel.map((t) => `
    <div class="rrow" style="--c:${col(s, t)}">
      <span class="rn">${lag(s, t)}</span>
      <span class="rd">bud ${fmt(g.bids[t].value)} ${esc(g.task.unit)}${calledBy(s, g, t) ? ` · synad av ${calledBy(s, g, t)}` : ''}</span>
      ${value ? `<b>${value(t)}</b>` : ''}
    </div>`).join('')}</div>`;
}

function standings(s, g) {
  return `<div class="board">${g.standings.map((r) => `<div class="brow" style="--c:${col(s, r.team)}"><span>${r.place}. ${lag(s, r.team)}</span><b>${fmt(r.score)}</b></div>`).join('')}</div>`;
}

/* ---------------- storbild ---------------- */

export function stage(s, now) {
  const g = s.syna;
  const task = g.task;
  const [a, b] = g.duel;
  if (g.step === 'final') {
    return `<div class="ghead"><span>Finalen</span></div>
      <div class="taskbig">${esc(g.final.name)}</div>
      <p class="tasktext">${esc(g.final.text)}</p>
      <p class="vs">${finalNote(g)}</p>`;
  }
  if (g.step === 'end') {
    return `<div class="ghead"><span>Kvällens resultat</span></div>
      <div class="taskbig">${winners(s, g)}</div>
      ${standings(s, g)}`;
  }
  const head = `<div class="ghead"><span>${roundLabel(g)}</span>${g.step === 'intro' ? '' : `<span class="tn">${esc(task.name)}</span>`}${g.practice ? '<span class="pill role">Räknas inte</span>' : ''}${g.double ? '<span class="pill hot">Dubbla poäng</span>' : ''}</div>`;
  const tiles = (inner) => `<div class="duel">${[a, b].map((t) => `<div class="dt${g.step === 'play' && !g.performing.includes(t) ? ' dim' : ''}" style="--c:${col(s, t)}"><div class="dn">${lag(s, t)}</div>${inner(t)}</div>`).join('')}</div>`;
  const bid = (t) => `<div class="dv">${fmt(g.bids[t].value)}</div><div class="ds">${esc(task.unit)}</div>`;
  switch (g.step) {
    case 'intro': return `${head}
      <div class="taskbig">${esc(task.name)}</div>
      <p class="tasktext">${esc(task.text)}</p>
      ${g.topic ? `<p class="topic">${topicText(g)}</p>` : ''}
      <div class="pills"><span class="pill role">${esc(task.role)}</span>${task.needs ? `<span class="pill">Material: ${esc(task.needs)}</span>` : ''}${task.mode === 'turns' ? `<span class="pill">${TURNS}</span>` : ''}</div>
      <p class="vs">${lag(s, a)} mot ${lag(s, b)}</p>
      <p class="rec">${recordLine(g)}</p>`;
    case 'bid': return `${head}${g.topic ? `<p class="topic">${topicText(g)}</p>` : ''}
      ${tiles((t) => `<div class="dv small">${g.bids[t].locked ? 'Låst' : 'Budar …'}</div>`)}
      <p class="foot2">Buden visas när båda lagen har låst.</p>`;
    case 'call': return `${head}${tiles(bid)}
      <p class="foot2">${deciding(s, g)}</p>`;
    case 'ready': return `${head}${g.topic ? `<p class="topic">${topicText(g)}</p>` : ''}
      ${tiles((t) => bid(t) + callers(s, g, t))}
      <p class="foot2">${task.mode === 'turns' ? `${lag(s, g.order[g.turn])} står på tur.` : 'Båda lagen samtidigt.'} Kontrollanten startar tiden.</p>`;
    case 'play': return `${head}${g.topic ? `<p class="topic">${topicText(g)}</p>` : ''}${clock(g, now)}
      ${tiles((t) => `<div class="dv${task.measure === 'time' && g.results[t] == null ? ' small' : ''}">${live(g, t)}</div><div class="ds">bud ${fmt(g.bids[t].value)} ${esc(task.unit)}</div>${callers(s, g, t)}`)}`;
    case 'result': return `${head}<p class="over">Tiden är ute</p>
      ${tiles((t) => `<div class="dv small">${result(g, t)}</div><div class="ds">bud ${fmt(g.bids[t].value)} ${esc(task.unit)}</div>${callers(s, g, t)}`)}
      <p class="foot2">Kontrollanten bekräftar resultatet.</p>`;
    case 'score': return `${head}${roundRows(s, g)}${scoreboard(s, g)}`;
    default: return head;
  }
}

/* ---------------- kontrollant (och värd) ---------------- */

// Vad som händer om värden ångrar, sagt som det står på knappen. null när det inte finns något att ångra.
const STEP_NAMES = { intro: 'uppdraget', bid: 'budgivningen', call: 'synen', ready: 'före försöket', result: 'resultatet', score: 'rondens poäng', final: 'finalen' };
export function undoLabel(g) {
  if (!g.back) return null;
  if (g.step === 'play') return 'Börja om försöket';
  if (g.back.round !== g.round) return `Ångra: tillbaka till rond ${g.back.round + 1}`;
  // Det senaste som hände var ett försök: tiden och räkningen nollställs för laget som just tävlade.
  if (g.back.step === 'ready' && ['ready', 'result'].includes(g.step)) return 'Gör om försöket';
  return `Ångra: tillbaka till ${STEP_NAMES[g.back.step] ?? 'förra steget'}`;
}

// Rondens ämne med uppdragets egen rubrik, till exempel "Rimord: Hatt".
const topicText = (g) => `${esc(g.task.topicLabel ?? 'Ämne')}: ${esc(g.topic)}`;

export function judgePanel(s, now) {
  const g = s.syna;
  const task = g.task;
  const [a, b] = g.duel;
  const note = (t) => (g.notes ? `<p class="note">Viska till den första i ${lag(s, t)}:<br><b>${esc(g.notes[t])}</b></p>` : '');
  if (g.step === 'ready') {
    const next = task.mode === 'turns' ? g.order[g.turn] : null;
    return `<section class="jbox">${next ? `<p class="lbl">${lag(s, next)} står på tur</p>${note(next)}` : '<p class="lbl">Båda lagen samtidigt</p>'}
      <button class="go" data-do="next">Starta tiden</button></section>`;
  }
  if (g.step === 'play') {
    return `<section class="jbox">${clock(g, now)}${g.performing.map((t) => `
      <div class="jteam" style="--c:${col(s, t)}"><div class="jn">${lag(s, t)} · bud ${fmt(g.bids[t].value)}</div>${note(t)}
      ${task.measure === 'count'
        ? `<div class="jcount"><button class="minus" data-do="count" data-team="${t}" data-delta="-1">−1</button><span>${fmt(g.results[t] ?? 0)}</span><button class="plus1" data-do="count" data-team="${t}" data-delta="1">+1</button></div>`
        : (g.results[t] != null ? `<p class="lbl">Stoppad på ${fmt(g.results[t])} s</p>` : `<button class="plus1 wide" data-do="stop" data-team="${t}">${task.direction === 'low' ? 'Klara: stoppa tiden' : 'Stoppa tiden'}</button>`)}
      </div>`).join('')}
      <button class="ghostbtn" data-do="next">Avbryt tiden</button>
      ${g.back ? `<button class="ghostbtn" data-do="undo" data-step="play">Startade tiden av misstag? Börja om försöket</button>` : ''}</section>`;
  }
  if (g.step === 'result') {
    return `<section class="jbox"><p class="lbl">Stämmer resultatet?</p>${[a, b].map((t) => {
      const r = g.results[t];
      const base = r ?? (task.measure === 'time' ? task.seconds : 0);
      const adjust = task.measure === 'count'
        ? `<button class="minus" data-do="count" data-team="${t}" data-delta="-1">−1</button><span>${fmt(r ?? 0)}</span><button class="minus" data-do="count" data-team="${t}" data-delta="1">+1</button>`
        : `<button class="minus" data-do="setResult" data-team="${t}" data-v="${Math.max(0, base - 1)}">−1</button><span>${r == null ? 'inte i mål' : `${fmt(r)} s`}</span><button class="minus" data-do="setResult" data-team="${t}" data-v="${base + 1}">+1</button>`;
      return `<div class="jteam" style="--c:${col(s, t)}"><div class="jn">${lag(s, t)} · bud ${fmt(g.bids[t].value)}</div><div class="jcount">${adjust}</div></div>`;
    }).join('')}
      <button class="go" data-do="next">Godkänn resultatet</button></section>`;
  }
  return '';
}

/* ---------------- mobil ---------------- */

function bidPanel(s, t, forAdmin = false) {
  const g = s.syna;
  const { min, max, step } = g.task.bid;
  const b = g.bids[t];
  const team = forAdmin ? ` data-team="${t}"` : '';
  if (b.locked) return `<section class="card2"><p class="lbl">${forAdmin ? lag(s, t) : 'Ert bud'} är låst</p><div class="num">${fmt(b.value)}</div><p class="unit">${esc(g.task.unit)}</p></section>`;
  return `<section class="card2">
    <p class="lbl">${forAdmin ? lag(s, t) : 'Ert bud'}</p>
    <div class="stepper">
      <button data-do="bid"${team} data-v="${Math.max(min, b.value - step)}">−</button>
      <div class="num">${fmt(b.value)}</div>
      <button data-do="bid"${team} data-v="${Math.min(max, b.value + step)}">+</button>
    </div>
    <p class="unit">${esc(g.task.unit)}${g.task.direction === 'low' ? ' · kortare tid är djärvare' : ''}</p>
    <button class="go" data-do="lockBid"${team}>Lås budet</button>
  </section>`;
}

function callPanel(s, t, forAdmin = false) {
  const g = s.syna;
  const mine = g.calls[t];
  const team = forAdmin ? ` data-team="${t}"` : '';
  const btn = (target, label) => `<button class="opt${mine === target ? ' on' : ''}" data-do="call"${team} data-target="${target}">${label}</button>`;
  return `<section class="card2">
    <p class="lbl">${forAdmin ? `${lag(s, t)}: ` : ''}Vem missar sitt bud?</p>
    ${g.duel.map((d) => btn(d, `${lag(s, d)} missar <small>bud ${fmt(g.bids[d].value)} ${esc(g.task.unit)}</small>`)).join('')}
    ${btn('pass', 'Stå över')}
    <p class="unit">Rätt syn ger er 2 poäng. Fel syn ger dem 1.</p>
  </section>`;
}

const card = (title, ...lines) => `<section class="card2"><p class="lbl">${title}</p>${lines.filter(Boolean).map((l) => `<p class="txt">${l}</p>`).join('')}</section>`;

export function player(s, now) {
  const g = s.syna;
  const me = s.me;
  const task = g.task;
  const mine = me.role === 'team' ? me.team : null;
  const inDuel = g.duel.includes(mine);
  const who = mine ? lag(s, mine) : me.role === 'judge' ? 'Kontrollant' : 'Publik';
  const over = ['final', 'end'].includes(g.step);
  const head = `<div class="phead" style="--c:${mine ? col(s, mine) : '#1B2430'}"><b>${who}</b>
    <span>${over ? 'Finalen' : `${roundLabel(g)} · ${esc(task.name)}`}</span>
    ${over ? '' : `<span>${lag(s, g.duel[0])} mot ${lag(s, g.duel[1])}${g.double ? ' · dubbla poäng' : ''}${g.practice ? ' · räknas inte' : ''}</span>`}</div>`;

  if (g.step === 'final') return head + card(esc(g.final.name), esc(g.final.text), finalNote(g));
  if (g.step === 'end') {
    const row = mine ? g.standings.find((r) => r.team === mine) : null;
    return head + card(winners(s, g), row ? `Ni kom på plats ${row.place} med ${fmt(row.score)} poäng.` : '') + standings(s, g);
  }

  const topic = g.topic && g.step !== 'result' && g.step !== 'score' ? `<p class="ptopic">${topicText(g)}</p>` : '';
  const top = head + topic;
  // Kontrollanten har egna knappar när tiden ska startas, räknas och godkännas. Annars ser den samma som publiken.
  const panel = me.role === 'judge' ? judgePanel(s, now) : '';
  if (panel) return top + panel + (g.step === 'ready' ? duelRows(s, g) : '');

  switch (g.step) {
    case 'intro':
      return top + card(
        inDuel ? 'Ni tävlar i den här ronden' : mine ? 'Ni tittar och får syna' : esc(task.name),
        esc(task.text),
        esc(task.role),
        task.needs ? `Material: ${esc(task.needs)}` : '',
        task.mode === 'turns' ? TURNS : '',
        recordLine(g),
      );
    case 'bid':
      return top + (inDuel ? bidPanel(s, mine) : card(`${lag(s, g.duel[0])} och ${lag(s, g.duel[1])} lägger sina bud`, 'Buden visas när båda lagen har låst.'));
    case 'call':
      if (mine && !inDuel) return top + callPanel(s, mine);
      return top + card('Buden är visade', ...g.watchers.map((w) => `${lag(s, w)} ${g.calls[w] ? 'har bestämt sig' : 'funderar …'}`)) + duelRows(s, g);
    case 'ready':
      return top + card(task.mode === 'turns' ? `${lag(s, g.order[g.turn])} står på tur` : 'Båda lagen samtidigt', 'Kontrollanten startar tiden.') + duelRows(s, g);
    case 'play':
      return top + `<section class="card2">${clock(g, now)}</section>` + duelRows(s, g, (t) => live(g, t));
    case 'result':
      return top + card('Tiden är ute', 'Kontrollanten bekräftar resultatet.') + duelRows(s, g, (t) => short(g, t));
    case 'score': {
      const p = mine ? g.points[mine] : null;
      const title = g.practice ? (p == null ? 'Övningen är klar' : `Det hade gett er ${sign(p)} poäng`) : (p == null ? 'Ronden är klar' : `Ni fick ${sign(p)} poäng`);
      return top + card(title) + roundRows(s, g) + scoreboard(s, g);
    }
    default: return top;
  }
}

/* ---------------- värd ---------------- */

const NEXT = {
  intro: 'Öppna budgivningen', bid: 'Visa buden nu', call: 'Stäng synen',
  ready: 'Starta tiden', play: 'Avbryt tiden', result: 'Godkänn resultatet',
};

export function admin(s, now, armed) {
  const g = s.syna;
  const task = g.task;
  const last = g.round + 1 === g.rounds;
  let main = '';
  if (g.step === 'final') {
    main = `<button class="btn big2" data-do="finalResult" data-ok="1">Finalen lyckades</button>
      <button class="btn ghost" data-do="finalResult" data-ok="0">Misslyckades, försök igen</button>`;
  } else if (g.step === 'score') {
    main = `<button class="btn big2" data-do="next">${g.practice ? 'Börja spelet: rond 1' : last ? 'Till finalen' : 'Nästa rond'}</button>`;
  } else if (g.step !== 'end' && !['ready', 'play', 'result'].includes(g.step)) {
    main = `<button class="btn big2" data-do="next">${NEXT[g.step]}</button>`;
  }
  const fallback = g.step === 'bid'
    ? `<section class="card"><h2>Lägg bud åt ett lag</h2>${g.duel.map((t) => bidPanel(s, t, true)).join('')}</section>`
    : g.step === 'call'
      ? `<section class="card"><h2>Syna åt ett lag</h2>${g.watchers.map((w) => callPanel(s, w, true)).join('')}</section>`
      : '';
  const scores = [...s.teams].sort((x, y) => g.scores[y.id] - g.scores[x.id]);
  const back = undoLabel(g);
  return `
    <section class="card">
      <h2>${['final', 'end'].includes(g.step) ? 'Finalen' : `${roundLabel(g)}: ${esc(task.name)}`}</h2>
      <p class="muted">${g.step === 'final' ? esc(g.final.text) : g.step === 'end' ? 'Spelet är slut.' : `${lag(s, g.duel[0])} mot ${lag(s, g.duel[1])}${g.topic ? ` · ${topicText(g)}` : ''}${task.needs ? ` · material: ${esc(task.needs)}` : ''}`}</p>
      ${g.step === 'intro' ? `<p class="txt">${esc(task.text)}</p><p class="txt">${esc(task.role)}</p>` : ''}
      ${main}
      ${g.step === 'intro' && !g.practice ? '<button class="btn ghost" data-do="swapTask">Byt uppdrag</button>' : ''}
      ${g.practice ? `<button class="btn ghost" data-do="skipPractice">Hoppa över övningen</button><p class="muted">${PRACTICE_NOTE} Den lär ut bud och syn innan det gäller.</p>` : ''}
    </section>
    ${g.step === 'score' ? `<section class="card"><h2>Rondens poäng</h2>${roundRows(s, g)}</section>` : ''}
    ${judgePanel(s, now)}
    ${back && g.step !== 'play' ? `<section class="card"><h2>Blev det fel?</h2>
      <button class="btn ghost" data-do="undo" data-step="${g.step}" data-arm="1">${armed === 'undo' ? 'Säker? Tryck igen' : back}</button>
      <p class="muted">${back === 'Gör om försöket' ? 'Tiden och räkningen nollställs för laget som just tävlade.' : 'Läget före det senaste steget läggs tillbaka: bud, syn, resultat och poäng.'}</p></section>` : ''}
    ${fallback}
    <section class="card">
      <h2>Ställning${g.hidden ? ' (dold för alla andra)' : ''}</h2>
      ${scores.map((t) => `<div class="rowx" style="--c:${esc(t.color)}"><div class="dot"></div><div class="grow">Lag ${esc(t.name)}</div><b>${fmt(g.scores[t.id])}</b></div>`).join('')}
    </section>
    <section class="card">
      <h2>Avsluta</h2>
      <button class="btn warn" data-do="endGame" data-arm="1">${armed === 'endGame' ? 'Säker? Tryck igen' : 'Avsluta spelet'}</button>
      <p class="muted">Tillbaka till lobbyn. Rekorden sparas.</p>
    </section>`;
}
