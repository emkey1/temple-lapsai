/* Effects that were stored and never read. Every one of these was a number the
 * game wrote into player or monster state and then never consulted again — a
 * potion that did nothing, an amulet that did nothing, a wand that froze
 * nothing, a passive the class description promised and the engine ignored. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { dist1 } from '../public/js/dice.js';
import { newGame } from './helpers.mjs';

function arena(g, tiles = {}) {
  const grid = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 18; y++) for (let x = 5; x < 30; x++) grid[y][x] = T.FLOOR;
  for (const [k, v] of Object.entries(tiles)) {
    const [x, y] = k.split(',').map(Number);
    grid[y][x] = v;
  }
  g.currentFloor = {
    w: W, h: H, tiles: grid, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 10 }, down: null, altar: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  g.state.player.x = 10;
  g.state.player.y = 10;
  return g.currentFloor;
}

function beast(x, y, over = {}) {
  const t = {
    id: 't', name: 'Test Beast', glyph: 'B', color: 'red', tier: 1, hpMax: 40,
    ac: 10, toHit: 40, damage: { dice: 1, sides: 4, bonus: 0 }, xp: 5,
    goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 20, ...(over.t || {}),
  };
  return {
    t, x, y, hp: over.hp ?? 40, maxhp: 40, boss: false, aggro: true, acted: false,
    toHit: 40, dmg: { dice: 1, sides: 4, bonus: 0 }, xp: 5, goldMin: 0, goldMax: 0,
    idx: x * 100 + y, ...over,
  };
}

/* ---- Potion of Titan's Grip ---- */

test('borrowed strength reaches the arm it was promised to', () => {
  const g = newGame('str');
  arena(g);
  const p = g.state.player;
  const before = g.derived();
  p.buffs.str = 10;
  const during = g.derived();
  assert.ok(during.effValues.str > before.effValues.str, 'the potion moved no numbers at all');
  assert.ok(during.dmg.bonus >= before.dmg.bonus, 'strength did not reach the damage roll');
});

test('borrowed strength runs out, and says so', () => {
  const g = newGame('str-lapse');
  arena(g);
  const p = g.state.player;
  p.buffs.str = 1;
  g.logs.length = 0;
  g.tickStatus();
  g.tickStatus();
  assert.equal(p.buffs.str, undefined, 'the buff never expired');
  assert.match(g.logs.join(' '), /strength drains/i);
});

/* ---- Amulet of the Deep Ward ---- */

test('a ward soaks damage', () => {
  const g = newGame('ward');
  arena(g);
  const p = g.state.player;
  p.hp = 100; p.maxhp = 100;
  p.equipment.amulet = { name: 'Ward', kind: 'amulet', slot: 'amulet', effects: { resist: 2 } };
  g.damagePlayer(10, beast(11, 10));
  assert.equal(p.hp, 92, `expected 2 soaked, took ${100 - p.hp}`);
});

test('a ward soaks more from the unhallowed', () => {
  const g = newGame('ward-undead');
  arena(g);
  const p = g.state.player;
  p.hp = 100; p.maxhp = 100;
  p.equipment.amulet = { name: 'Deep Ward', kind: 'amulet', slot: 'amulet', effects: { resist: 1, undeadResist: 3 } };
  g.damagePlayer(10, beast(11, 10, { t: { props: ['undead'] } }));
  assert.equal(p.hp, 94, `expected 4 soaked from undead, took ${100 - p.hp}`);
});

test('a ward never reduces a blow to nothing', () => {
  const g = newGame('ward-floor');
  arena(g);
  const p = g.state.player;
  p.hp = 100; p.maxhp = 100;
  p.equipment.amulet = { name: 'Ward', kind: 'amulet', slot: 'amulet', effects: { resist: 99 } };
  g.damagePlayer(5, beast(11, 10));
  assert.ok(p.hp < 100, 'a ward made the player immune');
});

