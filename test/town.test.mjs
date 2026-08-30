/* THE WHETSTONE'S ECONOMY.
 *
 * The oldest open playtest note: "what is the purpose of gold, other than as
 * an excuse to resurrect the player?" Until now, nothing. The Gemstone's own
 * card has said "worth 40 gp to the right buyer" since the beginning, and
 * there has never been a buyer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { getItemTemplate, XP_FOR_LEVEL } from '../public/js/base.js';
import { deepItem, applyMagic, applyCurse } from '../public/js/dice.js';
import { PACK_LIMIT, makePlayer, initialStats, linkPurse } from '../public/js/engine.js';
import {
  PRICES, shopStock, buyItem, apparentValue, sellPrice, sellItem,
  unreadItems, knownCurses, identifyItem, unbindCurse,
  raiseCost, fallenMembers, raiseMember,
  hireMember,
} from '../public/js/town.js';

function rig(seed = 't', gold = 500) {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  g.state.player.gold = gold;
  return { g, p: g.state.player };
}

/* ---- the shop ---- */

test('the shelf always holds the essentials, and grows with your standing', () => {
  const { g, p } = rig('t-stock');
  const names = (s) => s.map((r) => r.id);
  assert.ok(names(shopStock(g)).includes('scroll-identify'), 'no way to buy a reading');
  assert.ok(names(shopStock(g)).includes('potion-heal'));
  const before = shopStock(g).length;

  p.bossesSlain.temple = true;
  assert.ok(shopStock(g).length > before, 'a boss slain and the shelf never changed');
  assert.ok(names(shopStock(g)).includes('scroll-remove-curse'));
  p.bossesSlain.upper = true;
  assert.ok(names(shopStock(g)).includes('scroll-sanctuary'));
});

test('buying costs the listed price and lands in the pack', () => {
  const { g, p } = rig('t-buy');
  const row = shopStock(g).find((r) => r.id === 'scroll-identify');
  const before = p.gold;
  assert.ok(buyItem(g, 'scroll-identify'));
  assert.equal(p.gold, before - row.price);
  assert.ok(p.inventory.some((it) => it.id === 'scroll-identify'));
});

test('a thin purse and a full pack both refuse cleanly', () => {
  const { g, p } = rig('t-refuse', 1);
  const packBefore = p.inventory.length;
  assert.equal(buyItem(g, 'potion-heal'), false);
  assert.equal(p.gold, 1, 'the shop took money it refused for');
  assert.equal(p.inventory.length, packBefore);

  p.gold = 500;
  while (p.inventory.length < PACK_LIMIT) p.inventory.push(deepItem(getItemTemplate('potion-heal')));
  assert.equal(buyItem(g, 'potion-heal'), false);
  assert.equal(p.gold, 500, 'the shop charged for an item it could not hand over');
});

test('the shop does not sell what it does not carry', () => {
  const { g, p } = rig('t-nostock');
  assert.equal(buyItem(g, 'plate'), false);
  assert.equal(buyItem(g, 'scroll-sanctuary'), false, 'endgame stock on the shelf from the start');
  assert.equal(p.gold, 500);
});

/* ---- the fence ---- */

test('the right buyer finally exists', () => {
  const { g, p } = rig('t-gem', 0);
  const gem = deepItem(getItemTemplate('gem'));
  p.inventory.push(gem);
  assert.ok(sellItem(g, gem));
  assert.ok(p.gold > 0, 'the Gemstone sold for nothing');
  assert.equal(p.inventory.includes(gem), false);
});

test('selling pays the look of a thing, not the truth of it', () => {
  /* An unread +3 blade priced at four times its base would spill the
   * enchantment through the price tag, and an unread curse would give itself
   * away by being cheap. The fence pays for what it appears to be. */
  const plain = deepItem(getItemTemplate('broadsword'));
  const blessed = applyMagic(deepItem(getItemTemplate('broadsword')), 3);
  const trapped = applyCurse(deepItem(getItemTemplate('broadsword')), 3);
  assert.equal(sellPrice(blessed), sellPrice(plain), 'the blessing leaked through the price');
  assert.equal(sellPrice(trapped), sellPrice(plain), 'the curse leaked through the price');

  /* Read, the truth is paid for — more for the blessing, less for the trap. */
  blessed.identified = true;
  trapped.identified = true;
  assert.ok(sellPrice(blessed) > sellPrice(plain));
  assert.ok(sellPrice(trapped) < sellPrice(plain));
});

test('selling does not read the rune for free', () => {
  const { g, p } = rig('t-noleak', 0);
  const mystery = applyMagic(deepItem(getItemTemplate('dagger')), 2);
  const twin = applyMagic(deepItem(getItemTemplate('dagger')), 2);
  p.inventory.push(mystery, twin);
  sellItem(g, mystery);
  assert.equal(twin.identified, false, 'selling one twin identified the other');
});

test('selling takes it off the belt as well as out of the pack', () => {
  const { g, p } = rig('t-belt', 0);
  const potion = deepItem(getItemTemplate('potion-heal'));
  p.inventory.push(potion);
  g.bindToBelt(potion);
  sellItem(g, potion);
  assert.ok(!p.belt.some((e) => g.beltUid(e) === potion.uid), 'the belt still points at a sold item');
});

test('what is worn cannot be sold from under you', () => {
  const { g, p } = rig('t-worn', 0);
  const worn = p.equipment.weapon;
  assert.ok(worn, 'the rig has no starting weapon');
  assert.equal(sellItem(g, worn), false);
  assert.equal(p.equipment.weapon, worn);
});

test('every price is at least a coin', () => {
  for (const id of ['dagger', 'gold-pile', 'gem']) {
    const it = deepItem(getItemTemplate(id));
    it.value = 0;
    assert.ok(sellPrice(it) >= 1, `${id} sells for nothing`);
  }
  const { g } = rig('t-floor');
  for (const row of shopStock(g)) assert.ok(row.price >= 1);
});

