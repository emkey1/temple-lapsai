/* THE ROUND, IN INITIATIVE ORDER.
 *
 * "endPlayerTurn" means "this member's action is spent". The round is a walk
 * through every actor — members and monsters interleaved — sorted by
 * initiative, rolled once per encounter and held: a stable order gives every
 * actor exactly one action between two of any member's inputs, where a
 * re-rolled one measurably let monsters land twice in that window. These
 * tests pin the order explicitly, because a d20 is not a test fixture. */

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

/* The rigs inject actors and initiative AFTER the floor's round was built, so
 * the encounter has to be opened again — which is also where a monster that
 * outrolled the party takes its opening action. */
const beginEncounter = (g) => { g._round = null; g.advanceQueue(); };

test('a party of one: one action, one monster action, one turn', () => {
  const { g, p } = rig('r-one');
  p.hp = p.maxhp = 500;
  p.ini = 30;                        /* the member holds the top of the order */
  pest(g, p).ini = 1;
  beginEncounter(g);
  const turn = g.turn;
  g.logs.length = 0;
  g.handleKey(' ', {});
  assert.equal(g.turn, turn + 1);
  assert.equal(blows(g), 1);
});

test('losing initiative means the monster jumps you — once, not forever', () => {
  /* The pest outrolls the member: at each round's turn it acts BEFORE control
   * comes back. Over N keypresses that is still one action per round each —
   * the jump is the encounter's opening, not a standing double-move. */
  const { g, p } = rig('r-jump');
  p.hp = p.maxhp = 500;
  p.ini = 1;
  pest(g, p).ini = 30;
  beginEncounter(g);                 /* the pest's opening action lands here */
  g.logs.length = 0;
  g.handleKey(' ', {});
  const first = blows(g);
  g.logs.length = 0;
  g.handleKey(' ', {});
  assert.equal(blows(g), first, 'the blows per keypress drifted between rounds');
  assert.equal(first, 1, `${first} blows between two inputs — an actor acted twice in the window`);
});

test('a monster that outrolls half the party acts between the members', () => {
  /* THE point of initiative: order interleaves. Member A (30), pest (20),
   * member B (10) — the pest strikes after A's input and before B holds
   * control. */
  const { g, p } = rig('r-two');
  p.hp = p.maxhp = 500;
  p.ini = 30;
  const second = recruit(g);
  second.hp = second.maxhp = 500;
  second.ini = 10;
  pest(g, p).ini = 20;
  beginEncounter(g);
  const turn = g.turn;
  g.logs.length = 0;

  g.handleKey(' ', {});   /* A acts; the pest's slot comes before B's */
  assert.equal(g.turn, turn, 'the round ended after one of two members');
  assert.equal(blows(g), 1, 'the pest did not take its slot between the members');
  assert.equal(g.state.player.name, 'Second', 'control never reached the slower member');

  g.logs.length = 0;
  g.handleKey(' ', {});   /* B acts; the round turns */
  assert.equal(g.turn, turn + 1, 'the round never ended');
  assert.equal(blows(g), 0, 'the pest acted twice in one round');
  assert.equal(g.state.party.active, 0, 'control did not return to the front of the party');
});

test('a monster below the whole party waits for all of it', () => {
  const { g, p } = rig('r-slowpest');
  p.hp = p.maxhp = 500;
  p.ini = 30;
  const second = recruit(g);
  second.hp = second.maxhp = 500;
  second.ini = 25;
  pest(g, p).ini = 1;
  beginEncounter(g);
  g.logs.length = 0;
  g.handleKey(' ', {});
  assert.equal(blows(g), 0, 'the slow pest cut into the middle of the party');
  g.handleKey(' ', {});
  assert.equal(blows(g), 1);
});

test('acted flags do not leak into the next round', () => {
  const { g, p } = rig('r-flags');
  p.hp = p.maxhp = 500;
  p.ini = 30;
  const b = recruit(g);
  b.hp = 500;
  b.ini = 20;
  beginEncounter(g);
  g.handleKey(' ', {});
  g.handleKey(' ', {});
  for (const m of g.state.party.members) {
    assert.ok(!g.actorTurn(m).acted, m.name + ' is still marked as having acted');
  }
});

test('a member on the ground is skipped in the rotation', () => {
  const { g, p } = rig('r-downed');
  p.hp = p.maxhp = 500;
  p.ini = 30;
  const second = recruit(g);
  second.hp = 0;
  pest(g, p).ini = 1;
  beginEncounter(g);
  const turn = g.turn;
  g.handleKey(' ', {});
  assert.equal(g.turn, turn + 1, 'the round waited on a member who cannot act');
  assert.equal(g.state.party.active, 0);
});

test('one member wading still costs the party the double monster phase', () => {
  const { g, p } = rig('r-wade');
  p.hp = p.maxhp = 500;
  p.ini = 30;
  pest(g, p).ini = 1;
  beginEncounter(g);
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
