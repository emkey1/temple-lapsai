/* ENGINE: turn-based game core.
 * Owns game state, floor generation, vision, movement, combat, the turn loop,
 * leveling, abilities and item use. UI is injected via opts.ui (see main.js).
 */
import { RNG, hashSeed } from './rng.js';
import {
  CLASSES, getAbility, abilityMod, XP_FOR_LEVEL, classKillBonus,
  getMonster, monstersForFloor, getItemTemplate, ALL_ITEMS, abilitiesFor,
  scaleDice, randomTreasureValue, getDungeon,
} from './base.js';
import {
  T, W, H, isTravelable, isSlowGoing, isWall, isDoor, generateFloor,
} from './mapgen.js';
import { npcsForDungeonFloor } from './npc.js';
import { beatsAt, arcForDungeon, setFlag, getFlag } from './world.js';
import { evaluateDice, rngIntId, dist1, applyMagic, deepItem } from './dice.js';
import { WEARABLE_SLOTS } from './contract.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* Turns a monster keeps hunting after it last had the player in sight. Without
 * a limit, anything that ever woke up stays awake forever and holds the stairs. */
const AGGRO_MEMORY = 12;

/* How much a Potion of Titan's Grip actually adds while it lasts. The potion
 * set a countdown that nothing ever read. */
const STRENGTH_BUFF = 4;

/* ---------------- Character creation ---------------- */

export function rollStats() {
  const s = {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    let r = 0;
    for (let i = 0; i < 3; i++) r += 1 + Math.floor(Math.random() * 6);
    s[k] = r;
  }
  return s;
}

export function initialStats(clsId) {
  const s = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const adj = CLASSES[clsId] ? CLASSES[clsId].statAdj : {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    s[k] = Math.max(3, Math.min(18, s[k] + (adj[k] || 0)));
  }
  return s;
}

export function makePlayer(name, clsId, stats) {
  const c = CLASSES[clsId] || CLASSES.fighter;
  const rng = new RNG(hashSeed((name + ':' + clsId + ':' + JSON.stringify(stats)).toLowerCase()));
  const conMod = abilityMod(stats.con);
  const hpDie = Math.max(1, c.hpDie + conMod);
  const maxhp = c.hpBase + Math.max(1, hpDie);
  const initial = getItemTemplate(c.weapon ? c.weapon.toLowerCase().replace(/[^a-z-]/g, '') : 'dagger');
  return {
    name, cls: clsId, glyph: c.glyph, color: 'white',
    level: 1, xp: 0,
    stats,
    hp: maxhp, maxhp,
    power: 8, maxpower: 8,
    gold: rng.int(15, 30),
    x: 0, y: 0, floorIdx: 0, dungeonId: null,
    inventory: [],
    belt: [null, null, null, null],
    equipment: { weapon: null, body: null, shield: null, ring: null, amulet: null },
    cooldowns: {},
    buffs: {},
    buffLevels: {},   /* magnitudes, kept out of p.buffs, which is all countdowns */
    bossesSlain: {},
    explored: {},
    identified: [],
    counters: {},
    visitedDungeons: {},
    beatsSeen: {},
    npcsMet: {},
  };
}

/* ---------------- The Game ---------------- */

export class Game {
  constructor(opts) {
    this.opts = opts || {};
    this.registry = this.opts.registry || { items: [], monsters: [], dungeons: [] };
    this.ui = this.opts.ui || {};
    this.onSave = this.opts.onSave || (() => {});
    this.state = this.opts.state || null;
    this.floors = {};
    this.currentFloor = null;
    this.dying = false;

    if (!this.state) {
      this.newState();
    }
  }

  newState() {
    this.state = {
      version: 2,
      seed: (Math.random() + 1).toString(36).slice(2, 8),
      player: null,
      created: Date.now(),
      totalKills: 0,
      floors: {},
    };
  }

  /* ---- floor memory ----
   * A floor regenerates identically from its seed, so the save only has to
   * record what the player changed: what they killed, took, dropped, opened
   * and saw. Without this, every trip down the stairs restocked the level. */

  floorKey(dungeonId, floorIdx) {
    return dungeonId + ':' + floorIdx;
  }

  floorMemo(dungeonId, floorIdx, create = false) {
    if (!this.state.floors) this.state.floors = {};
    const key = this.floorKey(dungeonId, floorIdx);
    if (!this.state.floors[key] && create) {
      this.state.floors[key] = { killed: [], taken: [], doors: [], dropped: [], seen: null };
    }
    return this.state.floors[key] || null;
  }

  currentMemo() {
    const p = this.state.player;
    if (!p || !p.dungeonId) return null;
    return this.floorMemo(p.dungeonId, p.floorIdx, true);
  }

  rememberKill(m) {
    const memo = this.currentMemo();
    if (memo && Number.isInteger(m.idx) && !memo.killed.includes(m.idx)) memo.killed.push(m.idx);
  }

  rememberTake(entry) {
    const memo = this.currentMemo();
    if (memo && Number.isInteger(entry.idx) && !memo.taken.includes(entry.idx)) memo.taken.push(entry.idx);
  }

  rememberDoor(x, y) {
    const memo = this.currentMemo();
    const key = x + ',' + y;
    if (memo && !memo.doors.includes(key)) memo.doors.push(key);
  }

  rememberDrop(item, x, y) {
    const memo = this.currentMemo();
    if (memo) memo.dropped.push({ i: item, x, y });
  }

  forgetDrop(entry) {
    const memo = this.currentMemo();
    if (!memo || !memo.dropped.length) return;
    const at = memo.dropped.findIndex((d) => d.x === entry.x && d.y === entry.y && d.i && entry.i && d.i.uid === entry.i.uid);
    if (at >= 0) memo.dropped.splice(at, 1);
  }

  /* Explored tiles, one row per string. Cheap to store and trivial to read. */
  snapshotFloor() {
    const p = this.state.player;
    if (!p || !p.dungeonId || !this.currentFloor || !this.seen) return;
    const memo = this.currentMemo();
    if (!memo) return;
    memo.seen = this.seen.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
  }

  applyFloorMemo(floor, memo) {
    if (!memo) return;
    if (memo.killed.length) {
      const dead = new Set(memo.killed);
      floor.monsters = floor.monsters.filter((m) => !dead.has(m.idx));
    }
    if (memo.taken.length) {
      const gone = new Set(memo.taken);
      floor.items = floor.items.filter((it) => !gone.has(it.idx));
    }
    for (const key of memo.doors) {
      const [x, y] = key.split(',').map(Number);
      if (floor.tiles[y] && floor.tiles[y][x] !== undefined) floor.tiles[y][x] = T.DOOR_O;
    }
    for (const d of memo.dropped) floor.items.push({ i: d.i, x: d.x, y: d.y, auto: false });
  }

  restoreSeen(memo) {
    if (!memo || !Array.isArray(memo.seen)) return false;
    for (let y = 0; y < H && y < memo.seen.length; y++) {
      const row = memo.seen[y] || '';
      for (let x = 0; x < W; x++) this.seen[y][x] = row[x] === '1';
    }
    return true;
  }

  /* ---- registry lookups (base + expansions merged) ---- */
  monsterTemplate(id) {
    return getMonster(id) || this.registry.monsters.find((m) => m.id === id) || null;
  }
  itemTemplate(id) {
    return getItemTemplate(id) || this.registry.items.find((i) => i.id === id) || null;
  }
  dungeonById(id) {
    return getDungeon(id) || this.registry.dungeons.find((d) => d.id === id) || null;
  }

  baseDungeonIds() {
    return ['temple', 'upper', 'serpent'];
  }

  availableDungeons() {
    const p = this.state.player;
    const bossSlain = (id) => p && p.bossesSlain && p.bossesSlain[id];
    const order = [];
    const bases = this.baseDungeonIds();
    for (let i = 0; i < bases.length; i++) {
      order.push(this.dungeonById(bases[i]));
      if (!bossSlain(bases[i])) break;
    }
    for (const d of this.registry.dungeons) {
      const requires = d.requires || d.unlockAfter || bases[bases.length - 1];
      const met = Array.isArray(requires) ? requires.every((r) => bossSlain(r)) : bossSlain(requires);
      if (met && !order.some((o) => o && o.id === d.id)) order.push(d);
    }
    return order.filter(Boolean);
  }

  isDungeonCleared(id) {
    const d = this.dungeonById(id);
    return !!(d && this.state.player && this.state.player.bossesSlain && this.state.player.bossesSlain[id]);
  }