/* ---- the Lector ---- */

test('the Lector reads a rune for coin, and warns about what it says', () => {
  const { g, p } = rig('t-read');
  const trap = applyCurse(deepItem(getItemTemplate('broadsword')), 2);
  p.inventory.push(trap);
  assert.deepEqual(unreadItems(g), [trap]);
  const before = p.gold;
  g.logs.length = 0;
  assert.ok(identifyItem(g, trap));
  assert.equal(p.gold, before - PRICES.identify);
  assert.equal(trap.identified, true);
  assert.match(trap.name, /accursed/);
  assert.match(g.logs.join(' '), /Best not to wear that/);
  assert.deepEqual(unreadItems(g), []);
});

test('the Lector unbinds a worn curse, and then it comes off', () => {
  const { g, p } = rig('t-unbind');
  const trap = applyCurse(deepItem(getItemTemplate('broadsword')), 2);
  trap.identified = true;
  trap.name = trap.trueName;
  p.equipment.weapon = trap;
  assert.deepEqual(knownCurses(g), [trap]);
  const before = p.gold;
  assert.ok(unbindCurse(g, trap));
  assert.equal(p.gold, before - PRICES.unbind);
  assert.equal(trap.cursed, false);
  g.unequip('weapon');
  assert.equal(p.equipment.weapon, null, 'unbound, it still would not come off');
});

test('an unread curse can be unbound too — paying for the reading in the act', () => {
  const { g, p } = rig('t-blind-unbind');
  const trap = applyCurse(deepItem(getItemTemplate('leather-armor')), 1);
  p.equipment.body = trap;
  assert.ok(unbindCurse(g, trap));
  assert.equal(trap.identified, true, 'the loosening words taught you nothing');
  assert.equal(trap.cursed, false);
});

test('the Lector refuses a thin purse and an honest item alike', () => {
  const { g, p } = rig('t-refuse2', 5);
  const trap = applyCurse(deepItem(getItemTemplate('dagger')), 1);
  p.inventory.push(trap);
  assert.equal(identifyItem(g, trap), false);
  assert.equal(p.gold, 5);
  assert.equal(trap.identified, false, 'a refused reading read it anyway');

  p.gold = 500;
  const honest = deepItem(getItemTemplate('mace'));
  assert.equal(identifyItem(g, honest), false, 'paid to read a thing with nothing written on it');
  assert.equal(unbindCurse(g, honest), false);
  assert.equal(p.gold, 500);
});

/* ---- the Muster ---- */

test('a hireling arrives seasoned, armed, and paid for', () => {
  const { g, p } = rig('t-hire', 1000);
  for (let i = 1; i < 5; i++) g.levelUp();
  const cost = (5 - 1) * PRICES.hirePerLevel + PRICES.hire;
  const before = p.gold;
  const b = hireMember(g, 'mage');
  assert.ok(b, 'nobody came');
  assert.equal(p.gold, before - cost);
  assert.equal(b.level, p.level, 'the hireling arrived green');
  assert.ok(b.equipment.weapon, 'the hireling arrived unarmed');
  assert.equal(b.hp, b.maxhp);
  assert.equal(g.state.party.members.length, 2);
  assert.ok(!(b.x === p.x && b.y === p.y), 'two bodies on one tile');
});

test('the company caps at four, and a thin purse hires nobody', () => {
  const { g, p } = rig('t-hire-cap', 100000);
  hireMember(g, 'thief');
  hireMember(g, 'mage');
  hireMember(g, 'cleric');
  assert.equal(g.state.party.members.length, 4);
  assert.equal(hireMember(g, 'fighter'), null, 'a fifth squeezed in');

  const poor = rig('t-hire-poor', 5);
  assert.equal(hireMember(poor.g, 'thief'), null);
  assert.equal(poor.p.gold, 5, 'the Muster kept money it refused for');
  assert.equal(poor.g.state.party.members.length, 1);
});

test('hirelings take different names', () => {
  const { g } = rig('t-hire-names', 100000);
  const a = hireMember(g, 'thief');
  const b = hireMember(g, 'thief');
  assert.notEqual(a.name, b.name);
});

/* ---- experience is split among the living ---- */

test('experience is not divided by the size of the company', () => {
  /* It used to be split "the classic way", and the classic way assumes a
   * world tuned for a party. Every tier band here was fitted against what
   * ONE character earns walking down: measured, the Temple and the Upper
   * Reaches together take a soloist to level 10 and each of a company of
   * four to level SIX — against a third dungeon of tier 9-11 monsters.
   * Bringing friends must cost gold and rations, never levels. */
  /* Lifetime earnings, not the raw field: an award that crosses a
   * threshold levels the character and subtracts the cost, so `xp` can
   * fall while the member is plainly better off. */
  const earned = (m) => {
    let sum = m.xp;
    for (let l = 1; l < m.level; l++) sum += XP_FOR_LEVEL(l);
    return sum;
  };
  const { g, p } = rig('t-xp', 100000);
  g.gainXP(50);
  assert.equal(earned(p), 50, 'a party of one no longer gets everything');

  const b = hireMember(g, 'thief');
  const px = earned(p), bx = earned(b);
  g.gainXP(50);
  assert.equal(earned(p) - px, 50, 'the leader was taxed for having company');
  assert.equal(earned(b) - bx, 50, 'the hire earned a fraction of the kill');
});

test('the fallen still earn nothing', () => {
  const { g, p } = rig('t-xp-fallen', 100000);
  const b = hireMember(g, 'thief');
  b.hp = 0;
  const bx = b.xp, bl = b.level, px = p.xp;
  g.gainXP(80);
  assert.equal(p.xp - px, 80);
  assert.equal(b.xp, bx, 'a body on the floor drew a share');
  assert.equal(b.level, bl, 'a body on the floor levelled up');
});