/* ---- Lucky Coin of Lapsai ---- */

test('luck buys a second look at a blow that missed', () => {
  const hits = (luck) => {
    let landed = 0;
    for (let s = 0; s < 120; s++) {
      const g = newGame('luck-' + s);
      arena(g);
      const p = g.state.player;
      if (luck) p.equipment.amulet = { name: 'Coin', kind: 'amulet', slot: 'amulet', effects: { luck: 4 } };
      const m = beast(11, 10, { t: { ac: -6 } });   /* hard to hit */
      g.currentFloor.monsters.push(m);
      g.turn = s;
      g.logs.length = 0;
      g.attackMonster(m);
      if (!/misses/.test(g.logs.join(' '))) landed++;
    }
    return landed;
  };
  const without = hits(false);
  const with_ = hits(true);
  assert.ok(with_ > without, `luck changed nothing: ${with_} hits vs ${without}`);
});

/* ---- Sharp & Keen, and natural twenties ---- */

test('a critical hits harder than an ordinary blow', () => {
  /* A thief's Sharp & Keen is a standing 15% on top of the natural 20, and a
   * crit rolls the damage dice twice. Both halves are checked here: that the
   * chance is consulted at all, and that it reaches the damage. */
  const g = newGame('crit-thief', 'thief');
  arena(g);
  assert.ok(g.derived().crit >= 0.15, 'Sharp & Keen is not in the numbers');
  const der = g.derived();
  const maxSingleRoll = der.dmg.dice * der.dmg.sides + der.dmg.bonus;

  let crits = 0, swings = 0, overMax = 0;
  for (let t = 0; t < 400; t++) {
    const m = beast(11, 10, { hp: 999999, t: { ac: 30 } });   /* always hit, never dies */
    g.currentFloor.monsters = [m];
    g.turn = t;
    g.logs.length = 0;
    g.attackMonster(m);
    const said = g.logs.join(' ');
    const hit = /for (\d+) hit points/.exec(said);
    if (!hit) continue;
    swings++;
    if (/grievous/i.test(said)) crits++;
    if (Number(hit[1]) > maxSingleRoll) overMax++;
  }
  assert.ok(swings > 300, `only ${swings} swings landed against an unmissable target`);
  const rate = crits / swings;
  assert.ok(rate > 0.10, `crit rate ${(rate * 100).toFixed(1)}% — der.crit is still not consulted`);
  assert.ok(overMax > 0, `no blow ever exceeded a single roll's maximum (${maxSingleRoll}) — crits deal no extra damage`);
});

/* ---- Cleave ---- */

test('a fighter who kills carries the blade into the next foe', () => {
  const g = newGame('cleave');
  arena(g);
  assert.ok(g.hasPassive('cleave'), 'the fighter does not have Cleave at level 1');
  const doomed = beast(11, 10, { hp: 1, t: { ac: 30 } });     /* unmissable */
  const neighbour = beast(10, 11, { hp: 999, t: { ac: 30 } }); /* also adjacent */
  g.currentFloor.monsters.push(doomed, neighbour);
  g.logs.length = 0;
  g.handleKey('d');           /* walk east into the first: a killing blow */
  const said = g.logs.join(' ');
  assert.match(said, /blade carries/i, 'Cleave never fired');
  assert.ok(neighbour.hp < 999, 'the bonus attack hit nothing');
});

test('Cleave carries once, not down a whole rank', () => {
  const g = newGame('cleave-once');
  arena(g);
  const doomed = beast(11, 10, { hp: 1, t: { ac: 30 } });
  const second = beast(10, 11, { hp: 1, t: { ac: 30 } });
  const third = beast(10, 9, { hp: 999, t: { ac: 30 } });
  g.currentFloor.monsters.push(doomed, second, third);
  g.handleKey('d');
  assert.equal(third.hp, 999, 'Cleave chained from kill to kill down the rank');
});