  derived() {
    const p = this.state.player;
    const c = CLASSES[p.cls] || CLASSES.fighter;
    const st = p.stats;
    const sbonus = {};
    let toHit = c.toHitBonus;
    let ac = 10 - c.acBonus;   /* descending AC: lower is harder to hit */
    let dmg = { dice: 1, sides: 4, bonus: c.dmgBonus };
    let crit = c.critBonus;
    let regen = 0;
    let resist = 0;          /* flat damage soaked, from wards */
    let undeadResist = 0;    /* extra, against the unhallowed */
    let luck = 0;            /* chance to shrug off a miss */
    let seeSecrets = false;
    let eqWeapon = null;
    const eq = p.equipment || {};
    for (const slot of Object.values(eq)) {
      if (!slot) continue;
      const fx = slot.effects || {};
      toHit += fx.toHit || 0;
      ac -= fx.acBonus || 0;
      regen += fx.regen || 0;
      if (fx.seeSecrets) seeSecrets = true;
      resist += fx.resist || 0;
      undeadResist += fx.undeadResist || 0;
      luck += fx.luck || 0;
      if (fx.statBonus) for (const k in fx.statBonus) sbonus[k] = (sbonus[k] || 0) + fx.statBonus[k];
      if (slot.slot === 'weapon' && fx.damage) eqWeapon = fx.damage;
      if (slot.kind === 'wand' && fx.damage) eqWeapon = fx.damage;
    }
    const eff = {};
    for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      eff[k] = Math.max(3, Math.min(18, (st[k] || 10) + (sbonus[k] || 0)));
    }
    /* Temporary might sits ON TOP of the 18 cap. Inside it, a potion drunk by
     * anyone strong enough to want one did exactly nothing. */
    if (p.buffs && p.buffs.str > 0) eff.str += STRENGTH_BUFF;
    toHit += abilityMod(eff.dex) + abilityMod(eff.str);
    /* Monsters used to scale on player level while the player scaled on loot
     * alone, so levelling up made the game harder. Grow with level too. */
    toHit += Math.floor((p.level - 1) / 2);
    if (p.buffs && p.buffs.might > 0) toHit += (p.buffLevels && p.buffLevels.might) || 2;
    ac -= abilityMod(eff.dex);
    dmg.bonus += abilityMod(eff.str);
    /* Keep the class bonus: rebuilding dmg from the weapon dropped the
     * Fighter's +1 the instant they picked up a sword. */
    if (eqWeapon) dmg = { dice: eqWeapon.dice, sides: eqWeapon.sides, bonus: (eqWeapon.bonus || 0) + abilityMod(eff.str) + c.dmgBonus };
    dmg.bonus += Math.floor((p.level - 1) / 3);
    if (p.cls === 'thief') crit = Math.max(crit, 0.15);
    let maxp = c.powerBase + this.equipmentPower();
    if (c.powerPerInt) maxp += abilityMod(eff.int);
    if (c.powerPerChr) maxp += abilityMod(eff.cha);
    if (p.level > 1) maxp += (p.level - 1) * 2;
    return {
      effValues: eff,
      toHit, ac, dmg, crit, regen,
      resist, undeadResist, luck,
      sanctuary: (p.buffs && p.buffs.sanctuary > 0) || false,
      seeSecrets: !!seeSecrets,
      maxpower: Math.max(1, maxp),
      sight: 9,
    };
  }

  effectiveStats() {
    const p = this.state.player;
    if (!p) return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    return this.derived().effValues;
  }

  baseMaxPower() {
    return this.derived().maxpower;
  }

  computeMaxPower() {
    return this.derived().maxpower;
  }

  equipmentPower() {
    let v = 0;
    const eq = (this.state.player.equipment || {});
    for (const slot of Object.values(eq)) if (slot && slot.effects && slot.effects.power) v += slot.effects.power;
    return v;
  }

  /* ---- founding ---- */
  foundAdventurer(name, clsId, stats) {
    this.state.player = makePlayer(name, clsId, stats);
    const c = CLASSES[clsId] || CLASSES.fighter;
    const weapon = this.resolveWeapon(c.weapon);
    if (weapon) this.state.player.equipment.weapon = deepItem(weapon);
    this.state.player.maxpower = this.computeMaxPower();
    this.state.player.power = this.state.player.maxpower;
    this.state.player.maxhp = this.maxHp();
    this.state.player.hp = this.state.player.maxhp;
    this.enterDungeon('temple');
    return this.state.player;
  }

  maxHp() {
    const p = this.state.player;
    const c = CLASSES[p.cls] || CLASSES.fighter;
    return p.maxhp || (c.hpBase + Math.max(1, c.hpDie + abilityMod(p.stats.con)));
  }

  /* ---- floors ---- */
  enterDungeon(id) {
    const d = this.dungeonById(id);
    if (!d) { this.log('That path is not written yet.'); return; }
    this.state.player.dungeonId = id;
    this.state.player.floorIdx = 0;
    if (!this.state.player.visitedDungeons[id]) {
      this.state.player.visitedDungeons[id] = true;
      const arc = arcForDungeon(id);
      if (this.ui.showArrival) this.ui.showArrival(d);
      else this.log('— ' + d.name + ' —');
    } else {
      if (this.ui.setLocation) this.ui.setLocation(d.name + ' · ' + (this.state.player.floorIdx + 1) + '/' + d.floors);
    }
    this.loadFloor(0);
  }

  loadFloor(floorIdx) {
    const p = this.state.player;
    const d = this.dungeonById(p.dungeonId);
    if (!d) return;
    this.snapshotFloor();   /* remember the floor we are stepping off */
    this.wading = false;
    this.cleavedThisTurn = false;
    p.floorIdx = floorIdx;
    const isLast = floorIdx >= d.floors - 1;
    const boss = isLast ? (this.monsterTemplate(d.bossId) || null) : null;
    /* No boss means bossesSlain is never set, which means the dungeon can never
     * be cleared and the next one never unlocks. Say so rather than shrug. */
    if (isLast && !boss) console.warn(`[lapsai] dungeon "${d.id}" has no boss for bossId "${d.bossId}" — it cannot be cleared`);
    const pool = this.resolveMonsterPool(d, floorIdx);
    const npcs = npcsForDungeonFloor(d.id, floorIdx);
    const floor = generateFloor({
      dungeon: d, floorIdx, state: this.state,
      monsterPool: pool, boss, npcs,
      pickItem: (fi, rng) => this.pickItem(fi, rng),
      makeTreasure: (fi, rng) => this.makeTreasure(fi, rng),
    });
    if (boss && p.bossesSlain[d.id] && floor.monsters) {
      floor.monsters = floor.monsters.filter((m) => m.boss !== true);
    }
    const memo = this.floorMemo(d.id, floorIdx);
    this.applyFloorMemo(floor, memo);
    this.currentFloor = floor;
    p.x = floor.up.x;
    p.y = floor.up.y;
    p.pending = undefined;
    this.seen = Array.from({ length: H }, () => Array(W).fill(false));
    this.vis = Array.from({ length: H }, () => Array(W).fill(false));
    this.restoreSeen(memo);   /* the map you drew stays drawn */
    this.secretsRevealed = false;
    this.turn = 0;
    this.fireBeats('enter', floorIdx);
    if (this.ui.setLocation) this.ui.setLocation(d.name + ' · ' + (floorIdx + 1) + '/' + d.floors);
    if (this.ui.showFloor) this.ui.showFloor(d, floorIdx, isLast);
    this.log('You stand at the ' + (floorIdx === 0 ? 'entrance' : 'stairs') + ' of ' + d.name + '.');
    this.computeVisibility();
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
  }

  resolveMonsterPool(d, floorIdx) {
    let templates = (d.monsterWeights || []).map((id) => {
      const t = this.monsterTemplate(id);
      /* A silently dropped id used to cost a dungeon its whole bestiary. */
      if (!t) console.warn(`[lapsai] dungeon "${d.id}" lists unknown monster id "${id}"`);
      return t;
    }).filter(Boolean);
    if (d.bossId) templates = templates.filter((m) => m.id !== d.bossId);
    if (!templates.length) {
      templates = monstersForFloor(floorIdx, d.threat || 0).map((x) => x.m);
    }
    const sorted = [...templates].sort((a, b) => a.tier - b.tier);
    const share = Math.min(1, 0.3 + floorIdx * 0.25);
    const cut = Math.max(1, Math.ceil(sorted.length * share));
    return cut >= sorted.length ? sorted : sorted.slice(0, cut);
  }

  pickItem(floorIdx, rng) {
    const tierChance = Math.min(0.65, 0.08 + floorIdx * 0.10 + rng.next() * 0.2);
    const pools = [
      { arr: ['dagger', 'short-sword', 'mace', 'staff', 'hand-axe'], max: 2 },
      { arr: ['broadsword', 'war-hammer', 'padded-armor', 'leather-armor', 'small-shield', 'ring-protection'], max: 3 },
      { arr: ['battle-axe', 'studded-armor', 'chainmail', 'large-shield', 'ring-strength', 'amulet-ward', 'potion-major-heal', 'scroll-reveal', 'scroll-flame', 'wand-of-fire'], max: 100 },
      { arr: ['two-handed-sword', 'scale-armor', 'plate', 'tower-shield', 'ring-arcana', 'amulet-seeing', 'amulet-luck', 'scroll-remove-curse', 'scroll-sanctuary', 'wand-of-healing', 'wand-of-frost'], max: 100 },
    ];
    /* floorIdx maxes out at 3, so dividing by 1.5 capped this at pool 2 and the
     * deepest table — Deep Ward, True Seeing, the Lucky Coin, Sanctuary — could
     * never drop at all. Dungeon threat carries the deeper dungeons further. */
    const threat = Math.max(0, (this.dungeonById(this.state.player.dungeonId) || {}).threat || 0);
    const tier = Math.min(pools.length - 1, floorIdx + Math.floor(threat / 3));
    const cands = pools.slice(0, tier + 1).flatMap((p) => p.arr);
    /* Generated items are drawn from the same table as hand-authored ones,
     * banded by their own tier so a tier-9 blade cannot turn up on floor one.
     * Without this, everything the Library made was unreachable. */
    const depth = (tier + 1) * 2;
    for (const it of this.registry.items || []) {
      if (!it || !it.id) continue;
      if ((it.tier ?? 1) <= depth) cands.push(it.id);
    }
    let tpl = this.itemTemplate(rng.pick(cands) || 'potion-heal');
    if (!tpl) tpl = this.itemTemplate('potion-heal');
    const it = deepItem(tpl);
    const topTier = tpl.tier >= 3;
    const magicChance = tierChance + (topTier ? 0.12 : 0);
    if (rng.chance(magicChance) && it.kind !== 'consumable' && it.kind !== 'special') {
      const mag = 1 + Math.floor(rng.next() * Math.min(3, 1 + floorIdx));
      applyMagic(it, mag);
      if (rng.chance(0.15)) it.cursed = true;
    }
    return it;
  }

  makeTreasure(floorIdx, rng) {
    const tpl = rng.chance(0.5)
      ? this.baseTreasureOf('gold-pile', randomTreasureValue(rng, floorIdx, 0))
      : (rng.chance(0.35) ? this.baseTreasureOf('gem') : (rng.chance(0.12) ? this.baseTreasureOf('statuette') : this.baseTreasureOf('crown')));
    const it = tpl;
    return it;
  }

  /* ---- vision ---- */
  computeVisibility() {
    const p = this.state.player;
    const floor = this.currentFloor;
    if (!floor) return;
    const sight = this.derived().sight;
    this.vis = Array.from({ length: H }, () => Array(W).fill(false));
    const side = 17;
    const sx = Math.max(0, p.x - side), ex = Math.min(W - 1, p.x + side);
    const sy = Math.max(0, p.y - side), ey = Math.min(H - 1, p.y + side);
    for (let y = sy; y <= ey; y++) {
      for (let x = sx; x <= ex; x++) {
        this.vis[y][x] = this.los(p.x, p.y, x, y, sight);
        if (this.vis[y][x]) this.seen[y][x] = true;
      }
    }
    if (this.monstersBurning !== false) {
      for (const m of (floor.monsters || [])) if (m && m.revealed) { this.vis[m.y][m.x] = true; this.seen[m.y][m.x] = true; }
    }
  }

  los(ax, ay, bx, by, radius) {
    if (Math.abs(ax - bx) + Math.abs(ay - by) > radius + 6) return false;
    const dx = bx - ax, dy = by - ay;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) return true;
    for (let i = 1; i < steps; i++) {
      const tx = Math.round(ax + dx * i / steps);
      const ty = Math.round(ay + dy * i / steps);
      if (this.inBounds(tx, ty)) {
        const tile = this.currentFloor.tiles[ty][tx];
        if (isWall(tile) || tile === T.SECRET) return false;
      }
    }
    return true;
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  revealSecrets() {
    if (this.secretsRevealed) return;
    const floor = this.currentFloor;
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (floor.tiles[y][x] === T.SECRET) { floor.tiles[y][x] = T.DOOR_O; this.rememberDoor(x, y); n++; }
      }
    }
    if (n) this.log('You note ' + n + ' hidden door' + (n === 1 ? '' : 's') + '.');
    this.secretsRevealed = true;
  }

  /* ---- input ---- */
  handleKey(keyName, uiFlags = {}) {
    const p = this.state.player;
    if (!p || this.dying) return false;
    if (uiFlags.ability) {
      this.activateAbility(uiFlags.ability);
      return;
    }
    if (uiFlags.belt !== undefined) {
      this.useBeltItem(uiFlags.belt);
      return;
    }
    let turn = false;
    const k = String(keyName || '').toLowerCase();
    const dx = { 'arrowleft': -1, 'a': -1, 'arrowright': 1, 'd': 1 }[k] || 0;
    const dy = { 'arrowup': -1, 'w': -1, 'arrowdown': 1, 's': 1 }[k] || 0;
    if (dx !== 0 || dy !== 0) {
      turn = this.tryMove(dx, dy);
    } else if (k === 'g') {
      const got = this.tryPickup(p.x, p.y, true);
      /* Nothing to take is not nothing to learn: say what is here instead, so
       * the key teaches itself the first time someone presses it. */
      if (got) this.uiLog('Looted.');
      else this.lookAround();
    } else if (k === ' ' || k === 'x') {
      this.endPlayerTurn();
    } else {
      return false;
    }
    if (turn && !this.dying) this.endPlayerTurn();
    return turn;
  }

  tryMove(dx, dy) {
    const p = this.state.player;
    const floor = this.currentFloor;
    const nx = p.x + dx, ny = p.y + dy;
    if (!this.inBounds(nx, ny)) { this.log('The dark walls give no ground.'); return false; }
    const tile = floor.tiles[ny][nx];

    const mo = floor.monsters.find((m) => m.x === nx && m.y === ny);
    if (mo) {
      this.attackMonster(mo);
      return true;
    }
    const npc = (floor.npcs || []).find((n) => n.x === nx && n.y === ny);
    if (npc) {
      if (this.ui.openDialogue) this.ui.openDialogue(npc);
      return false;
    }
    if (tile === T.DOOR_C) {
      floor.tiles[ny][nx] = T.DOOR_O;
      this.rememberDoor(nx, ny);
      for (const m of floor.monsters) if (dist1(m, { x: nx, y: ny }) <= 10 && !m.boss) { m.aggro = true; }
      this.log('A heavy door groans open.');
      return true;
    }
    if (!isTravelable(tile)) {
      /* Searching happens where you push, not floor-wide: bumping a wall gives
       * one roll against the tile in front of you. */
      if (tile === T.SECRET && this.searchSecretAt(nx, ny)) return true;
      this.log(tile === T.WALL || tile === T.SECRET ? 'The way is blocked.' : 'You cannot pass here.');
      return false;
    }
    p.x = nx; p.y = ny;
    if (isSlowGoing(tile)) this.wadeInto(nx, ny);
    this.stepOn(nx, ny);
    return true;
  }

  /* Water is crossable, but you flounder: the turn costs double and the noise
   * carries. Making it impassable was severing whole sewer floors. */
  wadeInto(x, y) {
    this.log('You wade into black water — slow going, and loud.');
    this.wading = true;
    let roused = 0;
    for (const m of (this.currentFloor.monsters || [])) {
      if (!m.aggro && dist1(m, { x, y }) <= 6) { m.aggro = true; m.lastSeen = this.turn; roused++; }
    }
    if (roused) this.log('Something in the dark hears the splashing.');
  }

  /* One roll against one tile. Thieves are better at it; True Seeing skips it. */
  searchSecretAt(x, y) {
    const p = this.state.player;
    const floor = this.currentFloor;
    if (!p || !floor || floor.tiles[y][x] !== T.SECRET) return false;
    if (this.derived().seeSecrets) { this.revealSecretAt(x, y); return true; }
    const odds = Math.min(0.85, (p.cls === 'thief' ? 0.35 : 0.12) + p.level * 0.03);
    if (!this.rngOfTurn().chance(odds)) {
      this.log('You run your hands over the stone and find nothing — yet.');
      return true;   /* the search itself costs the turn */
    }
    this.revealSecretAt(x, y);
    return true;
  }

  revealSecretAt(x, y) {
    const floor = this.currentFloor;
    if (!floor || floor.tiles[y][x] !== T.SECRET) return;
    floor.tiles[y][x] = T.DOOR_O;
    this.rememberDoor(x, y);
    this.log('A seam in the stone gives — a hidden door!');
  }

  canFindSecretAt(x, y) {
    const floor = this.currentFloor;
    if (!floor || floor.tiles[y] === undefined || floor.tiles[y][x] !== T.SECRET) return false;
    return this.derived().seeSecrets;
  }

  stepOn(x, y) {
    const floor = this.currentFloor;
    const tile = floor.tiles[y][x];
    const p = this.state.player;
    if (tile === T.DOWN) {
      /* Only something at your heels stops you — anything further off can be
       * outrun, and anything walled off must not hold the stairs forever. */
      const atYourHeels = (floor.monsters || []).some((m) => m.hp > 0 && m.aggro && dist1(m, p) <= 2);
      if (atYourHeels) { this.log('Something at your heels bars the descent.'); return; }
      this.log('You descend.');
      if (this.ui.prepareTransition) this.ui.prepareTransition();
      this.loadFloor(p.floorIdx + 1);
      return;
    }
    if (tile === T.UP) {
      if (p.floorIdx === 0) {
        this.log('You climb back to the sunlit world above.');
        if (this.ui.showCamp) this.ui.showCamp(this);
        return;
      }
      this.log('You ascend.');
      this.loadFloor(p.floorIdx - 1);
      return;
    }
    if (tile === T.ALTAR) { this.useAltar(x, y); return; }
    const here = (floor.items || []).filter((it) => it.x === x && it.y === y);
    for (const it of here) {
      if (it.auto) {
        this.pickupItem(it.i);
        this.rememberTake(it);
        this.forgetDrop(it);
        floor.items = floor.items.filter((f) => f !== it);
      }
    }
    this.reportUnderfoot();
  }

  /* ---- looking around ----
   * The controls only existed in the README. These three report what is here
   * and name the key for it, at the moment the player needs to know. */

  itemsUnderfoot() {
    const p = this.state.player;
    return ((this.currentFloor && this.currentFloor.items) || []).filter((it) => it.x === p.x && it.y === p.y);
  }

  reportUnderfoot() {
    const here = this.itemsUnderfoot();
    if (!here.length) return false;
    const names = here.map((it) => (it.i && it.i.name) || 'something').join(', ');
    this.log('Underfoot: ' + names + '. Press G to take ' + (here.length > 1 ? 'them' : 'it') + '.');
    return true;
  }

  lookAround() {
    const floor = this.currentFloor;
    const p = this.state.player;
    if (!floor) return;
    if (this.reportUnderfoot()) return;

    const GROUND = {
      [T.UP]: 'You stand on the stair up. Step onto it again to climb.',
      [T.DOWN]: 'You stand on the stair down. Step onto it again to descend.',
      [T.DOOR_O]: 'You stand in an open doorway.',
      [T.DEN]: 'Worn flagstones, scored by something heavy.',
      [T.ALTAR]: 'A cold altar stands here.',
      [T.WATER]: 'Black water laps at your boots.',
    };
    this.log(GROUND[floor.tiles[p.y][p.x]] || 'Bare stone underfoot — nothing to take here.');

    const compass = (it) => {
      const dx = it.x - p.x, dy = it.y - p.y;
      const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
      const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
      return ns + ew || 'here';
    };
    const near = ((floor.items) || [])
      .filter((it) => dist1(it, p) > 0 && dist1(it, p) <= 3 && this.vis[it.y] && this.vis[it.y][it.x])
      .slice(0, 3)
      .map((it) => ((it.i && it.i.name) || 'something') + ' to the ' + compass(it));
    if (near.length) this.log('Within reach: ' + near.join('; ') + '.');

    const npc = ((floor.npcs) || []).find((n) => dist1(n, p) <= 1);
    if (npc) this.log((npc.tpl ? npc.tpl.name : 'Someone') + ' stands beside you — walk into them to speak.');
  }

  /* An altar gives once, to each character, on each floor: the old rites still
   * work, which is the point the world keeps making. */
  useAltar(x, y) {
    const p = this.state.player;
    const memo = this.currentMemo();
    const key = x + ',' + y;
    if (memo) {
      if (!memo.altars) memo.altars = [];
      if (memo.altars.includes(key)) {
        this.log('The altar is cold. It gave what it had.');
        return;
      }
      memo.altars.push(key);
    }
    const der = this.derived();
    const healed = Math.min(p.maxhp - p.hp, Math.max(1, Math.round(p.maxhp * 0.35)));
    const restored = Math.min(p.maxpower - p.power, Math.max(1, Math.round(der.maxpower * 0.5)));
    const cursedHere = [...p.inventory, ...Object.values(p.equipment || {})].some((it) => it && it.cursed);
    /* Do not spend a one-shot on someone who needs nothing from it. */
    if (healed <= 0 && restored <= 0 && !cursedHere) {
      this.log('An altar, still kept. You have nothing to ask it for yet.');
      if (memo && memo.altars) memo.altars = memo.altars.filter((k) => k !== key);
      return;
    }
    p.hp = Math.min(p.maxhp, p.hp + healed);
    p.power = Math.min(p.maxpower, p.power + restored);
    this.log('You set your hands on the altar. Someone kept this rite up long after the last of them stopped being paid.');
    const gains = [healed > 0 ? '+' + healed + ' HP' : '', restored > 0 ? '+' + restored + ' PWR' : ''].filter(Boolean);
    if (gains.length) this.log('The old words answer: ' + gains.join(', ') + '.');
    const cursed = [...p.inventory, ...Object.values(p.equipment || {})].filter((it) => it && it.cursed);
    if (cursed.length) {
      this.removeAllCurses();
      this.log('What was bound to you is not, any more.');
    }
  }

  tryPickup(x, y, manual) {
    const floor = this.currentFloor;
    const here = (floor.items || []).filter((it) => it.x === x && it.y === y);
    let got = 0;
    for (const it of here) {
      if (manual || it.auto) {
        if (this.pickupItem(it.i)) {
          got++;
          this.rememberTake(it);
          this.forgetDrop(it);
          floor.items = floor.items.filter((f) => f !== it);
        }
      }
    }
    return got > 0;
  }

  pickupItem(it) {
    const p = this.state.player;
    if (!it) return false;
    if (it.kind === 'special') {
      const v = it.value || 10;
      p.gold = (p.gold || 0) + v;
      this.uiLog('Picked up ' + v + ' gold' + (it.name && it.name !== 'Pile of Gold' ? ' (' + it.name + ')' : '') + '.');
      return true;
    }
    if (p.inventory.length >= 32) { this.log('Your pack is full.'); return false; }
    p.inventory.push(it);
    const idk = !it.identified ? ' unknown' : '';
    this.uiLog('You take: ' + it.name + idk + '.');
    return true;
  }

  /* ---- combat ---- */
  attackMonster(m) {
    this.breakSanctuary();
    const der = this.derived();
    const r = this.rngOfTurn();
    let raw = r.d(20);
    const dc = Math.max(1, 20 - m.t.ac);
    let hit = raw === 20 || raw + der.toHit >= dc;

    /* The Lucky Coin was carrying a number nothing read. It buys one second
     * look at a blow that missed. */
    if (!hit && der.luck > 0 && r.chance(Math.min(0.6, der.luck * 0.15))) {
      raw = r.d(20);
      hit = raw === 20 || raw + der.toHit >= dc;
      if (hit) this.log('Someone else’s fortune turns the blade — it lands after all.');
    }

    if (!hit) {
      this.log('Your blow misses the ' + m.t.name + '.');
      m.aggro = true;
      return;
    }

    /* A natural 20 always crits; the Thief's Sharp & Keen is a standing chance
     * on top. der.crit was computed, displayed on the stat sheet, and never
     * once consulted in combat. */
    const isCrit = raw === 20 || r.chance(der.crit || 0);
    let dmg = this.rollDamage(der.dmg, m.t);
    if (isCrit) dmg += this.rollDamage(der.dmg, m.t);
    this.log('You strike the ' + m.t.name + ' for ' + dmg + ' hit points.');
    this.applyDamageToMonster(m, dmg, isCrit, der);
  }

  rngOfTurn() {
    const p = this.state.player;
    const seed = this.state.seed + ':' + p.dungeonId + ':' + p.floorIdx + ':' + (this.turn || 0);
    if (!this._turnRng || this._turnRngSeed !== seed) {
      this._turnRng = new RNG(hashSeed(seed));
      this._turnRngSeed = seed;
    }
    return this._turnRng;
  }

  rollDamage(d, t) {
    const r = this.rngOfTurn();
    let s = 0;
    const dice = Math.max(1, d.dice || 1);
    for (let i = 0; i < dice; i++) s += r.d(Math.max(2, d.sides || 6));
    /* A blow that lands takes something off. Without the floor a negative
     * bonus — the Mage's -1, a cursed weapon — could heal what it hit. */
    return Math.max(1, s + (d.bonus || 0));
  }

  applyDamageToMonster(m, dmg, isCrit, der) {
    m.hp -= dmg;
    if (isCrit) this.log('A grievous blow!');
    if (m.hp <= 0) {
      this.killMonster(m);
    } else {
      m.aggro = true;
    }
  }

  killMonster(m) {
    const p = this.state.player;
    const floor = this.currentFloor;
    this.state.totalKills = (this.state.totalKills || 0) + 1;
    const cleaves = this.hasPassive('cleave') && !this.cleavedThisTurn;
    if (m.boss) this.onBossSlain(m);
    const xp = Math.round((m.xp || 10) * classKillBonus(p.cls, 1));
    this.log('The ' + m.t.name + ' is slain!');
    this.gainXP(xp);
    const goldMin = m.goldMin || 0, goldMax = m.goldMax || 0;
    if (goldMax > 0) {
      const g = this.rngOfTurn().int(goldMin, goldMax);
      p.gold += g;
      this.log('You strip ' + g + ' gold from the corpse.');
    }
    this.rememberKill(m);
    floor.monsters = floor.monsters.filter((x) => x !== m);

    /* Cleave, the Fighter's level-1 passive: 'slaying a foe grants one bonus
     * attack this turn'. It was set to false in three places and never once
     * set to true. The blade carries into another adjacent foe at once — a
     * bonus ATTACK, not a bonus turn that could be spent walking away. */
    if (cleaves) {
      const next = (floor.monsters || []).find((o) => o.hp > 0 && dist1(o, p) <= 1);
      if (next) {
        this.cleavedThisTurn = true;   /* set before the swing: no chains */
        this.log('Your blade carries.');
        this.attackMonster(next);
      }
    }
  }

  onBossSlain(m) {
    const p = this.state.player;
    const d = this.dungeonById(p.dungeonId);
    this.uiLog('The great ' + m.t.name + ' crashes down like a struck bell.');
    p.bossesSlain[p.dungeonId] = true;
    p.explored[p.dungeonId] = true;
    this.fireBeats('boss', p.floorIdx);
    /* 'finish' was documented, written for, and never fired by anything. */
    this.fireBeats('finish', p.floorIdx);
    const next = this.baseDungeonIds();
    const idx = next.indexOf(p.dungeonId);
    if (idx >= 0 && idx < next.length - 1 && this.ui.unlock) this.ui.unlock(this.dungeonById(next[idx + 1]));
    this.maybeExpand();
  }

  maybeExpand() {
    const bases = this.baseDungeonIds();
    const all = bases.every((id) => this.isDungeonCleared(id));
    if (!all) return;
    /* The end of the founding chronicle. The victory card was written, styled
     * and wired to a button, and nothing ever showed it. */
    const p = this.state.player;
    if (!p.counters) p.counters = {};
    if (!p.counters.finished) {
      p.counters.finished = 1;
      if (this.ui.showVictory) {
        this.ui.showVictory({
          name: p.name,
          cls: p.cls,
          level: p.level,
          gold: p.gold,
          kills: this.state.totalKills,
        });
      }
    }
    if (this.opts.onAllBaseCleared) this.opts.onAllBaseCleared();
  }

  gainXP(xp) {
    const p = this.state.player;
    p.xp += xp;
    while (p.xp >= XP_FOR_LEVEL(p.level)) {
      p.xp -= XP_FOR_LEVEL(p.level);
      this.levelUp();
    }
  }

  levelUp() {
    const p = this.state.player;
    p.level++;
    const c = CLASSES[p.cls] || CLASSES.fighter;
    const hpGain = this.rngOfTurn().d(Math.max(2, c.hpDie)) + Math.max(0, abilityMod(p.stats.con));
    p.maxhp += Math.max(1, hpGain);
    p.hp = Math.min(p.maxhp, p.hp + Math.max(1, hpGain));
    p.maxpower = this.computeMaxPower();
    p.power = Math.min(p.maxpower, p.power + this.computeMaxPower());
    this.uiLog('You grow wise and strong — ' + CLASSES[p.cls].name + ' level ' + p.level + '!');
    /* A condition beat is pinned to a floor, but level-ups happen wherever they
     * happen — an exact match meant the beat only fired if you happened to
     * level on that one floor. Fire everything at or above your current depth;
     * beatsSeen keys off the beat's own floor, so each still fires once. */
    for (let f = 0; f <= p.floorIdx; f++) this.fireBeats('condition', f);
    if (this.ui.refreshStats) this.ui.refreshStats(this);
  }

  /* ---- turn loop ---- */
  endPlayerTurn() {
    const p = this.state.player;
    if (!p || this.dying) return;
    this.tickStatus();
    if (this.dying) return;
    this.resolveMonsters();
    if (this.dying) return;
    /* Wading costs the turn twice over: everything else gets a second move. */
    if (this.wading) {
      this.wading = false;
      this.turn++;
      this.resolveMonsters();
      if (this.dying) return;
    }
    this.cleavedThisTurn = false;
    this.computeVisibility();
    this.turn++;
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
    if (this.ui.refreshStats) this.ui.refreshStats(this);
  }

  tickStatus() {
    const p = this.state.player;
    const der = this.derived();
    if (der.regen && this.turn % 2 === 1) {
      p.hp = Math.min(p.maxhp, p.hp + der.regen);
    }
    for (const k in p.cooldowns) if (p.cooldowns[k] > 0) p.cooldowns[k]--;
    /* Every key in p.buffs is a countdown in turns. Anything that is a
     * magnitude rather than a duration belongs in p.buffLevels, or it decays. */
    for (const k in p.buffs) if (p.buffs[k] > 0) p.buffs[k]--;
    if (p.buffs.turn !== undefined && p.buffs.turn <= 0) this.buffsTurnRefresh();
    if (p.buffs.sanctuary !== undefined && p.buffs.sanctuary <= 0) {
      delete p.buffs.sanctuary;
      this.log('The dark remembers your name again.');
    }
    if (p.buffs.str !== undefined && p.buffs.str <= 0) {
      delete p.buffs.str;
      this.log('The borrowed strength drains out of your arm.');
    }
    if (p.buffs.might !== undefined && p.buffs.might <= 0) {
      delete p.buffs.might;
      if (p.buffLevels) delete p.buffLevels.might;
      this.log('The edge goes off your swing.');
    }
  }

  buffsTurnRefresh() {
    const p = this.state.player;
    delete p.buffs.turn;
    for (const m of (this.currentFloor && this.currentFloor.monsters || [])) if (m.fleeing) { m.fleeing = false; }
  }

  /* One BFS out from the player per turn. Every monster then walks downhill on
   * it, which routes them around corners instead of stalling against a wall. */
  playerDistanceField() {
    const floor = this.currentFloor;
    const p = this.state.player;
    const dist = Array.from({ length: H }, () => Array(W).fill(-1));
    if (!floor) return dist;
    dist[p.y][p.x] = 0;
    const queue = [[p.x, p.y]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      const d = dist[y][x] + 1;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny) || dist[ny][nx] !== -1) continue;
        const t = floor.tiles[ny][nx];
        /* Monsters cross open ground and open doors; closed and secret doors
         * stop them, same as the old step-by-step chase intended. */
        if (!isTravelable(t) || t === T.SECRET) continue;
        dist[ny][nx] = d;
        queue.push([nx, ny]);
      }
    }
    return dist;
  }

  resolveMonsters() {
    const floor = this.currentFloor;
    const p = this.state.player;
    const der = this.derived();
    const alive = (floor.monsters || []).filter((m) => m.hp > 0);
    const rng = this.rngOfTurn();
    const field = this.playerDistanceField();
    const hidden = der.sanctuary;   /* Scroll of Sanctuary: the dark forgets you */
    for (const m of rng.shuffle(alive)) {
      if (m.hp <= 0) continue;

      /* Wand of Frost set `stunned` and nothing ever read it. */
      if (m.stunned > 0) {
        m.stunned--;
        continue;
      }

      const seen = !!(this.vis[m.y] && this.vis[m.y][m.x]);
      if (m.t.props && m.t.props.indexOf('flying') >= 0 && !seen) continue;
      if (seen && !hidden) {
        m.aggro = true;
        m.lastSeen = this.turn;
      } else if (m.aggro && dist1(m, p) > 1 && (this.turn - (m.lastSeen ?? -AGGRO_MEMORY)) > AGGRO_MEMORY) {
        m.aggro = false;
        m.revealed = false;
      }
      if (!m.aggro) continue;
      if (hidden) continue;   /* it knows something is there; it cannot fix on you */

      m.acted = true;
      /* Monster speed (1-4) was carried on every template and never used.
       * Speed buys GROUND, not blows: a fast thing closes sooner, but nothing
       * gets to strike twice in one turn. */
      const acts = Math.max(1, Math.min(4, m.t.speed || 1));
      for (let i = 0; i < acts; i++) {
        const before = p.hp;
        const wasAt = { x: m.x, y: m.y };
        this.monsterAct(m, seen, der, field);
        if (this.dying) return;
        if (m.hp <= 0) break;
        /* It attacked if it did not move — melee, ranged or a missed swing. */
        if (m.x === wasAt.x && m.y === wasAt.y) break;
        if (p.hp !== before) break;
      }
    }
  }

  monsterAct(m, seen, der, field) {
    const p = this.state.player;
    const dist = dist1(m, p);
    const range = m.t.aggroRange || 8;
    const isRanged = m.t.props && m.t.props.some((x) => x === 'ranged');
    if (!m.aggro) return;
    if (dist <= 1) {
      this.monsterMelee(m);
      return;
    }
    if (isRanged && seen && dist <= 12) {
      this.monsterRanged(m);
      return;
    }
    if (m.fleeing) {
      this.monsterFlee(m);
      return;
    }
    if (dist <= range || seen) {
      this.monsterChase(m, field);
    }
  }

  monsterMelee(m) {
    const p = this.state.player;
    const der = this.derived();
    const r = this.rngOfTurn();
    const dc = Math.max(1, 20 - der.ac);
    const raw = r.d(20);
    /* A natural 20 always lands, as it does for the player. Without it, enough
     * armour put the player permanently out of a monster's reach. */
    const hit = raw === 20 || raw + m.toHit >= dc;
    if (!hit) { this.log('The ' + m.t.name + ' lashes out — and misses!'); return; }
    const dmg = this.rollDamage({ dice: m.dmg.dice, sides: m.dmg.sides, bonus: m.dmg.bonus }, m.t);
    this.log('The ' + m.t.name + ' hits you for ' + dmg + ' hit points.');
    this.damagePlayer(dmg, m);
  }

  monsterRanged(m) {
    const y = this.state.player.y, x = this.state.player.x;
    const r = this.rngOfTurn();
    const der = this.derived();
    const dc = Math.max(1, 20 - der.ac);
    const raw = r.d(20);
    if (raw === 20 || raw + m.toHit >= dc) {
      const dmg = this.rollDamage({ dice: m.dmg.dice, sides: m.dmg.sides, bonus: m.dmg.bonus }, m.t);
      this.log('The ' + m.t.name + ' looses at you and hits for ' + dmg + '.');
      this.damagePlayer(dmg, m);
    } else {
      this.log('The ' + m.t.name + '\'s ranged attack whistles past.');
    }
  }

  monsterChase(m, field) {
    const floor = this.currentFloor;
    const p = this.state.player;
    const here = field[m.y][m.x];
    let best = null;
    let bestD = here >= 0 ? here : Infinity;
    for (const [dx, dy] of DIRS) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (nx === p.x && ny === p.y) continue;
      const d = field[ny][nx];
      if (d < 0 || d >= bestD) continue;
      if (floor.monsters.some((o) => o !== m && o.hp > 0 && o.x === nx && o.y === ny)) continue;
      bestD = d; best = [nx, ny];
    }
    if (best) { m.x = best[0]; m.y = best[1]; }
  }

  monsterFlee(m) {
    const floor = this.currentFloor;
    const p = this.state.player;
    const dx = Math.sign(m.x - p.x) || 0, dy = Math.sign(m.y - p.y) || 0;
    const moves = [[dx, 0], [0, dy]];
    for (const [mx, my] of moves) {
      const nx = m.x + mx, ny = m.y + my;
      if (!this.inBounds(nx, ny)) continue;
      const t = floor.tiles[ny][nx];
      if (!isTravelable(t)) continue;
      if (floor.monsters.some((o) => o !== m && o.x === nx && o.y === ny)) continue;
      m.x = nx; m.y = ny;
      if (dist1(m, p) > 10) { m.aggro = false; m.fleeing = false; m.revealed = false; }
      return;
    }
  }

  damagePlayer(dmg, m) {
    const p = this.state.player;
    const der = this.derived();
    let soak = der.resist || 0;
    const unhallowed = m && m.t && m.t.props && (m.t.props.includes('undead') || m.t.props.includes('cursed'));
    if (unhallowed) soak += der.undeadResist || 0;
    if (soak > 0 && dmg > 1) {
      const stopped = Math.min(soak, dmg - 1);
      if (stopped > 0) {
        dmg -= stopped;
        this.log('Your ward turns ' + stopped + ' of it aside.');
      }
    }
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.hp = 0;
      this.die(m);
    }
  }

  die(m) {
    const p = this.state.player;
    this.dying = true;
    /* Per-turn flags do not survive the end of a life. */
    this.wading = false;
    this.cleavedThisTurn = false;
    const killer = m ? ('by a ' + m.t.name) : 'by misadventure';
    this.log('You are slain ' + killer + '!');
    if (this.ui.showDeath) this.ui.showDeath('You were laid low ' + killer + ' in ' + (this.dungeonById(p.dungeonId) || {}).name + '.');
  }

  returnToCamp(resurrect = false) {
    const p = this.state.player;
    this.dying = false;
    if (resurrect) {
      const paid = Math.floor((p.gold || 0) / 2);
      p.gold = (p.gold || 0) - paid;
      this.log('The temple scribes haul you from the threshold for ' + paid + ' gold.');
    } else {
      p.gold = (p.gold || 0) - Math.floor((p.gold || 0) / 2);
    }
    p.hp = p.maxhp;
    p.power = p.maxpower;
    this.enterDungeon(p.dungeonId);
    if (this.ui.render) this.ui.render(this);
  }

  hasPassive(id) {
    const p = this.state.player;
    if (!p) return false;
    return this.allAbilities().some((a) => a.id === id && a.kind === 'passive');
  }

  /* ---- helpers ---- */
  log(msg) { if (this.ui.log) this.ui.log(msg); }
  uiLog(msg) { if (this.ui.log) this.ui.log(msg); }

  resolveWeapon(name) {
    if (!name) return this.itemTemplate('dagger');
    const lower = String(name).toLowerCase();
    let w = ALL_ITEMS.find((i) => i.name.toLowerCase() === lower) || this.registry.items.find((i) => i.name.toLowerCase() === lower);
    if (!w) w = this.itemTemplate(String(name).toLowerCase().replace(/[^a-z]/g, '-'));
    return w || this.itemTemplate('dagger');
  }

  baseTreasureOf(id, value) {
    const t = this.itemTemplate(id) || this.itemTemplate('gold-pile');
    const it = deepItem(t);
    if (typeof value === 'number') it.value = value;
    return it;
  }

  /* Fires every beat matching (kind, floor), not just the first — a second beat
   * on the same floor used to be written and then silently never shown. */
  fireBeats(kind, floorIdx) {
    const p = this.state.player;
    if (!p || !p.dungeonId) return;
    for (const beat of beatsAt(p.dungeonId, kind, floorIdx)) {
      if (this.beatSeen(kind, floorIdx, beat)) continue;
      this.rememberBeat(kind, floorIdx, beat);
      if (beat.type === 'narration') this.log('… ' + beat.text + ' …');
      else if (beat.type === 'npc-intro' && beat.npcId) this.introduceNpc(beat.npcId);
      else if (beat.type === 'overlay' && this.ui.showBeat) this.ui.showBeat(beat);
      else if (beat.type === 'flag' && beat.flag) setFlag(beat.flag, beat.valueCount || 1);
    }
  }

  /* A beat is a moment, not a room: revisiting a floor should not replay it. */
  beatKey(kind, floorIdx, beat) {
    const p = this.state.player;
    return [p.dungeonId, kind, floorIdx, beat.type, beat.title || beat.npcId || beat.flag || (beat.text || '').slice(0, 24)].join('|');
  }

  beatSeen(kind, floorIdx, beat) {
    const p = this.state.player;
    return !!(p.beatsSeen && p.beatsSeen[this.beatKey(kind, floorIdx, beat)]);
  }

  rememberBeat(kind, floorIdx, beat) {
    const p = this.state.player;
    if (!p.beatsSeen) p.beatsSeen = {};
    p.beatsSeen[this.beatKey(kind, floorIdx, beat)] = true;
  }

  introduceNpc(npcId) {
    const p = this.state.player;
    if (!p.npcsMet) p.npcsMet = {};
    p.npcsMet[npcId] = true;
    if (this.ui.flagNpcIntroduced) this.ui.flagNpcIntroduced(npcId);
  }

  /* ---- abilities ---- */
  allAbilities() {
    const p = this.state.player;
    if (!p) return [];
    const out = [];
    const seen = {};
    for (const a of abilitiesFor(p.cls, p.level)) {
      if (!a || seen[a.id]) continue;
      out.push(a);
      seen[a.id] = true;
    }
    /* Generated abilities used to be listed for every class at every level,
     * taking up a number key that then did nothing when pressed. */
    for (const a of this.registry.abilities || []) {
      if (!a || !a.id || seen[a.id]) continue;
      if (a.cls && a.cls !== p.cls) continue;
      if ((a.level || 1) > p.level) continue;
      out.push(a);
      seen[a.id] = true;
    }
    return out;
  }

  /* Base abilities first, then anything the Library wrote. */
  abilityById(id) {
    return getAbility(id) || (this.registry.abilities || []).find((a) => a && a.id === id) || null;
  }

  activateAbility(id) {
    const p = this.state.player;
    const a = this.abilityById(id);
    /* Silence used to be the failure mode here: an unknown id simply returned. */
    if (!a) { this.log('You reach for a power you do not have.'); return; }
    if (a.cls && a.cls !== p.cls) { this.log('That art belongs to another calling.'); return; }
    if (p.level < a.level) { this.log('You have not yet learned ' + a.name + '.'); return; }
    if (a.kind === 'passive') { this.log('That power is always at work within you.'); return; }
    const cost = a.powerCost || 0;
    if (p.power < cost) { this.log('You lack the power to shape it.'); return; }
    const cd = p.cooldowns[a.id] || 0;
    if (cd > 0) { this.log(a.name + ' stirs — ' + cd + ' more turn' + (cd === 1 ? '' : 's') + '.'); return; }
    p.power -= cost;
    p.cooldowns[a.id] = (a.cooldown || 0);
    this.log('— ' + a.name + ' —');
    const der = this.derived();
    switch (a.kind) {
      case 'damage': this.abilityDamage(a, der); break;
      case 'heal': this.abilityHeal(a); break;
      case 'reveal': this.abilityReveal(a); break;
      case 'teleport': this.abilityTeleport(a); break;
      case 'turn': this.abilityTurn(a, der); break;
      case 'buff': this.abilityBuff(a); break;
      default: this.log('Nothing visibly happens.');
    }
    if (this.dying) return;
    this.endPlayerTurn();
  }

  abilityDamage(a, der) {
    this.breakSanctuary();
    const floor = this.currentFloor;
    const p = this.state.player;
    const range = a.range || (a.aura ? 1 : 1000);
    let target = null, best = 1e9;
    for (const m of floor.monsters) {
      if (m.hp <= 0) continue;
      if (!this.vis[m.y] || !this.vis[m.y][m.x]) continue;
      const d = dist1(m, p);
      if (d <= range && d < best) { best = d; target = m; }
    }
    const bonus = this.abilityBonus(a.damage, der);
    const r = this.rngOfTurn();
    if (a.aura) {
      const cx = target ? target.x : p.x, cy = target ? target.y : p.y;
      const hit = floor.monsters.filter((m) => m.hp > 0 && !(m.x === cx && m.y === cy) && Math.abs(m.x - cx) + Math.abs(m.y - cy) <= a.aura);
      hit.unshift(target);
      for (const m of hit) {
        if (!m) continue;
        const dmg = Math.max(1, this.rollDamage(a.damage) + bonus);
        this.log(a.name + ' blasts the ' + m.t.name + ' for ' + dmg + '!');
        this.applyDamageToMonster(m, dmg, false, der);
        if (this.dying) return;
      }
    } else if (target) {
      const dmg = Math.max(1, this.rollDamage(a.damage) + bonus);
      this.log(a.name + ' strikes the ' + target.t.name + ' for ' + dmg + '!');
      this.applyDamageToMonster(target, dmg, false, der);
    } else {
      this.log(a.name + ' finds no target in the light.');
    }
  }

  abilityBonus(dmg, der) {
    /* Effective stats, not the raw sheet: a Ring of Might and a Potion of
     * Titan's Grip were both invisible to every ability that scales on STR. */
    const eff = (der && der.effValues) || this.derived().effValues;
    let b = 0;
    if (dmg && dmg.int) b += abilityMod(eff.int);
    else if (dmg && dmg.n === 'str') b += abilityMod(eff.str);
    return b;
  }

  abilityHeal(a) {
    const p = this.state.player;
    /* Hand-authored abilities carry "3d6"; generated ones carry {dice,sides}. */
    const v = (a.heal && typeof a.heal === 'object') ? this.rollDamage(a.heal) : evaluateDice(a.heal);
    p.hp = Math.min(p.maxhp, p.hp + Math.max(1, v));
    this.log('Old forces knit your wounds for ' + Math.max(1, v) + ' hit points.');
  }

  /* A short-lived edge on your attacks. The validator accepts kind "buff", so
   * the engine has to do something real with one. */
  /* Sanctuary hides you; it does not make you a fixed gun emplacement. Drawing
   * blood ends it, which is what "the dark forgets you" has to mean. */
  breakSanctuary() {
    const p = this.state.player;
    if (p.buffs && p.buffs.sanctuary > 0) {
      delete p.buffs.sanctuary;
      this.log('You strike, and the dark remembers you at once.');
    }
  }

  abilityBuff(a) {
    const p = this.state.player;
    const bonus = Math.max(1, a.bonus || 2);
    const turns = Math.max(2, a.aura || 5);
    p.buffs.might = turns;
    if (!p.buffLevels) p.buffLevels = {};
    p.buffLevels.might = bonus;
    this.log('Your aim sharpens: +' + bonus + ' to hit for ' + turns + ' turns.');
  }

  abilityReveal(a) {
    if (a.detectMonsters) {
      const floor = this.currentFloor;
      if (floor) for (const m of floor.monsters) m.revealed = true;
      this.log('Unholy eyes burn in the murk — you see them all.');
    }
    this.revealSecrets();
  }

  abilityTeleport(a) {
    const p = this.state.player;
    const floor = this.currentFloor;
    const r = this.rngOfTurn();
    for (let tries = 0; tries < 30; tries++) {
      const nx = p.x + r.int(-a.teleportRng, a.teleportRng);
      const ny = p.y + r.int(-a.teleportRng, a.teleportRng);
      if (!this.inBounds(nx, ny)) continue;
      const t = floor.tiles[ny][nx];
      if (!isTravelable(t)) continue;
      if (floor.monsters.some((m) => m.x === nx && m.y === ny)) continue;
      p.x = nx; p.y = ny;
      this.log('The dark folds around you — you are elsewhere.');
      this.computeVisibility();
      return;
    }
    this.log('The veil resists you.');
  }

  abilityTurn(a, der) {
    const p = this.state.player;
    const floor = this.currentFloor;
    let best = null, bestD = 1e9;
    for (const m of floor.monsters) {
      const isUndead = m.t.props && (m.t.props.indexOf('undead') >= 0 || m.t.props.indexOf('cursed') >= 0);
      if (!isUndead) continue;
      const d = dist1(m, p);
      if (d <= (a.range || 6) && d < bestD) { bestD = d; best = m; }
    }
    if (!best) { this.log('Nothing unholy answers your wrath.'); return; }
    const dmg = Math.max(1, this.rollDamage(a.damage || { dice: 2, sides: 6, bonus: 0 }));
    this.log(a.name + ' sears the ' + best.t.name + ' for ' + dmg + '! It staggers back.');
    best.hp -= dmg;
    best.fleeing = true;
    best.aggro = false;
    const p2 = this.state.player;
    if (!p2.buffs.turn) p2.buffs.turn = 0;
    p2.buffs.turn += 2;
    if (best.hp <= 0) this.killMonster(best);
  }

  /* ---- items & gear ---- */
  allItems() {
    return this.state.player ? this.state.player.inventory : [];
  }

  useItem(item) {
    if (!item) return;
    const fx = item.effects || {};
    if (item.kind === 'potion' || item.kind === 'scroll' || item.slot === 'consumable') {
      this.consumeItem(item, fx);
    } else if (item.kind === 'wand') {
      this.castWand(item);
    } else if (WEARABLE_SLOTS.includes(item.slot)) {
      this.equip(item);
      return;
    } else {
      /* Terminal branch. useItem and equip used to hand anything they did not
       * recognise straight back to each other — a stack overflow waiting for
       * the first item with a misc slot, which is exactly what the validator
       * defaults an unknown kind to. */
      this.log('You turn the ' + item.name + ' over in your hands and learn nothing.');
      return;
    }
    this.endPlayerTurn();
  }

  consumeItem(item, fx) {
    const p = this.state.player;
    if (fx.heal) { const v = evaluateDice(fx.heal); p.hp = Math.min(p.maxhp, p.hp + v); this.log('Sweet relief: +' + v + ' HP.'); }
    else if (fx.power) { const v = evaluateDice(fx.power); p.power = Math.min(p.maxpower, p.power + v); this.log('Crackling force surges: +' + v + ' PWR.'); }
    else if (fx.buffStr) { p.buffs.str = fx.buffStr; this.log('Your arm bulges with borrowed might.'); }
    else if (fx.removeCurse) { this.removeAllCurses(); }
    else if (fx.identify) { this.identifyAll(); }
    else if (fx.teleport) { this.teleportRandom(); }
    else if (fx.map) { this.revealSecrets(); this.mapRevealed = true; this.log('Ghost-lines crawl across the floor map.'); }
    else if (fx.flame) { this.scrollFlame(fx.flame); }
    else if (fx.sanctuary) { p.buffs.sanctuary = fx.sanctuary; this.log('For a while, the dark forgets your name.'); }
    else { this.log('It does nothing you can perceive.'); }
    const idx = p.inventory.indexOf(item);
    if (idx >= 0) p.inventory.splice(idx, 1);
    this.unbindItem(item);
  }

  scrollFlame(dice) {
    const p = this.state.player;
    const floor = this.currentFloor;
    let target = null, best = 1e9;
    for (const m of floor.monsters) {
      const d = dist1(m, p);
      if (d < best) { best = d; target = m; }
    }
    if (!target) { this.log('The flame finds nothing to burn.'); return; }
    const dmg = evaluateDice(dice);
    this.log('The scroll ignites: the ' + target.t.name + ' burns for ' + dmg + '!');
    target.hp -= dmg;
    target.aggro = true;
    if (target.hp <= 0) this.killMonster(target);
  }

  castWand(item) {
    const p = this.state.player;
    const fx = item.effects || {};
    if ((fx.charges || 0) <= 0) { this.log('The ' + item.name + ' is spent.'); return; }
    fx.charges--;
    const r = this.rngOfTurn();
    const spell = fx.spell;
    if (spell === 'heal') {
      const v = r.d(6) + 3;
      p.hp = Math.min(p.maxhp, p.hp + v);
      this.log('The wand warms: +' + v + ' HP. (' + fx.charges + ' charges)' );
    } else {
      const floor = this.currentFloor;
      let target = null, best = 1e9;
      for (const m of floor.monsters) {
        const d = dist1(m, p);
        if (d < best) { best = d; target = m; }
      }
      if (!target) { this.log('The wand fizzles: no target.'); return; }
      const dmg = r.d(6) + 1;
      this.log('The wand of ' + spell + ' lances the ' + target.t.name + ' for ' + dmg + '!');
      target.hp -= dmg;
      target.aggro = true;
      if (spell === 'frost') target.stunned = 1;
      if (target.hp <= 0) this.killMonster(target);
    }
    if (fx.charges <= 0) {
      const idx = p.inventory.indexOf(item);
      if (idx >= 0) p.inventory.splice(idx, 1);
      this.unbindItem(item);
      if (p.equipment.weapon === item) p.equipment.weapon = null;
      this.log('The wand crumbles to ash.');
    }
  }

  equip(item) {
    const p = this.state.player;
    const slot = item.slot;
    if (!WEARABLE_SLOTS.includes(slot)) { this.useItem(item); return; }
    const cur = p.equipment[slot];
    p.equipment[slot] = item;
    const idx = p.inventory.indexOf(item);
    if (idx >= 0) p.inventory.splice(idx, 1);
    this.unbindItem(item);   /* worn is not carried: it leaves the belt */
    if (cur) { p.inventory.push(cur); this.log('You swap the ' + cur.name + ' for the ' + item.name + '.'); }
    else { this.log('You ready the ' + item.name + '.'); }
    p.maxpower = this.computeMaxPower();
    p.power = Math.min(p.maxpower, p.power);
  }

  unequip(slot) {
    const p = this.state.player;
    const cur = p.equipment[slot];
    if (!cur) return;
    if (cur.cursed) { this.log('The cursed ' + cur.name + ' will not come off! Seek a Draught of Unbinding.'); return; }
    if (p.inventory.length >= 32) { this.log('Your pack is full.'); return; }
    p.inventory.push(cur);
    p.equipment[slot] = null;
    p.maxpower = this.computeMaxPower();
    p.power = Math.min(p.maxpower, p.power);
    this.log('You set down the ' + cur.name + '.');
  }

  drop(item) {
    const p = this.state.player;
    const idx = p.inventory.indexOf(item);
    if (idx < 0) return;
    p.inventory.splice(idx, 1);
    this.unbindItem(item);
    if (this.currentFloor && this.currentFloor.items) {
      this.currentFloor.items.push({ i: item, x: p.x, y: p.y, auto: false });
      this.rememberDrop(item, p.x, p.y);
    }
    this.log('You drop the ' + item.name + '.');
  }

  /* The belt holds UIDs, not object references. save() is a deep JSON copy, so
   * a reference here survives serialisation as a duplicate object and every
   * identity test against the pack fails the moment the game is reloaded. */
  beltUid(entry) {
    if (!entry) return null;
    return typeof entry === 'string' ? entry : (entry.uid || null);
  }

  beltItem(index) {
    const p = this.state.player;
    const uid = this.beltUid(p.belt[index]);
    if (!uid) return null;
    return p.inventory.find((it) => it && it.uid === uid) || null;
  }

  unbindItem(item) {
    const p = this.state.player;
    if (!p || !item || !item.uid) return;
    for (let i = 0; i < p.belt.length; i++) {
      if (this.beltUid(p.belt[i]) === item.uid) p.belt[i] = null;
    }
  }

  setBelt(index, item) {
    const p = this.state.player;
    if (index < 0 || index >= p.belt.length) return;
    if (!item) { p.belt[index] = null; return; }
    if (p.inventory.indexOf(item) < 0) return;
    if (!item.uid) item.uid = rngIntId();
    this.unbindItem(item);   /* one loop per item: binding again moves it */
    p.belt[index] = item.uid;
    this.log('Bound to the belt: ' + item.name + '.');
  }

  /* The first free loop, so binding is one click rather than a puzzle. */
  bindToBelt(item) {
    const p = this.state.player;
    if (!item) return false;
    if (!item.uid) item.uid = rngIntId();
    if (p.belt.some((e) => this.beltUid(e) === item.uid)) {
      this.log(item.name + ' is already on your belt.');
      return false;
    }
    const free = p.belt.findIndex((x) => !x);
    if (free < 0) { this.log('Your belt is full. Unbind something first.'); return false; }
    this.setBelt(free, item);
    return true;
  }

  /* Belt loops were bindable only to null and usable by nothing: four empty
   * boxes rendered on the gear panel for every character ever made. */
  useBeltItem(index) {
    const p = this.state.player;
    if (index < 0 || index >= p.belt.length) return false;
    if (!p.belt[index]) { this.log('That belt loop is empty.'); return false; }
    const item = this.beltItem(index);
    if (!item) {
      p.belt[index] = null;
      this.log('That is no longer on your belt.');
      return false;
    }
    this.useItem(item);
    return true;
  }

  identifyAll() {
    const p = this.state.player;
    for (const it of p.inventory) it.identified = true;
    for (const it of Object.values(p.equipment || {})) if (it) it.identified = true;
    this.log('You read by touch and firelight — all is known.');
  }

  removeAllCurses() {
    const p = this.state.player;
    let n = 0;
    const unbind = (it) => { if (it && it.cursed) { it.cursed = false; n++; } };
    p.inventory.forEach(unbind);
    Object.values(p.equipment || {}).forEach(unbind);
    p.belt.filter(Boolean).forEach(unbind);
    this.log(n ? 'The curses slip away like sweat (' + n + ').' : 'Nothing is bound to you.');
  }

  teleportRandom() {
    const p = this.state.player;
    const floor = this.currentFloor;
    const r = this.rngOfTurn();
    for (let tries = 0; tries < 60; tries++) {
      const nx = r.int(2, W - 3), ny = r.int(2, H - 3);
      const t = floor.tiles[ny][nx];
      if (!isTravelable(t)) continue;
      if (floor.monsters.some((m) => m.x === nx && m.y === ny)) continue;
      p.x = nx; p.y = ny;
      this.log('The world wrenches — you stand somewhere else.');
      this.computeVisibility();
      return;
    }
    this.log('The recall wavers and fails.');
  }

  /* ---- save ---- */
  save() {
    this.snapshotFloor();
    return JSON.parse(JSON.stringify(this.state));
  }

  restore(state) {
    this.state = state;
    /* Saves written before floor memory existed simply have none. */
    if (!this.state.floors) this.state.floors = {};
    const p = this.state.player;
    if (p) {
      if (!p.buffLevels) p.buffLevels = {};
      if (!p.beatsSeen) p.beatsSeen = {};
      if (!p.npcsMet) p.npcsMet = {};
      /* Belts used to hold object references, which a JSON round-trip turns
       * into copies that match nothing. Rewrite them as uids. */
      if (Array.isArray(p.belt)) {
        p.belt = p.belt.map((e) => {
          if (!e) return null;
          if (typeof e === 'string') return e;
          if (!e.uid) return null;
          return p.inventory.some((it) => it && it.uid === e.uid) ? e.uid : null;
        });
      }
    }
    this.currentFloor = null;
    this.dying = false;
  }
}