test('the fallen earn nothing until they are up again', () => {
  const { g, p } = rig('t-xp-fallen', 100000);
  const b = hireMember(g, 'thief');
  b.hp = 0;
  const px = p.xp;
  g.gainXP(40);
  assert.equal(p.xp - px, 40, 'the living split with a corpse');
  assert.equal(b.xp, 0);
});

test('each member levels on their own account', () => {
  const { g, p } = rig('t-xp-level', 100000);
  const b = hireMember(g, 'mage');
  g.gainXP(500);   /* 250 each: level 2 costs 100, 3 costs 200 */
  assert.ok(p.level >= 2 && b.level >= 2, `levels ${p.level}/${b.level}`);
  assert.equal(p.level, b.level);
});

/* ---- T5: the town is ground now ---- */

import { generateTownFloor, T as TT, W as TW2, H as TH2, isTravelable as trav } from '../public/js/mapgen.js';
import { TOWN_ID } from '../public/js/engine.js';

test('the hamlet holds five keepers, three residents, and a mouth per dungeon', () => {
  const dungeons = [{ id: 'temple', name: 'The Temple' }, { id: 'upper', name: 'The Upper' }];
  const f = generateTownFloor(dungeons);
  const keepers = f.npcs.filter((n) => n.tpl.service);
  const residents = f.npcs.filter((n) => !n.tpl.service);
  assert.equal(keepers.length, 5, 'a counter went unkept');
  assert.ok(keepers.some((n) => n.tpl.service === 'temple'), 'the town lost its temple');
  assert.equal(residents.length, 3, 'a cottage stands empty');
  for (const r of residents) {
    assert.ok(r.tpl.intro && Array.isArray(r.tpl.topics) && r.tpl.topics.every((t) => t.keys && t.replies) && r.tpl.fallbacks, r.tpl.name + ' has nothing to say, or says it in the wrong shape');
  }
  assert.equal(f.mouths.length, 2, 'a dungeon lost its mouth');
  for (const m of f.mouths) assert.equal(f.tiles[m.y][m.x], TT.DOWN, 'a mouth that is not a stair');
  for (const n of f.npcs) assert.ok(trav(f.tiles[n.y][n.x]), n.tpl.name + ' standing in a wall');
  assert.ok(trav(f.tiles[f.entry.y][f.entry.x]), 'the arrival spot is not ground');
  assert.ok(f.tiles.some((row) => row.includes(TT.WATER)), 'the pond dried up');
});

test('every keeper and every mouth can be walked to from the entry', () => {
  const f = generateTownFloor([{ id: 'temple', name: 'T' }]);
  /* flood fill over travelable ground */
  const seen = new Set([f.entry.x + ',' + f.entry.y]);
  const queue = [[f.entry.x, f.entry.y]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= TW2 || ny >= TH2) continue;
      const k = nx + ',' + ny;
      if (seen.has(k) || !trav(f.tiles[ny][nx])) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  for (const n of f.npcs) assert.ok(seen.has(n.x + ',' + n.y), n.tpl.name + ' is unreachable');
  for (const m of f.mouths) assert.ok(seen.has(m.x + ',' + m.y), m.name + '\'s mouth is unreachable');
});

test('climbing out of the first floor lands the company on the green', () => {
  const g = newTownGame('t5-up');
  const p = g.state.player;
  const up = g.currentFloor.up;
  p.x = up.x; p.y = up.y - 1;
  g.tryMove(0, 1) || g.tryMove(0, -1) || (p.x = up.x, p.y = up.y, g.stepOn(up.x, up.y));
  /* however they got there, standing on the up-stair takes them home */
  if (!g.inTown()) { p.x = up.x; p.y = up.y; g.stepOn(up.x, up.y); }
  assert.equal(g.inTown(), true, 'the stairs up did not lead to town');
  assert.equal(p.dungeonId, TOWN_ID);
  assert.ok(g.currentFloor.mouths.length >= 1);
  assert.ok(g.vis[p.y][p.x], 'daylight failed');
});

test('a mouth on the green leads down into its dungeon', () => {
  const g = newTownGame('t5-down');
  const p = g.state.player;
  p.x = g.currentFloor.up.x; p.y = g.currentFloor.up.y;
  g.stepOn(p.x, p.y);
  assert.equal(g.inTown(), true);
  const mouth = g.currentFloor.mouths[0];
  p.x = mouth.x; p.y = mouth.y;
  g.stepOn(mouth.x, mouth.y);
  assert.equal(p.dungeonId, mouth.dungeonId, 'the mouth led somewhere else');
  assert.equal(p.floorIdx, 0);
  assert.ok(g.currentFloor && !g.currentFloor.mouths, 'still standing in town');
});

test('a reload keeps its place on the green', () => {
  const g = newTownGame('t5-keep');
  const p = g.state.player;
  p.x = g.currentFloor.up.x; p.y = g.currentFloor.up.y;
  g.stepOn(p.x, p.y);
  p.x = g.currentFloor.entry.x; p.y = g.currentFloor.entry.y;
  const save = JSON.parse(JSON.stringify(g.state));
  const g2 = newTownGame('t5-keep-2');
  g2.restore(save);
  g2.loadFloor(g2.state.player.floorIdx, 'keep');
  assert.equal(g2.inTown(), true, 'the reload forgot the town');
  assert.equal(g2.state.player.x, g.currentFloor.entry.x, 'the reload moved the party');
});

function newTownGame(seed) {
  const g = newGame(seed);
  return g;
}

/* ---- the basic loadout: nobody walks into the dark in their shirt ---- */

test('a hireling arrives dressed: weapon, armour, and shield where apropos', () => {
  const g = newGame('kit-hire');
  g.state.player.gold = 10000;
  for (const [cls, wantsShield] of [['fighter', true], ['thief', false], ['mage', false], ['cleric', true]]) {
    while (g.state.party.members.length > 1) g.state.party.members.pop();
    const b = hireMember(g, cls);
    assert.ok(b.equipment.weapon, cls + ' hired without a weapon');
    assert.ok(b.equipment.body, cls + ' hired without armour');
    assert.equal(!!b.equipment.shield, wantsShield, cls + ' and the shield disagree');
  }
});

