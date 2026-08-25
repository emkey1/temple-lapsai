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

/* ---- the party moves as one, outside of combat ----
 *
 * First playtest reaction to the tactical party: "all characters should move
 * as one outside of combat." One keypress is one round for everybody while
 * nothing is awake and near; the moment something is, the round breaks into
 * initiative turns.
 */

test('out of combat, one keypress moves the whole company', () => {
  const { g, p } = rig('tk-follow');
  clearing(g);
  const b = recruit(g);
  b.x = p.x - 2; b.y = p.y;              /* trailing behind */
  const turn = g.turn;
  g.handleKey('d', {});                  /* leader steps east */
  assert.equal(g.turn, turn + 1, 'the round did not turn on one keypress');
  assert.equal(g.state.party.active, 0, 'control did not stay with the leader');
  assert.ok(Math.abs(b.x - p.x) + Math.abs(b.y - p.y) <= 3, 'the follower was left behind');
});

test('the column closes up over a walk', () => {
  const { g, p } = rig('tk-column');
  clearing(g);
  const b = recruit(g);
  b.x = p.x - 5; b.y = p.y;
  for (let i = 0; i < 6; i++) g.handleKey('d', {});
  assert.ok(Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)) <= 2,
    `after six steps the follower is still ${Math.abs(b.x - p.x)},${Math.abs(b.y - p.y)} away`);
});

test('combat breaks the column into initiative turns', () => {
  const { g, p } = rig('tk-break');
  clearing(g);
  p.hp = p.maxhp = 500;
  p.ini = 30;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.ini = 20;
  b.x = p.x - 1; b.y = p.y;
  beastAt(g, p.x + 2, p.y).ini = 10;     /* awake, within calm radius */
  g._round = null; g.advanceQueue();
  const turn = g.turn;
  g.handleKey(' ', {});                  /* the leader's action alone */
  assert.equal(g.turn, turn, 'the whole round resolved on one keypress mid-combat');
  assert.equal(g.state.player.name, 'Second', 'control did not pass to the second member');
});

test('time passes for companions too', () => {
  /* tickStatus ran on the active member only — invisible with one member, a
   * real bug with several: a companion never regenerated, never cooled an
   * ability down, and wore a buff for ever. */
  const { g, p } = rig('tk-tick');
  clearing(g);
  const b = recruit(g);
  b.hp = 1;
  b.cooldowns = { backstab: 3 };
  b.buffs = { might: 2 };
  p.hp = p.maxhp;
  for (let i = 0; i < 6; i++) g.handleKey(' ', {});
  assert.ok(b.hp > 1, 'the companion never regenerated a point');
  assert.ok(b.cooldowns.backstab < 3, 'the companion\'s cooldown never counted down');
  assert.ok(!(b.buffs.might > 0), 'the companion wore a buff for ever');
});

test('rest sits the whole company down, and rises when the last is rested', () => {
  const { g, p } = rig('tk-rest');
  clearing(g);
  const b = recruit(g);
  p.hp = p.maxhp;
  b.hp = 1;
  g.rest(400);
  assert.equal(b.hp, g.restedCap(b), 'rest stood up with a companion half-mended');
});

/* ---- handing things over ---- */

test('marching, anything can be handed to anyone living', () => {
  const { g, p } = rig('tk-give');
  clearing(g);
  const b = recruit(g);
  b.x = p.x - 6; b.y = p.y;              /* far, but nothing is awake */
  const potion = { name: 'Potion', kind: 'potion', slot: 'consumable', uid: 'give-1', tier: 1, effects: { heal: '2d4+2' } };
  p.inventory.push(potion);
  g.bindToBelt(potion, p);
  assert.ok(g.giveItem(potion, b, p));
  assert.ok(b.inventory.includes(potion));
  assert.ok(!p.inventory.includes(potion));
  assert.ok(!p.belt.some((e) => g.beltUid(e) === 'give-1'), 'the belt still points at a handed-over item');
});

test('mid-fight it takes a hand in reach', () => {
  const { g, p } = rig('tk-give-fight');
  clearing(g);
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  b.x = p.x - 5; b.y = p.y;
  beastAt(g, p.x + 2, p.y);              /* awake and near: combat */
  const potion = { name: 'Potion', kind: 'potion', slot: 'consumable', uid: 'give-2', effects: { heal: '2d4+2' } };
  p.inventory.push(potion);
  assert.equal(g.giveItem(potion, b, p), false, 'a hand-over crossed the room mid-fight');
  assert.ok(p.inventory.includes(potion));

  b.x = p.x - 1;                          /* step into reach */
  assert.ok(g.giveItem(potion, b, p));
});

test('a full pack and a fallen taker both refuse', () => {
  const { g, p } = rig('tk-give-refuse');
  clearing(g);
  const b = recruit(g);
  const potion = { name: 'Potion', kind: 'potion', slot: 'consumable', uid: 'give-3', effects: {} };
  p.inventory.push(potion);
  while (b.inventory.length < 32) b.inventory.push({ name: 'Rock', kind: 'misc', slot: 'misc', uid: 'r' + b.inventory.length, effects: {} });
  assert.equal(g.giveItem(potion, b, p), false);
  assert.ok(p.inventory.includes(potion), 'the item vanished into a full pack');

  b.inventory.length = 0;
  b.hp = 0;
  assert.equal(g.giveItem(potion, b, p), false, 'a corpse accepted luggage');
});

test('a companion can be dressed from their own pack', () => {
  /* equip/unequip take a member now — arranging a companion's straps is a
   * free action done from their sheet, whoever holds the reins. */
  const { g, p } = rig('tk-dress');
  clearing(g);
  const b = recruit(g);
  const mail = { name: 'Chainmail', kind: 'armor', slot: 'body', uid: 'dress-1', tier: 3, effects: { acBonus: 4 }, identified: true };
  b.inventory.push(mail);
  g.equip(mail, b);
  assert.equal(b.equipment.body, mail);
  assert.ok(!b.inventory.includes(mail));
  /* The leader keeps their own basic loadout; what must NOT happen is the
   * companion's chainmail landing on them. */
  assert.notEqual(p.equipment.body, mail, 'the armour landed on the wrong body');
  g.unequip('body', b);
  assert.equal(b.equipment.body, null);
  assert.ok(b.inventory.includes(mail));
});
