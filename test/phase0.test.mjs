/* V2 Phase 0 — making it fair.
 *
 * v1 measured, for a bot that fights everything and never retreats: every class
 * died before the Temple's fourth floor, and all four plateaued around level 1.
 * The cause was not the XP curve — the Temple holds 5,790 XP and level 6 costs
 * 5,250. It was that nothing ever came back. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { CLASSES, DUNGEONS } from '../public/js/base.js';
import { RNG } from '../public/js/rng.js';
import { newGame, floorOf, savedPlayer } from './helpers.mjs';

function arena(g) {
  const grid = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 18; y++) for (let x = 5; x < 30; x++) grid[y][x] = T.FLOOR;
  g.currentFloor = {
    w: W, h: H, tiles: grid, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 10 }, down: null, altar: null, cache: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  g.state.player.x = 10;
  g.state.player.y = 10;
  return g.currentFloor;
}

function beast(x, y, over = {}) {
  const t = {
    id: 't', name: 'Beast', glyph: 'B', color: 'red', tier: 1, hpMax: 40, ac: 10,
    toHit: 0, damage: { dice: 1, sides: 4, bonus: 0 }, xp: 5, goldMin: 0, goldMax: 0,
    props: [], speed: 1, aggroRange: 30, ...(over.t || {}),
  };
  return {
    t, x, y, hp: over.hp ?? 40, maxhp: 40, boss: false, aggro: true, acted: false,
    toHit: 0, dmg: { dice: 1, sides: 4, bonus: 0 }, xp: 5, goldMin: 0, goldMax: 0,
    idx: x * 100 + y, ...over,
  };
}

/* ---- recovery: the fix that helps every class ---- */

test('health and power come back out of combat', () => {
  const g = newGame('regen');
  arena(g);
  const p = g.state.player;
  p.hp = 1;
  p.power = 0;
  for (let t = 0; t < 40; t++) { g.turn = t; g.tickStatus(); }
  assert.ok(p.hp > 1, 'health never came back');
  assert.ok(p.power > 0, 'power never came back — a spent caster stayed spent for the whole run');
});

test('nothing comes back with something awake beside you', () => {
  const g = newGame('regen-fight');
  const floor = arena(g);
  const p = g.state.player;
  floor.monsters.push(beast(p.x + 1, p.y));
  p.hp = 5;
  p.power = 0;
  for (let t = 0; t < 20; t++) { g.turn = t; g.tickStatus(); }
  assert.equal(p.hp, 5, 'health regenerated mid-fight');
  assert.equal(p.power, 0, 'power regenerated mid-fight');
});

test('a sleeping monster is not a fight', () => {
  const g = newGame('regen-asleep');
  const floor = arena(g);
  const p = g.state.player;
  floor.monsters.push(beast(p.x + 2, p.y, { aggro: false }));
  p.hp = 5;
  g.turn = 1;
  g.tickStatus();
  assert.ok(p.hp > 5, 'a monster that has not noticed you blocked recovery');
});

test('resting waits until you are whole', () => {
  const g = newGame('rest');
  arena(g);
  const p = g.state.player;
  p.hp = 1;
  p.power = 0;
  g.rest();
  assert.equal(p.hp, p.maxhp, 'rest did not finish the job');
  assert.equal(p.power, g.derived().maxpower);
});

test('you cannot rest with company', () => {
  const g = newGame('rest-denied');
  const floor = arena(g);
  const p = g.state.player;
  floor.monsters.push(beast(p.x + 1, p.y));
  p.hp = 1;
  g.logs.length = 0;
  assert.equal(g.rest(), false);
  assert.equal(p.hp, 1);
  assert.match(g.logs.join(' '), /awake this close/i);
});

test('a flight of stairs is worth a breath', () => {
  const g = newGame('stairs-breath');
  g.loadFloor(0);
  const p = g.state.player;
  p.hp = 1;
  p.power = 0;
  g.loadFloor(1);
  assert.ok(p.hp > 1, 'arriving on a new floor at one hit point is an automatic death');
  assert.ok(p.power > 0);
});

/* ---- the difficulty cliff ---- */

test('the monster pool opens smoothly, never a whole tier band at once', () => {
  /* This is the diagnosis stated directly. resolveMonsterPool used to open by
   * a FRACTION of the tier-sorted list, which ignores gaps in a bestiary — so
   * the Temple's leap from tier 3 to tier 6, and the Upper Reaches' from 5 to
   * 11, each arrived on a single floor and built a wall there. */
  const g = newGame('band');
  for (const d of DUNGEONS) {
    let prevCeiling = -Infinity;
    for (let f = 0; f < d.floors; f++) {
      const pool = g.resolveMonsterPool(d, f);
      const ceiling = Math.max(...pool.map((m) => m.tier));
      assert.ok(ceiling - prevCeiling <= 3 || prevCeiling === -Infinity,
        `${d.id}: floor ${f + 1} raises the ceiling from tier ${prevCeiling} to ${ceiling} in one step`);
      prevCeiling = ceiling;
    }
  }
});