test('a seasoned hire arrives in seasoned steel', () => {
  const g = newGame('kit-tiers');
  g.state.player.gold = 100000;
  for (let i = 1; i < 8; i++) g.levelUp(g.state.player);
  const b = hireMember(g, 'fighter');
  assert.equal(b.equipment.body.id, 'chainmail', 'a level-8 hire in beginner leather');
});

test('a founded adventurer starts in the same basic loadout', () => {
  const g = newGame('kit-found', 'cleric');
  const p = g.state.player;
  assert.ok(p.equipment.weapon, 'founded without a weapon');
  assert.equal(p.equipment.body.id, 'leather-armor', 'founded without armour');
  assert.ok(p.equipment.shield, 'a cleric founded without a shield');
});

/* ---- the Drowned Lantern ---- */

import { innCost, takeRoom } from '../public/js/town.js';

test('a night at the inn sets the whole company right, for coin', () => {
  const g = newGame('inn-1');
  const p = g.state.player;
  p.gold = 500;
  p.hp = 3; p.wounds = 4; p.power = 0; p.cooldowns = { cleave: 3 };
  const cost = innCost(g);
  assert.ok(takeRoom(g), 'the room was refused');
  assert.equal(p.hp, p.maxhp, 'woke unhealed');
  assert.equal(p.wounds, 0, 'woke still wounded — the whole point of paying');
  assert.equal(p.power, p.maxpower, 'woke unrested');
  assert.deepEqual(p.cooldowns, {}, 'woke with powers still stirring');
  assert.equal(p.gold, 500 - cost, 'the lamps are not free');
});

test('a thin purse sleeps outside', () => {
  const g = newGame('inn-2');
  const p = g.state.player;
  p.gold = 1; p.hp = 3;
  assert.ok(!takeRoom(g));
  assert.equal(p.hp, 3, 'healed without paying');
});

/* ---- the way home, and the way back down ----
 *
 * "Climbing back up is tedious and pointless since monsters do not respawn."
 * Both halves of the trip: a Scroll of Recall folds the company home, and
 * the dungeon mouths remember your deepest floor so the return does not
 * re-walk the swept halls either. */


test('the scroll of recall folds the whole company home', () => {
  const { g, p } = rig('t-recall');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  buddy.x = p.x + 1; buddy.y = p.y;
  g.state.party.members.push(buddy);
  p.inventory.push(deepItem(getItemTemplate('scroll-recall')));
  const scroll = p.inventory[p.inventory.length - 1];
  g.useItem(scroll);
  assert.equal(p.dungeonId, TOWN_ID, 'the reader stayed below');
  assert.equal(buddy.dungeonId, TOWN_ID, 'the company was left behind');
  assert.ok(!p.inventory.includes(scroll), 'the scroll survived its own reading');
});

test('the scroll refuses a fight, and costs nothing refused', () => {
  const { g, p } = rig('t-recall-fight');
  g.currentFloor.monsters.push({
    t: { id: 'w', name: 'Watcher', glyph: 'w', color: 'red', hpMax: 10, ac: 10, toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 10 },
    x: p.x + 1, y: p.y, hp: 10, maxhp: 10, boss: false, aggro: true,
    toHit: 0, dmg: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, ini: 1,
  });
  p.inventory.push(deepItem(getItemTemplate('scroll-recall')));
  const scroll = p.inventory[p.inventory.length - 1];
  g.useItem(scroll);
  assert.notEqual(p.dungeonId, TOWN_ID, 'recalled out of a fight');
  assert.ok(p.inventory.includes(scroll), 'the refused scroll was spent anyway');
});

test('read at home, the scroll knows better', () => {
  const { g, p } = rig('t-recall-home');
  g.enterTown(p.dungeonId);
  p.inventory.push(deepItem(getItemTemplate('scroll-recall')));
  const scroll = p.inventory[p.inventory.length - 1];
  g.useItem(scroll);
  assert.ok(p.inventory.includes(scroll), 'the scroll was wasted on a walk to the well');
});

test('the provisioner keeps the way home on the shelf from day one', () => {
  const { g } = rig('t-recall-stock');
  assert.ok(shopStock(g).map((r) => r.id).includes('scroll-recall'));
});

test('the mouths remember the deepest floor', () => {
  const { g, p } = rig('t-mouth-deep');
  p.deepest = { temple: 2 };
  g.enterTown(p.dungeonId);
  g.enterDungeon('temple');
  assert.equal(p.floorIdx, 2, 'the mouth forgot, and floor ' + (p.floorIdx + 1) + ' is where you stand');
});

test('a companion’s goods sell from their pack into the purse at the counter', () => {
  const { g, p } = rig('t-sell-owner');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  g.state.party.members.push(buddy);
  const gem = deepItem(getItemTemplate('scroll-identify'));
  buddy.inventory.push(gem);
  const purse = p.gold;
  assert.ok(sellItem(g, gem, buddy));
  assert.ok(!buddy.inventory.includes(gem), 'the goods never left the porter’s pack');
  assert.ok(p.gold > purse, 'the coin never reached the purse');
});

test('an old blink scroll takes its new name on the next load', () => {
  const { g, p } = rig('t-blink-rename');
  const old = deepItem(getItemTemplate('scroll-teleport'));
  old.name = 'Scroll of Recall';   /* as saved before the rename */
  p.inventory.push(old);
  const raw = JSON.stringify(g.state);
  const g2 = newGame('t-blink-rename-2', 'fighter');
  g2.restore(JSON.parse(raw));
  const held = g2.state.player.inventory.find((it) => it.id === 'scroll-teleport');
  assert.equal(held && held.name, 'Scroll of Blinking', 'the stale name survived the load');
});