test('Cleave with nothing else in reach simply does not fire', () => {
  const g = newGame('cleave-alone');
  arena(g);
  g.currentFloor.monsters.push(beast(11, 10, { hp: 1, t: { ac: 30 } }));
  let ended = 0;
  const realEnd = g.endPlayerTurn.bind(g);
  g.endPlayerTurn = () => { ended++; realEnd(); };
  g.logs.length = 0;
  g.handleKey('d');
  assert.equal(ended, 1, 'the turn did not end after a kill with nothing to carry into');
  assert.doesNotMatch(g.logs.join(' '), /blade carries/i);
});

test('a mage does not cleave', () => {
  const g = newGame('cleave-mage', 'mage');
  arena(g);
  assert.equal(g.hasPassive('cleave'), false);
});

/* ---- Wand of Frost ---- */

test('a frozen monster loses its turn', () => {
  const g = newGame('stun');
  arena(g);
  const m = beast(12, 10);
  m.stunned = 1;
  g.currentFloor.monsters.push(m);
  const at = { x: m.x, y: m.y };
  g.turn = 1;
  g.resolveMonsters();
  assert.deepEqual({ x: m.x, y: m.y }, at, 'a frozen monster moved anyway');
  assert.equal(m.stunned, 0, 'the freeze never wears off');
});

/* ---- Scroll of Sanctuary ---- */

test('sanctuary keeps the dark off you', () => {
  const g = newGame('sanctuary');
  arena(g);
  const p = g.state.player;
  p.hp = 100; p.maxhp = 100;
  p.buffs.sanctuary = 12;
  g.currentFloor.monsters.push(beast(11, 10));   /* adjacent, awake, hostile */
  for (let t = 0; t < 6; t++) { g.turn = t; g.resolveMonsters(); }
  assert.equal(p.hp, 100, 'something hit you while the dark had forgotten your name');
});

test('sanctuary lapses, and says so', () => {
  const g = newGame('sanctuary-lapse');
  arena(g);
  const p = g.state.player;
  p.buffs.sanctuary = 1;
  g.logs.length = 0;
  g.tickStatus();
  g.tickStatus();
  assert.equal(p.buffs.sanctuary, undefined);
  assert.match(g.logs.join(' '), /remembers your name/i);
});

/* ---- monster speed ---- */

test('a fast monster closes faster than a slow one', () => {
  const run = (speed) => {
    const g = newGame('speed-' + speed);
    arena(g);
    const m = beast(25, 10, { t: { speed, aggroRange: 40 } });
    g.currentFloor.monsters.push(m);
    for (let t = 0; t < 4; t++) { g.turn = t; g.resolveMonsters(); }
    return dist1(m, g.state.player);
  };
  assert.ok(run(3) < run(1), 'speed on the template still does nothing');
});

test('however fast it is, it lands one blow a turn', () => {
  const g = newGame('speed-melee');
  arena(g);
  const p = g.state.player;
  p.hp = 500; p.maxhp = 500;
  g.currentFloor.monsters.push(beast(11, 10, { t: { speed: 3 } }));
  g.turn = 1;
  g.logs.length = 0;
  g.resolveMonsters();
  const blows = g.logs.filter((l) => /hits you for/.test(l)).length;
  assert.equal(blows, 1, `a speed-3 monster struck ${blows} times in one turn`);
});

/* ---- altars ---- */

test('altars are placed, and they answer', () => {
  const g = newGame('altar');
  g.loadFloor(0);
  assert.ok(g.currentFloor.altar, 'no altar was placed on the floor');
  const { x, y } = g.currentFloor.altar;
  assert.equal(g.currentFloor.tiles[y][x], T.ALTAR);

  const p = g.state.player;
  p.hp = 1;
  p.power = 0;
  g.logs.length = 0;
  g.useAltar(x, y);
  assert.ok(p.hp > 1, 'the altar healed nothing');
  assert.ok(p.power > 0, 'the altar restored no power');
});