test('the descent is a ramp, not a staircase of walls', () => {
  /* Measured across seeds, because one seed is a noisy sample: an unlucky roll
   * can always stack a floor. What matters is the typical case. Before the
   * tier-band pool, the Temple's median step from floor 2 to floor 3 was over
   * 3x, and it was 3x for every player, because there was no run seed. */
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const d of DUNGEONS) {
    const steps = Array.from({ length: d.floors - 1 }, () => []);
    for (let s = 0; s < 25; s++) {
      const hp = [];
      for (let f = 0; f < d.floors; f++) {
        const { floor } = floorOf(d.id, f, `ramp-${d.id}-${s}`);
        hp.push(floor.monsters.filter((m) => !m.boss).reduce((a, m) => a + m.hp, 0));
      }
      for (let f = 1; f < d.floors; f++) steps[f - 1].push(hp[f] / Math.max(1, hp[f - 1]));
    }
    steps.forEach((sample, i) => {
      const med = median(sample);
      assert.ok(med < 2.6, `${d.id}: floor ${i + 2} is typically ${med.toFixed(1)}x floor ${i + 1} — that is a wall, not a ramp`);
    });
  }
});

test('the shallow end of the pool is drawn more often than the deep end', () => {
  const { floor } = floorOf('temple', 3, 'weights');
  const tiers = floor.monsters.filter((m) => !m.boss).map((m) => m.t.tier);
  const avg = tiers.reduce((a, b) => a + b, 0) / tiers.length;
  const mid = (Math.min(...tiers) + Math.max(...tiers)) / 2;
  assert.ok(avg < mid, `average tier ${avg.toFixed(1)} is not below the pool's midpoint ${mid} — the draw is still flat`);
});

/* ---- loot ---- */

test('the game contains more than one healing item', () => {
  /* It contained exactly one: potion-heal was in no pool at all, surviving
   * only as a fallback that could never fire. */
  let heals = 0, powers = 0;
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      const { floor } = floorOf(d.id, f, `heals-${d.id}-${f}`);
      for (const it of floor.items) {
        const fx = it.i.effects || {};
        if (fx.heal) heals++;
        if (fx.power) powers++;
      }
    }
  }
  assert.ok(heals >= 8, `only ${heals} healing items in the whole game`);
  assert.ok(powers >= 4, `only ${powers} power items in the whole game`);
});

test('every floor carries something to drink', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < 12; s++) {
        const { floor } = floorOf(d.id, f, `drink-${d.id}-${f}-${s}`);
        const consumables = floor.items.filter((it) => it.i.slot === 'consumable');
        assert.ok(consumables.length >= 1, `${d.id} floor ${f} seed ${s}: nothing to drink anywhere on the floor`);
      }
    }
  }
});

test('potions are never enchanted', () => {
  /* The guard tested kind, but a potion's kind is 'potion' and only its slot
   * is 'consumable' — so the game produced "+2 Potion of Healing" with an
   * armour bonus on it. */
  const g = newGame('ench');
  g.state.player.dungeonId = 'temple';
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 300; s++) {
      const it = g.pickItem(f, new RNG(`e-${f}-${s}`));
      if (!it || it.slot !== 'consumable') continue;
      assert.doesNotMatch(it.name, /^\+\d/, `enchanted consumable: ${it.name}`);
      assert.equal((it.effects || {}).acBonus, undefined, `${it.name} carries an armour bonus`);
    }
  }
});

/* ---- the run seed ---- */

test('two characters do not walk the same dungeon', () => {
  /* Every character ever rolled played the identical twelve floors: the
   * generator fell back to hashSeed("temple:0") and nothing passed a run seed. */
  const a = floorOf('temple', 0, 'character-one').floor;
  const b = floorOf('temple', 0, 'character-two').floor;
  const sig = (f) => f.tiles.map((r) => r.join('')).join('');
  assert.notEqual(sig(a), sig(b), 'two different characters got the identical floor');
  assert.notDeepEqual(a.items.map((i) => i.i.name), b.items.map((i) => i.i.name));
});

test('the same character still gets the same dungeon', () => {
  const a = floorOf('temple', 0, 'same-character').floor;
  const b = floorOf('temple', 0, 'same-character').floor;
  assert.equal(
    a.tiles.map((r) => r.join('')).join(''),
    b.tiles.map((r) => r.join('')).join(''),
  );
});

/* ---- death ---- */