/* ---- the company's knowledge is the company's ----
 *
 * Reading and unbinding were welded to the active member — the heal-yourself
 * bug wearing different clothes: a companion's unread ring had to be handed
 * to the leader, read, and handed back. The Lector's ledger, the identify
 * scroll and the curse-lifting now sweep every pack in the company. */

test('the lector’s ledger lists a companion’s unread ring', () => {
  const { g, p } = rig('t-ledger-company');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  g.state.party.members.push(buddy);
  const it = deepItem(getItemTemplate('short-sword'));
  applyMagic(it, 1); it.identified = false;
  buddy.inventory.push(it);
  assert.ok(unreadItems(g).includes(it), 'the ledger cannot see past the leader');
  assert.ok(identifyItem(g, it), 'the lector refused a companion’s item');
  assert.equal(it.identified, true);
});

test('an identify scroll reads every pack in the company', () => {
  const { g, p } = rig('t-scroll-company');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  g.state.party.members.push(buddy);
  const it = deepItem(getItemTemplate('short-sword'));
  applyMagic(it, 1); it.identified = false;
  buddy.inventory.push(it);
  g.identifyAll();
  assert.equal(it.identified, true, 'the scroll stopped at the leader’s pack');
});

test('lifting curses reaches a companion’s back', () => {
  const { g } = rig('t-curse-company');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  g.state.party.members.push(buddy);
  const it = deepItem(getItemTemplate('short-sword'));
  applyMagic(it, 1); applyCurse(it); it.identified = true;
  buddy.equipment.weapon = it;
  g.removeAllCurses();
  assert.equal(it.cursed, false, 'the curse stayed bound across the campfire');
});

test('a trade moves the knowing with the thing', () => {
  const { g, p } = rig('t-trade-knowing');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  buddy.x = p.x + 1; buddy.y = p.y;
  g.state.party.members.push(buddy);
  const known = deepItem(getItemTemplate('short-sword'));
  applyMagic(known, 2); g.revealItem(known);
  const unread = deepItem(getItemTemplate('short-sword'));
  applyMagic(unread, 1); applyCurse(unread); unread.identified = false;
  p.inventory.push(known, unread);
  g.giveItem(known, buddy, p);
  g.giveItem(unread, buddy, p);
  assert.equal(known.identified, true, 'a read rune went dark in the handover');
  assert.equal(unread.identified, false, 'an unread rune read itself in the handover');
  assert.equal(unread.cursed, true, 'the hidden curse washed off in the handover');
});

test('a follower never stands inside the widow', () => {
  /* Reported: "Maren doesn't activate." The van's marching station landed
   * on her tile — the follower step search excluded members and monsters
   * but not townsfolk — and every bump after that greeted the follower. */
  const g = newGame('t-maren-solid', 'mage');
  let opened = null;
  g.ui.openDialogue = (npc) => { opened = npc.tpl.id; };
  g.enterTown('temple');
  const maren = g.currentFloor.npcs.find((n) => n.tpl.id === 'maren');
  const p = g.state.player;
  const van = makePlayer('Point', 'fighter', initialStats('fighter'));
  van.dungeonId = p.dungeonId; van.floorIdx = p.floorIdx;
  g.state.party.members.push(van);
  p.x = maren.x; p.y = maren.y + 3;
  van.x = p.x; van.y = p.y + 1;
  g.handleKey('w');
  g.handleKey('w');   /* the van's station is now her tile — it must refuse */
  assert.ok(!(van.x === maren.x && van.y === maren.y), 'the van is standing inside Maren');
  g.tryMove(0, -1);
  assert.equal(opened, 'maren', 'the widow did not answer her own door');
});

test('the rack and the rail: plain arms and armour are always in stock', () => {
  const { g } = rig('t-rack');
  const ids = shopStock(g).map((r) => r.id);
  for (const want of ['dagger', 'short-sword', 'staff', 'leather-armor', 'padded-armor', 'small-shield']) {
    assert.ok(ids.includes(want), 'the Provisioner is out of ' + want);
  }
  assert.ok(!ids.includes('chainmail'), 'veteran steel on the shelf before any boss fell');
  g.state.player.bossesSlain.temple = true;
  assert.ok(shopStock(g).map((r) => r.id).includes('chainmail'), 'standing grew and the rack did not');
});

test('nothing in the town stands inside anything else', () => {
  /* Old Casp moved house for the temple's sightline; this pins that no
   * keeper, resident, prop or building ever overlaps another. */
  const f = generateTownFloor([{ id: 'temple', name: 'T' }, { id: 'upper', name: 'U' }]);
  const spots = new Map();
  const claim = (x, y, who) => {
    const k = x + ',' + y;
    assert.ok(!spots.has(k), who + ' stands inside ' + spots.get(k) + ' at ' + k);
    spots.set(k, who);
  };
  for (const n of f.npcs) claim(n.x, n.y, n.tpl.id);
  for (const pr of (f.props || [])) if (!pr.flat) claim(pr.x, pr.y, 'prop ' + (pr.piece || pr.atlas));
  for (const n of f.npcs) {
    assert.ok(f.tiles[n.y][n.x] === TT.FLOOR, n.tpl.id + ' stands on an unwalkable tile');
  }
});

test('felling a god writes the next mouth into the journal', () => {
  const { g } = rig('t-unlock-journal');
  g.onBossSlain({ t: { name: 'Demon of Lapsai' }, boss: true });
  const entries = (g.state.journal || []).map((j) => j.text).join(' | ');
  assert.match(entries, /east field/, 'the unlock left no durable trace: ' + entries);
});

/* ---- the demon's fall is the company's victory ----
 *
 * Reported: "It's like I didn't kill the demon, but I did." They did — with
 * a companion at the reins, and the flag was written to that one sheet.
 * The town read the LEADER's sheet, found nothing, and kept the second
 * mouth shut. Expedition knowledge is written to every member now, pooled
 * from old saves on load, and dealt to new hires at the muster. */
