/* MEMBERS AS TOKENS.
 *
 * The tactical party, stage 2: each member is a body on the board. Monsters
 * hunt the nearest one, damage lands on the body that was struck, sight is the
 * union of the party's eyes, and the run ends when the LAST of them falls —
 * not the first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { makePlayer, initialStats } from '../public/js/engine.js';
import { T, W, H } from '../public/js/mapgen.js';

function rig(seed = 'tk') {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

function recruit(g, name = 'Second', cls = 'thief') {
  const a = g.state.party.members[0];
  const b = makePlayer(name, cls, initialStats(cls));
  b.x = a.x; b.y = a.y; b.dungeonId = a.dungeonId; b.floorIdx = a.floorIdx;
  g.state.party.members.push(b);
  return b;
}

function beastAt(g, x, y, over = {}) {
  const m = {
    t: { id: 'tk-beast', name: 'Beast', glyph: 'B', tier: 1, hpMax: 99, ac: 10, toHit: 0,
         damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
         props: [], speed: 1, aggroRange: 40 },
    x, y, hp: 99, maxhp: 99, boss: false, aggro: true,
    toHit: 100, dmg: { dice: 1, sides: 1, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
    revealed: true, lastSeen: 0, ...over,
  };
  g.currentFloor.monsters.push(m);
  return m;
}

/* An open room, so distances mean what they look like. */
function clearing(g, cx = 10, cy = 10, r = 8) {
  const f = g.currentFloor;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) f.tiles[y][x] = T.FLOOR;
  }
  const p = g.state.player;
  p.x = cx; p.y = cy;
  g.computeVisibility();
}

test('a monster hunts the nearest body, not whoever holds the reins', () => {
  const { g, p } = rig('tk-nearest');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.x = p.x + 4; b.y = p.y;            /* the thief stands out front */
  const m = beastAt(g, p.x + 5, p.y);  /* beast beside the thief, far from the fighter */
  g.computeVisibility();
  g.logs.length = 0;
  g.resolveMonsters();
  assert.match(g.logs.join(' '), /hits Second|lashes out/, 'the beast ignored the body beside it');
  assert.equal(p.hp, 500, 'the blow crossed the room to the active member');
  assert.ok(b.hp < 500 || /lashes out/.test(g.logs.join(' ')), 'nobody was struck at all');
});

test('the blow lands on the struck body: their soak, their wounds', () => {
  const { g, p } = rig('tk-body');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.x = p.x + 4; b.y = p.y;
  beastAt(g, p.x + 5, p.y, { dmg: { dice: 1, sides: 1, bonus: 9 } });
  g.resolveMonsters();
  assert.ok(b.hp < 500, 'the thief was never hit');
  assert.ok((b.wounds || 0) > 0 || b.hp === 500, 'the blow left no wound on the body it struck');
  assert.equal(p.wounds || 0, 0, 'the wound landed on the wrong body');
});

test('a fallen member is a wound to the party, not the end of the run', () => {
  const { g, p } = rig('tk-fall');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = 1; b.maxhp = 30;
  b.x = p.x + 4; b.y = p.y;
  beastAt(g, p.x + 5, p.y, { dmg: { dice: 1, sides: 1, bonus: 9 } });
  g.logs.length = 0;
  g.resolveMonsters();
  assert.equal(b.hp, 0);
  assert.match(g.logs.join(' '), /Second falls!/);
  assert.ok(!g.dying, 'one body down ended the whole run');
});

test('the last body down IS the end of the run', () => {
  const { g, p } = rig('tk-last');
  clearing(g);
  p.hp = 1;
  beastAt(g, p.x + 1, p.y, { dmg: { dice: 1, sides: 1, bonus: 9 } });
  g.resolveMonsters();
  assert.ok(g.dying, 'the party is dead and the game did not notice');
});

