/* Generated content reaching the player. Validation and persistence always
 * worked; nothing downstream consumed the results. Items never entered a loot
 * table, abilities took a number key and did nothing, and monsters arrived
 * with their behaviour under a field name the engine does not read. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, initialStats } from '../public/js/engine.js';
import { validateItem, validateAbility, validateMonster } from '../lib/expansion.js';
import { RNG } from '../public/js/rng.js';

function gameWith(registry, clsId = 'fighter') {
  const logs = [];
  const g = new Game({ registry: { items: [], monsters: [], dungeons: [], abilities: [], ...registry }, ui: { log: (m) => logs.push(m) } });
  g.foundAdventurer('Tester', clsId, initialStats(clsId));
  g.logs = logs;
  return g;
}

test('a generated item can be found in the dungeon', () => {
  const blade = { ...validateItem({ name: 'Ash Fang', kind: 'weapon', tier: 2, glyph: 'f', effects: { damage: { dice: 1, sides: 8 } } }), id: 'exp-blade' };
  const g = gameWith({ items: [blade] });

  let found = false;
  for (let s = 0; s < 400 && !found; s++) {
    const it = g.pickItem(2, new RNG('loot-' + s));
    if (it && it.name.includes('Ash Fang')) found = true;
  }
  assert.ok(found, 'the Library made an item the dungeon can never produce');
});

test('a generated item too rich for the floor stays out of shallow loot', () => {
  const relic = { ...validateItem({ name: 'Crown of the Deep', kind: 'amulet', tier: 14 }), id: 'exp-relic' };
  const g = gameWith({ items: [relic] });
  for (let s = 0; s < 300; s++) {
    const it = g.pickItem(0, new RNG('shallow-' + s));
    assert.ok(!it || !it.name.includes('Crown of the Deep'), 'an endgame relic turned up on floor one');
  }
});

test('a generated ability appears for its own class and level, and no other', () => {
  const spell = { ...validateAbility({ name: 'Ashen Ward', cls: 'mage', level: 3, kind: 'buff', powerCost: 2, bonus: 2 }), id: 'exp-ward' };

  const lowMage = gameWith({ abilities: [spell] }, 'mage');
  assert.ok(!lowMage.allAbilities().some((a) => a.id === 'exp-ward'), 'offered below its level requirement');

  lowMage.state.player.level = 3;
  assert.ok(lowMage.allAbilities().some((a) => a.id === 'exp-ward'), 'not offered once earned');

  const fighter = gameWith({ abilities: [spell] }, 'fighter');
  fighter.state.player.level = 9;
  assert.ok(!fighter.allAbilities().some((a) => a.id === 'exp-ward'), 'a mage power was offered to a fighter');
});

test('a generated ability actually does something when cast', () => {
  const spell = { ...validateAbility({ name: 'Ashen Ward', cls: 'fighter', level: 1, kind: 'buff', powerCost: 2, bonus: 3, aura: 4 }), id: 'exp-ward' };
  const g = gameWith({ abilities: [spell] });
  g.loadFloor(0);
  const p = g.state.player;
  const power = p.power;
  const toHit = g.derived().toHit;

  g.activateAbility('exp-ward');

  assert.ok(p.power < power, 'casting it cost nothing — it was a silent no-op');
  assert.ok(g.derived().toHit > toHit, 'the buff had no effect on anything');
});

test('a generated healing ability heals', () => {
  const mend = { ...validateAbility({ name: 'Mend', cls: 'fighter', level: 1, kind: 'heal', powerCost: 1, heal: { dice: 3, sides: 6 } }), id: 'exp-mend' };
  const g = gameWith({ abilities: [mend] });
  g.loadFloor(0);
  const p = g.state.player;
  p.hp = 3;
  g.activateAbility('exp-mend');
  assert.ok(p.hp > 3, 'a generated heal healed nothing');
});

test('asking for an ability that does not exist says so instead of nothing', () => {
  const g = gameWith({});
  g.loadFloor(0);
  g.logs.length = 0;
  g.activateAbility('no-such-power');
  assert.ok(g.logs.length > 0, 'silent failure');
});

test('a generated monster keeps its behaviour in play', () => {
  const wraith = { ...validateMonster({ name: 'Ash Wraith', glyph: 'w', tier: 4, hpMax: 20, properties: ['undead'] }), id: 'exp-wraith' };
  const g = gameWith({ monsters: [wraith] });
  const template = g.monsterTemplate('exp-wraith');
  assert.ok(template, 'the registry monster cannot be looked up');
  assert.deepEqual(template.props, ['undead'], 'the engine cannot see its properties');
});

test('a generated dungeon is playable, with a boss on its last floor', () => {
  const dungeon = {
    id: 'exp-fane', type: 'dungeon', name: 'The Sunken Fane', flavor: 'Water remembers.',
    floors: 3, theme: 'cavern', threat: 3, requires: 'temple',
    monsterWeights: ['exp-fane-m0', 'exp-fane-boss'], bossId: 'exp-fane-boss',
  };
  const monsters = [
    { ...validateMonster({ name: 'Fane Eel', glyph: 'e', tier: 5, hpMax: 24, damage: { dice: 2, sides: 4 }, properties: ['poison'] }), id: 'exp-fane-m0' },
    { ...validateMonster({ name: 'Drowned Choir', glyph: 'C', tier: 9, hpMax: 120, damage: { dice: 3, sides: 6 }, properties: ['undead'] }), id: 'exp-fane-boss' },
  ];
  const g = gameWith({ dungeons: [dungeon], monsters });
  g.state.player.bossesSlain.temple = true;

  assert.ok(g.availableDungeons().some((d) => d.id === 'exp-fane'), 'a generated dungeon never becomes available');

  g.enterDungeon('exp-fane');
  assert.equal(g.state.player.dungeonId, 'exp-fane');

  g.loadFloor(2);
  const boss = g.currentFloor.monsters.find((m) => m.boss);
  assert.ok(boss, 'the generated dungeon has no boss, so it can never be cleared');
  assert.equal(boss.dmg.dice, 3, 'the boss lost its damage dice on the way in');

  g.killMonster(boss);
  assert.equal(g.isDungeonCleared('exp-fane'), true);
});

test('an item with a misc slot cannot crash the game', () => {
  const oddity = { ...validateItem({ name: 'Knot of String', kind: 'nonsense' }), id: 'exp-odd' };
  const g = gameWith({ items: [oddity] });
  g.loadFloor(0);
  const p = g.state.player;
  p.inventory.push(oddity);
  g.useItem(oddity);                  /* used to be a stack overflow */
  assert.ok(g.logs.join(' ').length > 0);
});