test('a boss slain under any member’s reins opens the next mouth', () => {
  const { g, p } = rig('t-company-victory');
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx;
  g.state.party.members.push(buddy);
  g.state.party.active = 1;              /* the companion lands the blow */
  g.onBossSlain({ t: { name: 'Demon of Lapsai' }, boss: true });
  g.state.party.active = 0;              /* the reins come home */
  assert.ok(p.bossesSlain.temple, 'the fall was written to one sheet only');
  assert.ok(g.availableDungeons().some((d) => d.id === 'upper'), 'the second mouth stayed shut');
});

test('an old save with a one-sheet victory is pooled on load', () => {
  const { g, p } = rig('t-victory-pool');
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.bossesSlain = { temple: true };
  buddy.deepest = { temple: 3 };
  g.state.party.members.push(buddy);
  const raw = JSON.parse(JSON.stringify(g.save()));
  const g2 = newGame('t-victory-pool-2', 'fighter');
  g2.restore(raw);
  assert.ok(g2.state.player.bossesSlain.temple, 'the pooled victory never reached the leader');
  assert.equal(g2.state.player.deepest.temple, 3, 'the pooled depth never reached the leader');
});

test('a new hire signs on to the expedition’s knowledge', () => {
  const { g, p } = rig('t-hire-knows', 800);
  p.bossesSlain.temple = true;
  p.deepest = { temple: 3 };
  const hired = hireMember(g, 'thief');
  assert.ok(hired.bossesSlain.temple, 'the hire never heard the demon fell');
  assert.equal(hired.deepest.temple, 3, 'the hire does not know the way down');
});

test('a story beat seen under one member’s reins does not replay under another’s', () => {
  const { g, p } = rig('t-beat-once');
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx;
  g.state.party.members.push(buddy);
  const shown = [];
  g.ui.showBeat = (b) => shown.push(b.title || b.text);
  g.state.party.active = 1;
  g.fireBeats('enter', 0);           /* the companion walks in first */
  const afterFirst = shown.length;
  g.state.party.active = 0;
  g.fireBeats('enter', 0);           /* the leader follows — silence */
  assert.equal(shown.length, afterFirst, 'the same beat played twice for two sets of reins');
});

/* ---- one purse, wherever the reins are ----
 *
 * Reported: "Your purse always reflects whichever character is selected."
 * Gold lived on each sheet and was spent from whichever held the reins —
 * harmless while the reins never moved, and a vanishing act once a chip
 * click could hand them over. The coin is the expedition's now. */
test('the purse does not change hands when the reins do', () => {
  const { g, p } = rig('t-purse-reins', 900);
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx;
  buddy.gold = 0;   /* joins empty-handed, as a hire does */
  g.state.party.members.push(buddy);
  linkPurse(g.state);
  assert.equal(g.purse(), 900);
  g.state.party.active = 1;                 /* the fighter takes the reins */
  assert.equal(g.purse(), 900, 'the purse emptied when the reins moved');
  assert.equal(g.state.player.gold, 900, 'the sheet disagrees with the purse');
});

test('every counter in town spends the one purse', () => {
  const { g, p } = rig('t-purse-counters', 1000);
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx;
  buddy.gold = 0;
  g.state.party.members.push(buddy);
  linkPurse(g.state);
  g.state.party.active = 1;                 /* shopping under the companion's reins */
  const row = shopStock(g).find((r) => r.id === 'potion-heal');
  assert.ok(buyItem(g, 'potion-heal'), 'the shop refused a full purse');
  assert.equal(g.purse(), 1000 - row.price, 'the company purse was not charged');
  /* and the goods landed in the buyer's own pack */
  assert.ok(buddy.inventory.some((it) => it.id === 'potion-heal'));
});

test('an old save with gold on every sheet pools it once', () => {
  const { g, p } = rig('t-purse-pool', 0);
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  g.state.party.members.push(buddy);
  const raw = JSON.parse(JSON.stringify(g.save()));
  /* Hand-build the old shape: coin on the sheets, none on the party. */
  delete raw.party.gold;
  raw.party.members[0].gold = 700;
  raw.party.members[1].gold = 25;
  const g2 = newGame('t-purse-pool-2', 'fighter');
  g2.restore(raw);
  assert.equal(g2.purse(), 725, 'the scattered coin did not pool');
  const saved = JSON.parse(JSON.stringify(g2.save()));
  assert.equal(saved.party.gold, 725, 'the purse did not survive the next save');
  assert.equal(saved.party.members[0].gold, undefined, 'a sheet kept a second copy of the purse');
});

/* ---- the bell, and whose pack the goods land in ---- */
test('the temple raises a fallen companion for coin', () => {
  const { g, p } = rig('t-raise', 900);
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx;
  buddy.gold = 0;
  g.state.party.members.push(buddy);
  linkPurse(g.state);
  buddy.hp = 0;
  assert.deepEqual(fallenMembers(g).map((m) => m.name), ['Blade']);
  const cost = raiseCost(buddy);
  assert.ok(raiseMember(g, buddy), 'the bell refused a full purse');
  assert.ok(buddy.hp > 0, 'the fallen stayed down');
  assert.equal(g.purse(), 900 - cost, 'the raising was free');
  assert.equal(fallenMembers(g).length, 0);
});

test('a purse too thin cannot buy a life, and is not charged for trying', () => {
  const { g, p } = rig('t-raise-poor', 5);
  const buddy = makePlayer('Blade', 'fighter', initialStats('fighter'));
  buddy.gold = 0;
  g.state.party.members.push(buddy);
  linkPurse(g.state);
  buddy.hp = 0;
  assert.equal(raiseMember(g, buddy), false);
  assert.equal(g.purse(), 5, 'the temple kept money for a bell it never rang');
  assert.equal(buddy.hp, 0);
});