test('death returns you to the deepest floor you reached', () => {
  const g = newGame('deep');
  const p = g.state.player;
  g.loadFloor(0);
  g.loadFloor(1);
  g.loadFloor(2);
  assert.equal(p.deepest.temple, 2);
  p.gold = 100;
  g.die(beast(1, 1));
  g.returnToCamp(true);
  assert.equal(p.floorIdx, 2, 'sent back to the entrance to walk down through rooms already cleared');
  assert.ok(p.gold < 100, 'the death cost nothing');
});

test('a save is not written while dying', () => {
  /* The save fires on the keystroke that kills you, so a reload resumed you
   * alive at zero hit points, to be killed again by the next blow. */
  const g = newGame('dying-save');
  const p = g.state.player;
  g.loadFloor(0);
  p.hp = 0;
  const saved = JSON.parse(JSON.stringify(g.save()));
  const g2 = newGame('dying-save');
  g2.restore(saved);
  assert.ok(g2.state.player.hp > 0, 'resumed at zero hit points');
});

/* ---- the classes ---- */

test('no class is twice as fragile as another', () => {
  const hp = {};
  for (const id of Object.keys(CLASSES)) hp[id] = newGame('hp-' + id, id).state.player.maxhp;
  const spread = Math.max(...Object.values(hp)) / Math.min(...Object.values(hp));
  assert.ok(spread < 1.7, `health spread is ${spread.toFixed(1)}x: ${JSON.stringify(hp)}`);
});

test('the Thief crit comes from the ability, not from being called a thief', () => {
  const g = newGame('keen', 'thief');
  const withAbility = g.derived().crit;
  assert.ok(withAbility >= 0.15, `thief crit is ${withAbility}`);
  /* Strip the passive and the crit should fall back to the class floor. */
  const bare = { ...CLASSES.thief };
  g.allAbilities = () => [];
  assert.ok(g.derived().crit < withAbility, 'the passive grants nothing that lacking it would take away');
  void bare;
});

test('the Thief is actually paid more', () => {
  /* goldMul was declared on every class and read by nothing at all. */
  const t = newGame('gold-t', 'thief');
  const f = newGame('gold-f', 'fighter');
  assert.ok(t.goldMul() > f.goldMul(), 'the Thief has no economic identity');
  const before = t.state.player.gold;
  t.loadFloor(0);
  t.state.player.gold = before;
  const coin = { name: 'Pile of Gold', kind: 'special', slot: 'special', value: 100, effects: {} };
  t.pickupItem(coin);
  assert.ok(t.state.player.gold - before > 100, 'the Thief was paid face value');
});

test('finding secrets comes from the ability too', () => {
  const g = newGame('secrets', 'thief');
  assert.ok(g.passives().some((a) => a.findsSecrets), 'no passive claims to find secrets');
});

test('an existing character is credited when its class is shored up', () => {
  const g = newGame('credit', 'mage');
  const saved = JSON.parse(JSON.stringify(g.save()));
  savedPlayer(saved).maxhp = 12;    /* the old mage maximum */
  savedPlayer(saved).hp = 12;
  const g2 = newGame('credit', 'mage');
  g2.restore(saved);
  assert.ok(g2.state.player.maxhp > 12,
    'a migrated character keeps the old maximum forever while a fresh one gets the fix');
});

test('using an ability is not forgotten on reload', () => {
  /* The 1-9 key branch in main.js never called saveGame, so power spent and
   * cooldowns started by an ability vanished the next time you loaded. */
  const g = newGame('ability-save', 'mage');
  g.loadFloor(0);
  const p = g.state.player;
  /* The refused-draught law holds a working with nothing to work on, so
   * stand something in front of the mage — this test is about persistence,
   * not targeting. */
  g.currentFloor.monsters.push({
    t: { id: 'mark', name: 'Mark', glyph: 'm', color: 'red', hpMax: 30, ac: 10, toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 1 },
    x: p.x + 1, y: p.y, hp: 30, maxhp: 30, boss: false, aggro: false,
    toHit: 0, dmg: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
  });
  g.computeVisibility();
  const before = p.power;
  /* One that actually costs something: the Mage's first damaging ability is
   * now Witch-Spark, which is at will and hands power back rather than
   * taking any, so it cannot show whether spending is persisted. */
  const blast = g.allAbilities().find((a) => a.kind === 'damage' && (a.powerCost || 0) > 0);
  assert.ok(blast, 'the mage has no damaging ability that costs power at level 1');
  g.activateAbility(blast.id);
  assert.ok(p.power < before, 'casting cost nothing');
  const saved = JSON.parse(JSON.stringify(g.save()));
  assert.ok(savedPlayer(saved).power < before, 'the save does not reflect the cast');
});
