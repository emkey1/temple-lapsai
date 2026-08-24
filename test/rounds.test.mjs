/* THE ROUND SCHEDULER.
 *
 * First structural piece of the tactical party. "endPlayerTurn" now means
 * "this member's action is spent": in a party of one it is the whole round,
 * byte-identical to what it replaced; with several, control passes member to
 * member and the monsters wait for the last of them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { makePlayer, initialStats } from '../public/js/engine.js';

function rig(seed = 'r') {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

/* A beast that always swings and never kills, so blows are countable. */
function pest(g, p) {
  const m = {
    t: { id: 'pest', name: 'Pest', glyph: 'p', tier: 0, hpMax: 99, ac: 10, toHit: 0,
         damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
         props: [], speed: 1, aggroRange: 40 },
    x: p.x + 1, y: p.y, hp: 99, maxhp: 99, boss: false, aggro: true,
    toHit: 100, dmg: { dice: 1, sides: 1, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
    revealed: true, lastSeen: 0,
  };
  g.currentFloor.monsters.push(m);
  return m;
}

function recruit(g, name = 'Second') {
  const b = makePlayer(name, 'thief', initialStats('thief'));
  const a = g.state.party.members[0];
  b.x = a.x; b.y = a.y;
  b.dungeonId = a.dungeonId;
  b.floorIdx = a.floorIdx;
  g.state.party.members.push(b);
  return b;
}

/* A blow on ANY member counts: the pest names its mark now, and "hits you"
 * only covers whoever holds the reins at that instant. */
const blows = (g) => g.logs.filter((l) => /Pest hits |Pest lashes out/.test(l)).length;

test('a party of one plays exactly as before: one action, one monster phase, one turn', () => {
  const { g, p } = rig('r-one');
  p.hp = p.maxhp = 500;
  pest(g, p);
  const turn = g.turn;
  g.logs.length = 0;
  g.handleKey(' ', {});
  assert.equal(g.turn, turn + 1);
  assert.equal(blows(g), 1);
});

test('with two members, the monsters wait for the second', () => {
  const { g, p } = rig('r-two');
  p.hp = p.maxhp = 500;
  const second = recruit(g);
  second.hp = second.maxhp = 500;
  pest(g, p);
  const turn = g.turn;
  g.logs.length = 0;

  g.handleKey(' ', {});   /* the first member spends their action */
  assert.equal(g.turn, turn, 'the round ended after one of two members');
  assert.equal(blows(g), 0, 'the monsters moved before the whole party had');
  assert.equal(g.state.player.name, 'Second', 'control never passed');

  g.handleKey(' ', {});   /* the second spends theirs */
  assert.equal(g.turn, turn + 1, 'the round never ended');
  assert.equal(blows(g), 1, 'the monster phase ran a different number of times than once');
  assert.equal(g.state.party.active, 0, 'control did not return to the front of the party');
});

test('acted flags do not leak into the next round', () => {
  const { g, p } = rig('r-flags');
  p.hp = p.maxhp = 500;
  recruit(g).hp = 500;
  g.handleKey(' ', {});
  g.handleKey(' ', {});
  for (const m of g.state.party.members) {
    assert.ok(!g.actorTurn(m).acted, m.name + ' is still marked as having acted');
  }
});

test('a member on the ground is skipped in the rotation', () => {
  const { g, p } = rig('r-downed');
  p.hp = p.maxhp = 500;
  const second = recruit(g);
  second.hp = 0;
  pest(g, p);
  const turn = g.turn;
  g.handleKey(' ', {});
  assert.equal(g.turn, turn + 1, 'the round waited on a member who cannot act');
  assert.equal(g.state.party.active, 0);
});

test('one member wading still costs the party the double monster phase', () => {
  const { g, p } = rig('r-wade');
  p.hp = p.maxhp = 500;
  pest(g, p);
  g.logs.length = 0;
  g.actorTurn(p).wading = true;
  g.handleKey(' ', {});
  assert.equal(blows(g), 2, 'the wading surcharge was lost in the scheduler');
  assert.ok(!g.actorTurn(p).wading, 'the wading flag survived the round');
});

test('rest still reaches the line through the scheduler', () => {
  const { g, p } = rig('r-rest');
  p.hp = 1;
  g.rest(400);
  assert.equal(p.hp, g.restedCap(p));
});