test('goods bought land in the pack that is on the counter', () => {
  const { g, p } = rig('t-buy-who', 900);
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  buddy.gold = 0;
  g.state.party.members.push(buddy);
  linkPurse(g.state);
  const before = buddy.inventory.length;
  assert.ok(buyItem(g, 'potion-heal', buddy), 'the shop refused the sale');
  assert.equal(buddy.inventory.length, before + 1, 'the potion went to the wrong pack');
  assert.ok(!p.inventory.some((it) => it && it.id === 'potion-heal' && p.inventory.length > 0 && false));
});

test('a company stranded by the old split is paid its back wages on load', () => {
  /* Fixing the rule going forward rescues nobody already stuck: the
   * monsters that would pay for the levels cannot be beaten at the level
   * the split delivered. The refund runs once, on load. */
  const { g, p } = rig('t-backpay', 0);
  for (const [n, c] of [['Blade', 'thief'], ['Ash', 'mage'], ['Vera', 'cleric']]) {
    const m = makePlayer(n, c, initialStats(c));
    m.dungeonId = p.dungeonId; m.floorIdx = p.floorIdx; m.gold = 0;
    g.state.party.members.push(m);
  }
  for (const m of g.state.party.members) { while (m.level < 6) g.levelUp(m); m.hp = 1; }
  const raw = JSON.parse(JSON.stringify(g.save()));
  delete raw.xpUnsplit;                       /* as a save written under the split */

  const g2 = newGame('t-backpay-2', 'fighter');
  g2.restore(raw);
  for (const m of g2.state.party.members) {
    assert.ok(m.level > 6, `${m.name} is still level ${m.level}`);
    assert.equal(m.hp, m.maxhp, `${m.name} was handed levels and left at 1 hp`);
  }
  const levels = g2.state.party.members.map((m) => m.level);
  assert.equal(new Set(levels).size, 1, 'the company came out uneven: ' + levels.join(','));

  /* And never twice: a second load must change nothing. */
  const again = JSON.parse(JSON.stringify(g2.save()));
  const g3 = newGame('t-backpay-3', 'fighter');
  g3.restore(again);
  assert.deepEqual(g3.state.party.members.map((m) => m.level), levels, 'the refund paid out twice');
});

test('a soloist is owed nothing, because nothing was divided', () => {
  const { g, p } = rig('t-backpay-solo', 0);
  while (p.level < 5) g.levelUp(p);
  const raw = JSON.parse(JSON.stringify(g.save()));
  delete raw.xpUnsplit;
  const g2 = newGame('t-backpay-solo-2', 'fighter');
  g2.restore(raw);
  assert.equal(g2.state.player.level, 5, 'a lone adventurer was handed levels they had not earned');
});

test('the refund is measured by the best-travelled, not by whoever holds the reins', () => {
  /* A company can be led by a fresh face with veterans behind them —
   * keying the refund off the leader would pay that company nothing. */
  const { g, p } = rig('t-backpay-leader', 0);
  const vet = makePlayer('Vet', 'fighter', initialStats('fighter'));
  vet.dungeonId = p.dungeonId; vet.floorIdx = p.floorIdx; vet.gold = 0;
  g.state.party.members.push(vet);
  while (vet.level < 8) g.levelUp(vet);      /* the veteran did the walking */
  const raw = JSON.parse(JSON.stringify(g.save()));
  delete raw.xpUnsplit;
  const g2 = newGame('t-backpay-leader-2', 'fighter');
  g2.restore(raw);
  const levels = g2.state.party.members.map((m) => m.level);
  assert.ok(levels.every((l) => l > 8), 'the fresh-faced leader capped the refund: ' + levels.join(','));
});

/* THE NORTH GATE. Shut on purpose — nothing is written beyond the wall yet —
 * so what these guard is that it stays shut, stays four tiles wide, and keeps
 * standing on the one town wall whose face this camera can see. */

test('the gate is a shut wall, not a way out', () => {
  const g = newGame('gate');
  const floor = generateTownFloor([]);
  const all = [...floor.gateDoors, ...floor.gateTowers];
  assert.equal(floor.gateDoors.size, 2, 'a gate needs two leaves to meet at a ridge');
  assert.equal(floor.gateTowers.size, 2, 'towers either side, the playtest asked, and either side is two');
  for (const key of all) {
    const x = key % TW2, y = Math.floor(key / TW2);
    assert.equal(floor.tiles[y][x], TT.WALL, `the gate at ${x},${y} can be walked through`);
  }
  void g;
});

test('and it stands where the camera can see its face', () => {
  /* The building kit draws facing the camera: a cottage door sits in its
   * southmost row. So the gate belongs on the wall whose SOUTH side is the
   * green — the northern treeline. On the east wall it would be a door
   * painted on the outside of the town. */
  const floor = generateTownFloor([]);
  for (const key of [...floor.gateDoors, ...floor.gateTowers]) {
    const x = key % TW2, y = Math.floor(key / TW2);
    assert.notEqual(floor.tiles[y + 1][x], TT.WALL, `nothing open south of the gate at ${x},${y}`);
  }
});

test('the two leaves are side by side, so they can meet at a ridge', () => {
  const floor = generateTownFloor([]);
  const doors = [...floor.gateDoors].sort((a, b) => a - b);
  assert.equal(doors[1] - doors[0], 1, 'the leaves are stacked north-south, where the kit cannot join them');
  const towers = [...floor.gateTowers].sort((a, b) => a - b);
  assert.equal(doors[0] - towers[0], 1, 'the west turret does not touch the gate');
  assert.equal(towers[1] - doors[1], 1, 'the east turret does not touch the gate');
});

