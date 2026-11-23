import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, addDevice, apply, viewFor, prune } from '../server/room.js';

function roomWith(...tokens) {
  const room = newRoom();
  tokens.forEach((t, i) => addDevice(room, t, `id${i}`));
  return room;
}

test('en mobil väljer lag och syns i lagets lista', () => {
  const room = roomWith('hemlig-a');
  assert.equal(apply(room, 'hemlig-a', { t: 'choose', role: 'team', team: 'rod' }), null);
  const view = viewFor(room, null, 'stage', new Set(['hemlig-a']));
  assert.deepEqual(view.teams[0].devices, [{ id: 'id0', name: '', online: true }]);
});

test('okänt lag och okänd roll avvisas', () => {
  const room = roomWith('a');
  assert.equal(apply(room, 'a', { t: 'choose', role: 'team', team: 'finns-inte' }), 'okänt lag');
  assert.equal(apply(room, 'a', { t: 'choose', role: 'kung' }), 'okänd roll');
  assert.equal(room.devices.a.role, null);
});

test('bara värden får ändra antal lag, och lag som tas bort tömmer sina mobiler', () => {
  const room = roomWith('a');
  apply(room, 'a', { t: 'choose', role: 'team', team: 'gul' });
  assert.equal(apply(room, 'a', { t: 'setTeamCount', count: 3 }), 'bara värden får göra det');
  assert.equal(apply(room, null, { t: 'setTeamCount', count: 3 }, true), null);
  assert.deepEqual(room.teams.map((t) => t.id), ['rod', 'bla', 'gron']);
  assert.equal(room.devices.a.role, null);
  assert.equal(apply(room, null, { t: 'setTeamCount', count: 7 }, true), 'antal lag måste vara 2–6');
  assert.equal(apply(room, null, { t: 'setTeamCount', count: 6 }, true), null);
  assert.equal(room.teams.length, 6);
});

test('vyn läcker aldrig andras token', () => {
  const room = roomWith('hemlig-a', 'hemlig-b');
  apply(room, 'hemlig-a', { t: 'choose', role: 'team', team: 'rod' });
  apply(room, 'hemlig-b', { t: 'choose', role: 'audience' });
  for (const kind of ['stage', 'player', 'admin']) {
    const text = JSON.stringify(viewFor(room, 'hemlig-a', kind, new Set(['hemlig-a', 'hemlig-b'])));
    assert.ok(!text.includes('hemlig'), kind);
  }
});

test('värden kan byta lagnamn, ta bort en mobil och nollställa', () => {
  const room = roomWith('a', 'b');
  apply(room, 'a', { t: 'choose', role: 'team', team: 'bla' });
  apply(room, 'b', { t: 'choose', role: 'judge' });
  assert.equal(apply(room, null, { t: 'renameTeam', team: 'bla', name: '  Tomtarna  ' }, true), null);
  assert.equal(room.teams[1].name, 'Tomtarna');
  assert.equal(apply(room, null, { t: 'kick', device: 'id0' }, true), null);
  assert.equal(room.devices.a.role, null);
  assert.equal(apply(room, null, { t: 'reset' }, true), null);
  assert.equal(room.devices.b.role, null);
});

test('enheter utan roll som inte är anslutna rensas bort', () => {
  const room = roomWith('a', 'b', 'c');
  apply(room, 'a', { t: 'choose', role: 'audience' });
  prune(room, new Set(['b']));
  assert.deepEqual(Object.keys(room.devices).sort(), ['a', 'b']);
});