test('the fallen stop being hunted', () => {
  const { g, p } = rig('tk-corpse');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = 0;                              /* already down */
  b.x = p.x + 1; b.y = p.y;
  const m = beastAt(g, p.x + 6, p.y);
  g.resolveMonsters();
  assert.ok(m.x < p.x + 6, 'the beast stood still beside a corpse instead of hunting the living');
});

test('sight is the union of the party\'s eyes', () => {
  const { g, p } = rig('tk-eyes');
  const f = g.currentFloor;
  /* Two sealed rooms far apart; a wall between; one member in each. */
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.tiles[y][x] = T.WALL;
  for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) f.tiles[y][x] = T.FLOOR;
  for (let y = 4; y <= 8; y++) for (let x = 30; x <= 34; x++) f.tiles[y][x] = T.FLOOR;
  p.x = 6; p.y = 6;
  const b = recruit(g);
  b.x = 32; b.y = 6;
  g.computeVisibility();
  assert.ok(g.vis[6][6], 'the fighter cannot see their own room');
  assert.ok(g.vis[6][32], 'the party is blind to the room the thief is standing in');
});

test('walking into a companion trades places', () => {
  const { g, p } = rig('tk-swap');
  clearing(g);
  const b = recruit(g);
  b.x = p.x + 1; b.y = p.y;
  const was = { px: p.x, py: p.y, bx: b.x, by: b.y };
  assert.ok(g.tryMove(1, 0));
  assert.deepEqual({ x: p.x, y: p.y }, { x: was.bx, y: was.by });
  assert.deepEqual({ x: b.x, y: b.y }, { x: was.px, y: was.py });
});

test('a monster never steps onto a member\'s tile', () => {
  const { g, p } = rig('tk-solid');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.x = p.x + 2; b.y = p.y;
  const m = beastAt(g, p.x + 4, p.y);
  for (let i = 0; i < 6; i++) g.resolveMonsters();
  assert.ok(!(m.x === b.x && m.y === b.y), 'the beast is standing inside the thief');
  assert.ok(!(m.x === p.x && m.y === p.y), 'the beast is standing inside the fighter');
});

test('the whole party takes the stairs together', () => {
  const { g, p } = rig('tk-stairs');
  const b = recruit(g);
  g.loadFloor(1);
  assert.equal(b.floorIdx, p.floorIdx, 'a member was left on the floor above');
  assert.equal(b.dungeonId, p.dungeonId);
  assert.ok(Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)) <= 6, 'a member arrived across the map');
  assert.ok(!(b.x === p.x && b.y === p.y), 'two bodies on one tile');
});

test('one member under Sanctuary does not hide the other', () => {
  const { g, p } = rig('tk-sanct');
  clearing(g);
  p.hp = p.maxhp = 500;
  p.buffs.sanctuary = 10;                /* the fighter is forgotten */
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.x = p.x + 4; b.y = p.y;
  beastAt(g, p.x + 5, p.y);
  g.logs.length = 0;
  g.resolveMonsters();
  assert.match(g.logs.join(' '), /Second|lashes out/, 'one scroll hid the whole party');
  assert.equal(p.hp, 500);
});

test('camp beds the whole party, fallen included', () => {
  const { g, p } = rig('tk-camp');
  const b = recruit(g);
  b.hp = 0; b.maxhp = 30; b.wounds = 9;
  p.hp = 3;
  g.returnToCamp(false);
  assert.equal(b.hp, 30, 'the fallen stayed fallen through a night at camp');
  assert.equal(b.wounds, 0);
  assert.equal(g.state.player.hp, g.state.player.maxhp);
});

test('calm asks after the whole party, not just the front of it', () => {
  const { g, p } = rig('tk-calm');
  clearing(g);
  const b = recruit(g);
  b.x = p.x + 7; b.y = p.y;
  /* Awake beast beside the THIEF, eleven tiles from the fighter. */
  beastAt(g, p.x + 8, p.y);
  assert.equal(g.outOfCombat(), false, 'the fighter rested while the thief was being eaten');
});