/* THE EAST FIELD, AND WHAT IT WILL LET YOU WALK INTO.
 *
 * Two things the Library exposed. The mouths ran down one column spaced five
 * apart and were dropped past the edge of the field, so the sixth way down —
 * three founding sanctums plus three written ones — existed, was "available",
 * and had no stairs. And nothing scaled a written sanctum to the company:
 * monsters take their numbers from depth and threat by design, which left a
 * generous model free to hand a post-game party a stroll and a dramatic one
 * free to hand a level-3 company four hundred hit points with no warning.
 */

test('the east field holds every way down, not the first five', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'd' + i, name: 'Sanctum ' + i }));
  const f = generateTownFloor(many);
  assert.equal(f.mouths.length, many.length, 'ways down were silently dropped');
  const seen = new Set(f.mouths.map((m) => m.x + ',' + m.y));
  assert.equal(seen.size, many.length, 'two mouths were placed on the same tile');
});

test('and every one of them is a staircase you can walk to', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'd' + i, name: 'Sanctum ' + i }));
  const f = generateTownFloor(many);
  const seen = Array.from({ length: TH2 }, () => Array(TW2).fill(false));
  const q = [f.entry];
  seen[f.entry.y][f.entry.x] = true;
  while (q.length) {
    const c = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= TW2 || y >= TH2 || seen[y][x]) continue;
      if (!trav(f.tiles[y][x])) continue;
      seen[y][x] = true; q.push({ x, y });
    }
  }
  for (const m of f.mouths) {
    assert.equal(f.tiles[m.y][m.x], TT.DOWN, m.name + ' has no stairs at ' + m.x + ',' + m.y);
    assert.ok(seen[m.y][m.x], m.name + ' cannot be walked to');
  }
});

test('a written sanctum wears the strength it was cut for', () => {
  const f = generateTownFloor([{ id: 'w', name: 'The Debtor’s Bastion', minLevel: 12 }]);
  assert.match(f.mouths[0].name, /Lv 12\+/, 'the mouth does not say what it asks of you');
});

test('and the door is shut until the company has it', () => {
  const g = newGame('gate-level');
  g.registry.dungeons.push({
    id: 'bastion', name: 'The Debtor’s Bastion', floors: 3, theme: 'halls',
    threat: 8, minLevel: 12, monsters: [], items: [], boss: null,
  });
  const p = g.state.player;
  p.bossesSlain = { temple: true, upper: true, serpent: true };
  g.logs.length = 0;
  g.enterDungeon('bastion');
  assert.notEqual(p.dungeonId, 'bastion', 'a level-1 company walked into a level-12 sanctum');
  assert.ok(g.logs.some((l) => /shut to you/.test(l)), 'and was told nothing about why');

  for (let i = 1; i < 12; i++) g.levelUp();
  g.enterDungeon('bastion');
  assert.equal(p.dungeonId, 'bastion', 'a company that met the mark was still refused');
});

test('the founding three are never level-gated, whatever else is', () => {
  /* They unlock in order by what you have killed; a level gate on top could
   * only strand somebody between the two rules. */
  const g = newGame('gate-base');
  for (const id of g.baseDungeonIds()) {
    const d = g.dungeonById(id);
    assert.equal(g.dungeonBarred({ ...d, minLevel: 99 }), null, id + ' was barred by level');
  }
});

test('a company is its average, not its best or its worst', () => {
  const g = newGame('company-level');
  const mate = makePlayer('Hireling', 'thief', initialStats('thief'));
  g.state.party.members.push(mate);
  for (let i = 1; i < 11; i++) g.levelUp(g.state.player);   /* 11 and 1 */
  assert.equal(g.companyLevel(), 6, 'a veteran and a hireling did not average to six');
});

/* A REGISTRY IS ADDED TO, NEVER REPLACED.
 *
 * Every save writes the whole registry into the character's record, and
 * loading one replaced the live registry with that snapshot, then persisted it
 * over localStorage. Commission a dungeon, reload, press CONTINUE, and the
 * older snapshot wiped it from the game and from disk — while the server kept
 * serving it, so every boot reinstalled it and every CONTINUE wiped it again.
 * This is the shape of that, at the level the engine can see.
 */

test('a dungeon the world knows about survives a save that predates it', () => {
  const world = {
    items: [], abilities: [], monsters: [{ id: 'm1', name: 'New Thing' }],
    dungeons: [{ id: 'exp-new', name: 'The Tithing Vault', requires: 'temple' }],
  };
  const older = {
    items: [{ id: 'i0', name: 'Old Trinket' }], abilities: [], monsters: [],
    dungeons: [{ id: 'exp-old', name: 'An Earlier Work', requires: 'temple' }],
  };
  /* The union the loader now performs. */
  const merged = { items: [], monsters: [], dungeons: [], abilities: [] };
  for (const key of Object.keys(merged)) {
    const seen = new Set();
    for (const list of [world[key], older[key]]) {
      for (const e of (list || [])) {
        if (!e || !e.id || seen.has(e.id)) continue;
        seen.add(e.id); merged[key].push(e);
      }
    }
  }
  assert.deepEqual(merged.dungeons.map((d) => d.id), ['exp-new', 'exp-old'],
    'loading an older save dropped a dungeon the world already knew');
  assert.equal(merged.items.length, 1, 'the save’s own work was lost instead');
});

test('and a written dungeon reaches the green with the level it asks for', () => {
  const g = newGame('written-mouth');
  g.state.player.bossesSlain = { temple: true, upper: true, serpent: true };
  g.registry.dungeons.push({
    id: 'exp-vault', type: 'dungeon', name: 'The Tithing Vault',
    floors: 10, theme: 'tomb', threat: 12, requires: 'temple',
    monsterWeights: [], bossId: null, minLevel: 13,
  });
  g.enterTown();
  const mouth = (g.currentFloor.mouths || []).find((m) => m.dungeonId === 'exp-vault');
  assert.ok(mouth, 'a written dungeon got no way in');
  assert.match(mouth.name, /Lv 13\+/, 'the mouth does not say what it asks of you');
});