test('an altar gives once', () => {
  const g = newGame('altar-once');
  g.loadFloor(0);
  const { x, y } = g.currentFloor.altar;
  const p = g.state.player;
  p.hp = 1;
  g.useAltar(x, y);
  const after = p.hp;
  p.hp = 1;
  g.logs.length = 0;
  g.useAltar(x, y);
  assert.equal(p.hp, 1, 'the altar gave twice');
  assert.match(g.logs.join(' '), /cold/i);
  assert.ok(after > 1);
});

test('an altar unbinds what is cursed', () => {
  const g = newGame('altar-curse');
  g.loadFloor(0);
  const { x, y } = g.currentFloor.altar;
  const p = g.state.player;
  const cursed = { name: 'Hateful Ring', kind: 'ring', slot: 'ring', cursed: true, effects: {} };
  p.equipment.ring = cursed;
  g.useAltar(x, y);
  assert.equal(cursed.cursed, false, 'the curse survived the altar');
});

/* ---- the belt ---- */

function potion(name = 'Potion of Healing') {
  return { name, kind: 'potion', slot: 'consumable', uid: name, effects: { heal: '2d4+2' } };
}

test('an item can be bound to the belt', () => {
  const g = newGame('belt-bind');
  arena(g);
  const p = g.state.player;
  const it = potion();
  p.inventory.push(it);
  assert.equal(g.bindToBelt(it), true);
  assert.equal(g.beltItem(0), it);
});

test('binding twice does not fill two loops', () => {
  const g = newGame('belt-dup');
  arena(g);
  const p = g.state.player;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  g.bindToBelt(it);
  assert.equal(p.belt.filter(Boolean).length, 1);
});

test('a belt binding survives a save and reload', () => {
  /* save() is a deep JSON copy. A belt holding object references comes back
   * holding copies, and every identity test against the pack then fails. */
  const g = newGame('belt-save');
  arena(g);
  const p = g.state.player;
  p.hp = 1; p.maxhp = 50;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  const saved = JSON.parse(JSON.stringify(g.save()));

  const g2 = newGame('belt-save');
  g2.restore(saved);
  g2.loadFloor(0);
  const p2 = g2.state.player;
  assert.ok(g2.beltItem(0), 'the belt lost its item across the save');
  assert.equal(g2.beltItem(0).name, 'Potion of Healing');
  p2.hp = 1;
  g2.useBeltItem(0);
  assert.ok(p2.hp > 1, 'the reloaded belt item could not be used');
});

test('an old save whose belt held objects still works', () => {
  const g = newGame('belt-legacy');
  arena(g);
  const p = g.state.player;
  const it = potion();
  p.inventory.push(it);
  const saved = JSON.parse(JSON.stringify(g.save()));
  saved.player.belt = [JSON.parse(JSON.stringify(it)), null, null, null];   /* the old shape */

  const g2 = newGame('belt-legacy');
  g2.restore(saved);
  g2.loadFloor(0);
  assert.ok(g2.beltItem(0), 'a legacy belt binding was lost rather than migrated');
});

test('wearing a bound item takes it off the belt', () => {
  const g = newGame('belt-wear');
  arena(g);
  const p = g.state.player;
  const blade = { name: 'Short Sword', kind: 'weapon', slot: 'weapon', uid: 'sw1', effects: { damage: { dice: 1, sides: 6, bonus: 0 } } };
  p.inventory.push(blade);
  g.bindToBelt(blade);
  g.equip(blade);
  assert.equal(p.belt.filter(Boolean).length, 0, 'the loop still points at something you are wearing');
});

test('dropping a bound item takes it off the belt', () => {
  const g = newGame('belt-drop');
  arena(g);
  const p = g.state.player;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  g.drop(it);
  assert.equal(p.belt.filter(Boolean).length, 0, 'the loop still points at something on the floor');
});

test('a full belt says so rather than silently dropping the bind', () => {
  const g = newGame('belt-full');
  arena(g);
  const p = g.state.player;
  for (let i = 0; i < 5; i++) {
    const it = potion('Potion ' + i);
    p.inventory.push(it);
    g.bindToBelt(it);
  }
  assert.equal(p.belt.filter(Boolean).length, 4);
  assert.match(g.logs.join(' '), /belt is full/i);
});

test('a belt item can be used from its loop', () => {
  const g = newGame('belt-use');
  arena(g);
  const p = g.state.player;
  p.hp = 1; p.maxhp = 50;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  g.useBeltItem(0);
  assert.ok(p.hp > 1, 'using the belt item did nothing');
  assert.equal(p.belt[0], null, 'a consumed item is still on the belt');
  assert.equal(g.beltItem(0), null);
  assert.equal(p.inventory.includes(it), false, 'a consumed item is still in the pack');
});

test('shift+1 reaches the belt through handleKey', () => {
  const g = newGame('belt-key');
  arena(g);
  const p = g.state.player;
  p.hp = 1; p.maxhp = 50;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  g.handleKey(null, { belt: 0 });
  assert.ok(p.hp > 1);
});

test('an empty loop says so instead of doing nothing', () => {
  const g = newGame('belt-empty');
  arena(g);
  g.logs.length = 0;
  g.useBeltItem(2);
  assert.match(g.logs.join(' '), /empty/i);
});

test('dropping a belt item takes it off the belt when it is used', () => {
  const g = newGame('belt-stale');
  arena(g);
  const p = g.state.player;
  const it = potion();
  p.inventory.push(it);
  g.bindToBelt(it);
  p.inventory.splice(p.inventory.indexOf(it), 1);   /* gone from the pack behind the belt's back */
  g.logs.length = 0;
  g.useBeltItem(0);
  assert.equal(p.belt[0], null, 'the belt kept pointing at something not in the pack');
});

/* ---- p.buffs is a bag of countdowns ---- */

test('a buff magnitude does not decay like a duration', () => {
  /* tickStatus decrements every key in p.buffs, so a magnitude stored there
   * evaporates in a few turns. Magnitudes belong in p.buffLevels. */
  const g = newGame('magnitude');
  arena(g);
  const p = g.state.player;
  g.abilityBuff({ name: 'Ward', bonus: 3, aura: 8 });
  const gained = g.derived().toHit;
  for (let t = 0; t < 5; t++) { g.turn = t; g.tickStatus(); }
  assert.equal((p.buffLevels || {}).might, 3, 'the magnitude was decremented as if it were a countdown');
  assert.equal(g.derived().toHit, gained, 'the buff quietly faded while still active');
});

test('every value in p.buffs really is a countdown', () => {
  const g = newGame('countdowns');
  arena(g);
  const p = g.state.player;
  g.abilityBuff({ name: 'Ward', bonus: 4, aura: 6 });
  p.buffs.sanctuary = 5;
  p.buffs.str = 5;
  const before = { ...p.buffs };
  g.turn = 1;
  g.tickStatus();
  for (const k of Object.keys(before)) {
    assert.equal(p.buffs[k], before[k] - 1, `p.buffs.${k} did not tick down by exactly one — is it a duration?`);
  }
});

test('an old save without the new state loads and plays', () => {
  const g = newGame('legacy-buffs');
  const save = JSON.parse(JSON.stringify(g.save()));
  delete save.player.buffLevels;
  delete save.player.beatsSeen;
  delete save.player.npcsMet;
  const g2 = newGame('legacy-buffs');
  g2.restore(save);
  g2.loadFloor(0);
  g2.turn = 1;
  g2.tickStatus();
  assert.ok(g2.derived().toHit !== undefined, 'a legacy save cannot compute its own stats');
  g2.introduceNpc('hermit-ogil');
  assert.equal(g2.state.player.npcsMet['hermit-ogil'], true);
});
