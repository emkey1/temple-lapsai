/* ENGINE: turn-based game core.
 * Owns game state, floor generation, vision, movement, combat, the turn loop,
 * leveling, abilities and item use. UI is injected via opts.ui (see main.js).
 */
import { RNG, hashSeed } from './rng.js';
import { QUESTS, questById, questsFrom, objectiveText } from './quests.js';
import {
  CLASSES, getAbility, abilityMod, XP_FOR_LEVEL,
  getMonster, monstersForFloor, getItemTemplate, ALL_ITEMS, abilitiesFor,
  scaleDice, randomTreasureValue, getDungeon,
  healFractionForItem, healFractionForAbility, RECOVERY,
  BACKGROUNDS, backgroundById, SKILLS, skillById,
} from './base.js';
import {
  T, W, H, isTravelable, isSlowGoing, isWall, isDoor, generateFloor, generateTownFloor, GEN_VERSION,
} from './mapgen.js';
import { npcsForDungeonFloor } from './npc.js';
import { beatsAt, arcForDungeon, setFlag, getFlag, getNPC, getFaction } from './world.js';
import { evaluateDice, rngIntId, dist1, dist8, applyMagic, applyCurse, deepItem } from './dice.js';
import { WEARABLE_SLOTS, isWorn } from './contract.js';
import { itemStackKey } from './base.js';

/* How much the pack holds. Named because the Gear tab shows it, and a limit
 * the player only discovers by hitting it is not a limit, it is a surprise. */
export const PACK_LIMIT = 32;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* Eight-way, now that both sides move diagonally. Anything that means
 * "adjacent" uses dist8; anything that means "how far" still uses dist1. */
const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/* Turns a monster keeps hunting after it last had the player in sight. Without
 * a limit, anything that ever woke up stays awake forever and holds the stairs. */
const AGGRO_MEMORY = 12;

/* How much a Potion of Titan's Grip actually adds while it lasts. The potion
 * set a countdown that nothing ever read. */
const STRENGTH_BUFF = 4;

/* Recovery. Nothing in v1 came back: health regenerated only from a ring, and
 * power never regenerated at all, so a spent caster stayed spent for the rest
 * of the run. Out of combat both come back, slowly, which is what makes
 * retreating a tactic instead of a longer death. */
/* What a standing is called, at each step. The ladder is deliberately short:
 * a company climbs it by doing favours, and the repeatable bounties mean the
 * climb never dead-ends for want of a quest to take. */
const STANDING_RANKS = ['a stranger', 'noticed', 'owed a favour', 'a friend of the order', 'one of their own'];

/* THE STANDING ORDER'S OWN, by kind: the bones that remember marching orders
 * and the carved guards that stopped waiting. Listed rather than swept up by
 * prop, because the garrison is a specific set of creatures — not everything
 * undead answers to it; the flood's drowned dead are the Sisters' affair. */
const STANDING_ORDER_CREATURES = new Set([
  'skeleton', 'zombie', 'ghoul', 'ghast', 'mummy', 'wraith', 'spectre',
  'living-statue', 'gargoyle',
]);

const CALM_RADIUS = 9;          /* nothing awake this close = out of combat */
/* How far a heavy door carries. Deliberately inside CALM_RADIUS: what a door
 * wakes should be something the company then has to deal with, not something
 * that starts a fight from further off than a fight can reach. */
const DOOR_NOISE = 6;
export const TOWN_ID = 'the-whetstone';   /* the town is a place, not a dungeon */
/* Halved from 0.02. It had made the altar — which mends 35% of maximum health
 * once, and lifts every curse — worth about a third of what one free keypress
 * of R gives you. Note what the max(1, ...) floor below does to this: at a
 * small maximum the floor already dominated the fraction, so the halving only
 * bites once a character is big. */
const HP_REGEN_FRACTION = 0.01;
/* Out-of-combat health comes back a tenth as fast as it once did: the grant
 * below lands on every Nth calm tick. See the comment at the grant for why
 * spacing the ticks is the only lever that actually works. */
const HP_REGEN_EVERY = 10;
const WOUND_SHARE = RECOVERY.woundShare;
const WOUND_FLOOR = RECOVERY.woundFloor;
const HEAL_MENDS = RECOVERY.healMends;
const PWR_REGEN_FRACTION = 0.045;
/* Renewal DURING a fight, which only a passive grants. Both are ceilings on
 * what any one ability may hand out, because a number the engine reads should
 * be a number the engine bounds — and because a trickle big enough to fund a
 * cast every turn puts a Mage over a Fighter's sustained damage at range, with
 * an attack that cannot miss. */
const MAX_COMBAT_PWR_REGEN = 0.04;
const MAX_FOCUS_POWER = 3;

/* How many tiers of monster share a floor. Wide enough that a floor has
 * variety, narrow enough that what you met three floors ago has been left
 * behind — and the draw leans towards the gentle end of it, so a wide band
 * spends most of its time at the bottom. */
const BAND_WIDTH = 3;

/* How close you have to be for the thing in the drain to decide you are worth
 * the trouble. Two, so it breaks the surface the step before it can reach you
 * rather than out of nowhere. */
const SURFACE_RANGE = 2;

function bandDistance(tier, bottom, ceiling) {
  if (tier < bottom) return bottom - tier;
  if (tier > ceiling) return tier - ceiling;
  return 0;
}
const DESCENT_RECOVERY = 0.15;  /* stairs are a breather, not a bed */

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

/* THE PARTY.
 *
 * `state.player` stops being a field and becomes the character whose turn it
 * is — an accessor onto the party — so the ninety-odd places in the engine and
 * the seventeen in the UI that read it keep working unchanged while there
 * stops being exactly one of them.
 *
 * It is deliberately NOT enumerable. save() is a JSON round trip of state, and
 * a `player` that serialised alongside the party would come back as a second,
 * divergent copy of the same character — the belt bug of Phase 0 all over
 * again, one level up.
 */
export function installParty(state) {
  if (!state.party || !Array.isArray(state.party.members)) {
    state.party = { members: [], active: 0 };
  }
  if (!(state.party.active >= 0) || state.party.active >= state.party.members.length) {
    state.party.active = 0;
  }
  Object.defineProperty(state, 'player', {
    configurable: true,
    enumerable: false,
    get() {
      const party = this.party;
      if (!party || !party.members.length) return null;
      return party.members[party.active] || null;
    },
    /* Assigning still works, because foundAdventurer does it: it fills the
     * active slot rather than shadowing the accessor with a field. */
    set(who) {
      if (!this.party || !Array.isArray(this.party.members)) this.party = { members: [], active: 0 };
      if (!this.party.members.length) this.party.members.push(who);
      else this.party.members[this.party.active] = who;
    },
  });
  return state;
}

/* THE COMPANY PURSE, and the shim that keeps one truth.
 *
 * Gold sat on each sheet and was spent from whichever sheet held the reins —
 * invisible while the reins never moved, and "my two thousand gold turned
 * into twenty-five" the moment a chip click could hand them over. Coin is
 * the expedition's, so it lives on the party.
 *
 * Every member keeps a `gold` accessor onto that one purse, for the same
 * reason `state.player` is an accessor onto the active member: the model
 * changes underneath while the forty-odd places that read and write
 * `p.gold` keep saying what they meant. Non-enumerable, so save()'s JSON
 * round trip stores the purse ONCE, on the party, and never as a copy per
 * sheet that could drift.
 */
/* A MEMBER'S COLOUR IS THEIRS, NOT THEIR SLOT'S.
 *
 * The tint was taken from the roster index, so dragging a nameplate into
 * a different place in the line repainted half the company — the ring on
 * the map, the chip, the name in the top bar — and the one thing the
 * colours exist to answer ("which of these is which") stopped being
 * answerable. Each member claims the lowest free tint when they join and
 * keeps it for life. */
export function assignTints(state) {
  const list = (state.party && state.party.members) || [];
  const taken = new Set(list.filter(Boolean).map((m) => m.tint).filter((t) => Number.isInteger(t)));
  for (const m of list) {
    if (!m || Number.isInteger(m.tint)) continue;
    let t = 0;
    while (taken.has(t)) t++;
    m.tint = t;
    taken.add(t);
  }
  return state;
}

export function linkPurse(state) {
  const party = state.party;
  if (!party) return state;
  /* Pool whatever the save carried on the sheets, once, before the
   * accessors shadow it — most of it on the old leader, a founding
   * handful on everyone else. No coin lost, none counted twice. */
  let pooled = Number.isFinite(party.gold) ? party.gold : 0;
  for (const m of party.members || []) {
    if (!m) continue;
    const own = Object.getOwnPropertyDescriptor(m, 'gold');
    if (own && 'value' in own) { pooled += own.value || 0; delete m.gold; }
  }
  party.gold = pooled;
  for (const m of party.members || []) {
    if (!m) continue;
    Object.defineProperty(m, 'gold', {
      configurable: true,
      enumerable: false,
      get() { return party.gold || 0; },
      set(v) { party.gold = Math.max(0, Math.round(v || 0)); },
    });
  }
  return state;
}

/* Takes a state from anywhere — freshly built, restored from a save written
 * today, or restored from one written before the party existed — and leaves it
 * with a party and a working accessor. A save from before carries a plain
 * `player` object and no party; that character becomes a party of one. */
export function adoptParty(state) {
  const own = Object.getOwnPropertyDescriptor(state, 'player');
  const legacy = own && 'value' in own ? own.value : null;
  if (own && 'value' in own) delete state.player;
  if (!state.party || !Array.isArray(state.party.members)) {
    state.party = { members: legacy ? [legacy] : [], active: 0 };
  }
  installParty(state);
  assignTints(state);
  return linkPurse(state);
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
    wounds: 0,
    background: null,
    skills: {},
    skillPoints: 0,
    buffs: {},
    buffLevels: {},   /* magnitudes, kept out of p.buffs, which is all countdowns */
    bossesSlain: {},
    explored: {},
    identified: [],
    counters: {},
    visitedDungeons: {},
    beatsSeen: {},
    npcsMet: {},
    deepest: {},
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
    this.state = adoptParty({
      version: 2,
      seed: (Math.random() + 1).toString(36).slice(2, 8),
      created: Date.now(),
      totalKills: 0,
      floors: {},
      genVersion: GEN_VERSION,
      party: { members: [], active: 0 },
    });
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
      this.state.floors[key] = { killed: [], taken: [], doors: [], dropped: [], seen: null, charted: null };
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
    /* The town has no memory to keep — and its all-seen map must never be
     * written over a dungeon floor's memo on the way down. */
    if (this.currentFloor.mouths) return;
    const memo = this.currentMemo();
    if (!memo) return;
    memo.seen = this.seen.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
    /* Kept apart from `seen` rather than folded into it as a third value:
     * every read of seen in the game is a truthiness test, and widening it
     * would have meant auditing all of them to find the ones that meant
     * "walked" rather than "known". A save written before charts existed has
     * no charted row, reads as all-false, and draws exactly as it used to. */
    if (this.charted) {
      memo.charted = this.charted.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
    }
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
    if (Array.isArray(memo.charted) && this.charted) {
      for (let y = 0; y < H && y < memo.charted.length; y++) {
        const row = memo.charted[y] || '';
        for (let x = 0; x < W; x++) this.charted[y][x] = row[x] === '1';
      }
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

  derived(who) {
    const p = who || this.state.player;
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
    /* A ward soaks like a worn one does — damagePlayer already knows how to
     * spend `resist`, so a timed one only has to arrive in the same place. */
    if (p.buffs && p.buffs.ward > 0) resist += (p.buffLevels && p.buffLevels.ward) || 1;
    ac -= abilityMod(eff.dex);
    dmg.bonus += abilityMod(eff.str);
    /* Keep the class bonus: rebuilding dmg from the weapon dropped the
     * Fighter's +1 the instant they picked up a sword. */
    if (eqWeapon) dmg = { dice: eqWeapon.dice, sides: eqWeapon.sides, bonus: (eqWeapon.bonus || 0) + abilityMod(eff.str) + c.dmgBonus };
    dmg.bonus += Math.floor((p.level - 1) / 3);
    /* Granted by the ABILITY, not by the class name — the passive previously
     * gave nothing that lacking it would have taken away. */
    let powerRegen = 0, focusPower = 0;
    for (const a of this.passives(p)) {
      if (a.critBonus) crit += a.critBonus;
      if (a.powerRegen) powerRegen += a.powerRegen;
      if (a.focusPower) focusPower += a.focusPower;
    }
    let maxp = c.powerBase + this.equipmentPower();
    if (c.powerPerInt) maxp += abilityMod(eff.int);
    if (c.powerPerChr) maxp += abilityMod(eff.cha);
    if (p.level > 1) maxp += (p.level - 1) * 2;
    /* The past rides along: a background's perks are worn for life, the
     * way Arcanum wore them. */
    const bg = backgroundById(p.background);
    const perks = (bg && bg.perks) || {};
    return {
      effValues: eff,
      toHit,
      ac,
      dmg,
      crit,
      regen: regen + (perks.regen || 0),
      resist: resist + (perks.resist || 0),
      undeadResist: undeadResist + (perks.undeadResist || 0),
      luck: luck + (perks.luck || 0),
      powerRegen: Math.min(MAX_COMBAT_PWR_REGEN, powerRegen),
      focusPower: Math.min(MAX_FOCUS_POWER, focusPower),
      sanctuary: (p.buffs && p.buffs.sanctuary > 0) || false,
      seeSecrets: !!seeSecrets,
      maxpower: Math.max(1, maxp),
      sight: 9 + (perks.sight || 0),
    };
  }

  /* Where you are standing when a floor comes up around you. Falls back to the
   * up-staircase whenever the asked-for spot is not somewhere a person can
   * stand — a floor with no down-staircase is the bottom one, and a remembered
   * position can be stale if the generator has been re-cut underneath it. */
  placeOnArrival(floor, arriveAt) {
    const p = this.state.player;
    const standable = (spot) => spot && isTravelable(floor.tiles[spot.y] && floor.tiles[spot.y][spot.x]);
    let spot = floor.up;
    if (arriveAt === 'down' && standable(floor.down)) spot = floor.down;
    else if (arriveAt === 'keep' && standable({ x: p.x, y: p.y })) spot = { x: p.x, y: p.y };
    p.x = spot.x;
    p.y = spot.y;
  }

  /* The rest of the party arrives with whoever led the way: clustered on the
   * nearest walkable, unoccupied tiles, all their floor bookkeeping synced.
   * A ring search rather than anything clever — the party is at most a few
   * bodies, and stairs always stand on open ground. */
  placePartyAround(floor, leader) {
    const party = this.state.party;
    if (!party || party.members.length <= 1) return;
    const taken = new Set([leader.y * W + leader.x]);
    const fits = (x, y) => this.inBounds(x, y) && isTravelable(floor.tiles[y][x]) &&
      !taken.has(y * W + x) &&
      !(floor.monsters || []).some((mo) => mo.hp > 0 && mo.x === x && mo.y === y) &&
      !(floor.npcs || []).some((n) => n.x === x && n.y === y);
    for (const m of party.members) {
      if (!m || m === leader) continue;
      m.dungeonId = leader.dungeonId;
      m.floorIdx = leader.floorIdx;
      let placed = false;
      for (let r = 1; r <= 6 && !placed; r++) {
        for (let dy = -r; dy <= r && !placed; dy++) {
          for (let dx = -r; dx <= r && !placed; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = leader.x + dx, y = leader.y + dy;
            if (!fits(x, y)) continue;
            m.x = x; m.y = y;
            taken.add(y * W + x);
            placed = true;
          }
        }
      }
      if (!placed) { m.x = leader.x; m.y = leader.y; }   /* a crowd, not a crash */
    }
  }

  /* Renewal arrives as a fraction of a point a turn, which rounds to nothing
   * every turn if you let it and to a free point a turn if you round the other
   * way. So it is banked and paid out whole. */
  gatherPower(amount, der) {
    const p = this.state.player;
    if (!(amount > 0)) return 0;
    const max = (der || this.derived()).maxpower;
    if (p.power >= max) return 0;
    if (!p.counters) p.counters = {};
    p.counters.mote = (p.counters.mote || 0) + amount;
    const whole = Math.floor(p.counters.mote);
    if (whole < 1) return 0;
    p.counters.mote -= whole;
    const before = p.power;
    p.power = Math.min(max, p.power + whole);
    return p.power - before;
  }

  /* A focus is a weapon that carries power, which is the property the Staff
   * has and a sword does not — and which anything the Library invents can have
   * without being named here. applyMagic only ever writes toHit, damage and
   * acBonus, so a +2 Broadsword never becomes one. */
  isFocusWeapon(it) {
    return !!(it && it.slot === 'weapon' && Number(it.effects && it.effects.power) > 0);
  }

  effectiveStats() {
    const p = this.state.player;
    if (!p) return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    return this.derived().effValues;
  }

  baseMaxPower() {
    return this.derived().maxpower;
  }

  computeMaxPower(who) {
    return this.derived(who).maxpower;
  }

  equipmentPower() {
    let v = 0;
    const eq = (this.state.player.equipment || {});
    /* Number(), because this sums a field the Library also writes: anything
     * non-numeric here concatenates instead of adding and max power comes back
     * as NaN, which is a character sheet full of blanks. */
    for (const slot of Object.values(eq)) {
      if (slot && slot.effects && slot.effects.power) v += Number(slot.effects.power) || 0;
    }
    return v;
  }

  /* ---- founding ---- */
  /* THE BASIC LOADOUT. Nobody walks into the dark in their shirt: weapon,
   * armour off the class's ladder — green, seasoned, veteran, by level —
   * and a shield where the calling carries one. Founded adventurers and
   * hirelings dress at the same counter; a hireling without it was, in the
   * playtest's words, essentially useless. */
  outfitMember(b, level) {
    const c = CLASSES[b.cls] || CLASSES.fighter;
    const weapon = this.resolveWeapon(c.weapon);
    if (weapon) b.equipment.weapon = deepItem(weapon);
    const rung = level >= 7 ? 2 : level >= 4 ? 1 : 0;
    const armor = c.armor && getItemTemplate(c.armor[Math.min(rung, c.armor.length - 1)]);
    if (armor) b.equipment.body = deepItem(armor);
    const shield = c.shield && getItemTemplate(c.shield);
    if (shield) b.equipment.shield = deepItem(shield);
    return b;
  }

  /* A past is applied at the door: the stat trade bakes into the rolled
   * stats, a taught skill arrives as a free rank, and the perks ride
   * derived() for as long as the character lives. */
  applyBackground(b, backgroundId) {
    const bg = backgroundById(backgroundId);
    if (!bg) return b;
    b.background = bg.id;
    for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      if (bg.statAdj[k]) b.stats[k] = Math.max(3, Math.min(18, b.stats[k] + bg.statAdj[k]));
    }
    if (bg.perks.skill) b.skills[bg.perks.skill] = 1;
    /* A constitution traded at the door must reach the health it feeds. */
    if (bg.statAdj.con) {
      const c = CLASSES[b.cls] || CLASSES.fighter;
      b.maxhp = c.hpBase + Math.max(1, Math.max(1, c.hpDie + abilityMod(b.stats.con)));
      b.hp = b.maxhp;
    }
    return b;
  }

  skillRank(member, id) {
    const m = member || this.state.player;
    return (m && m.skills && m.skills[id]) || 0;
  }

  spendSkillPoint(member, id) {
    const m = member || this.state.player;
    const s = skillById(id);
    if (!m || !s) return false;
    if ((m.skillPoints || 0) < 1) { this.log('No unspent learning.'); return false; }
    const rank = this.skillRank(m, id);
    if (rank >= s.max) { this.log(s.name + ' has no further to go.'); return false; }
    m.skills[id] = rank + 1;
    m.skillPoints--;
    this.log((m === this.state.player ? 'You sharpen ' : m.name + ' sharpens ') + s.name + ' to rank ' + (rank + 1) + '.');
    if (this.ui.refreshStats) this.ui.refreshStats(this);
    return true;
  }

  foundAdventurer(name, clsId, stats, backgroundId) {
    this.state.player = makePlayer(name, clsId, stats);
    /* The founding handful opens the company purse — linkPurse sweeps the
     * fresh sheet's raw gold in and hands it the accessor. */
    linkPurse(this.state);
    assignTints(this.state);
    this.applyBackground(this.state.player, backgroundId);
    this.outfitMember(this.state.player, 1);
    this.state.player.maxpower = this.computeMaxPower();
    this.state.player.power = this.state.player.maxpower;
    this.state.player.maxhp = this.maxHp();
    this.state.player.hp = this.state.player.maxhp;
    this.enterDungeon('temple');
    return this.state.player;
  }

  /* The Thief's 1.5x was declared on the class and read by nothing. It is the
   * half of that class's identity that survives into a game with a town. */
  goldMul() {
    const p = this.state.player;
    const c = (p && CLASSES[p.cls]) || CLASSES.fighter;
    const bg = p && backgroundById(p.background);
    return (c.goldMul || 1) + ((bg && bg.perks.goldMul) || 0);
  }

  maxHp() {
    const p = this.state.player;
    const c = CLASSES[p.cls] || CLASSES.fighter;
    return p.maxhp || (c.hpBase + Math.max(1, c.hpDie + abilityMod(p.stats.con)));
  }

  /* ---- floors ---- */
  inTown() {
    return !!(this.state && this.state.player && this.state.player.dungeonId === TOWN_ID);
  }

  /* T5, THE LIVING TOWN: The Whetstone stops being a card of buttons and
   * becomes ground. Climb out of any first floor and you stand on the
   * green: houses with their keepers at the door, and a row of dungeon
   * mouths in the east field. The services are the same functions town.js
   * always ran — walking up to a keeper is how you ask for them now. */
  enterTown(fromDungeonId) {
    const p = this.state.player;
    this.snapshotFloor();   /* remember the floor being climbed out of */
    p.lastDungeon = fromDungeonId && fromDungeonId !== TOWN_ID ? fromDungeonId : (p.lastDungeon || 'temple');
    p.dungeonId = TOWN_ID;
    p.floorIdx = 0;
    this.loadTown('arrive');
    this.log('The Whetstone: lamplight, wet cobbles, and the ledger kept open for you.');
  }

  loadTown(arriveAt) {
    const p = this.state.player;
    const floor = generateTownFloor(this.availableDungeons());
    this.currentFloor = floor;
    for (const m of (this.state.party && this.state.party.members) || []) {
      if (!m) continue;
      this.clearActorTurn(m);
      m.ini = undefined;
    }
    this._round = null;
    /* Arrivals stand at the mouth they climbed out of; a reload keeps its
     * place if that place still exists on the rebuilt green. */
    const standable = (x, y) => isTravelable(floor.tiles[y] && floor.tiles[y][x]);
    let spot = floor.entry;
    if (arriveAt === 'keep' && standable(p.x, p.y)) {
      spot = { x: p.x, y: p.y };
    } else {
      const mouth = (floor.mouths || []).find((m) => m.dungeonId === p.lastDungeon);
      if (mouth && standable(mouth.x - 1, mouth.y)) spot = { x: mouth.x - 1, y: mouth.y };
    }
    p.x = spot.x; p.y = spot.y;
    this.placePartyAround(floor, p);
    for (const m of this.livingMembers()) { m.dungeonId = TOWN_ID; m.floorIdx = 0; }
    this.charted = Array.from({ length: H }, () => Array(W).fill(false));
    this.seen = Array.from({ length: H }, () => Array(W).fill(true));
    this.computeVisibility();
    if (this.ui.setLocation) this.ui.setLocation('The Whetstone');
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
    this.advanceQueue();
  }

  /* THE COMPANY'S LEVEL, for a door that has an opinion about it.
   *
   * The average of the living, not the best of them: a level-13 fighter
   * dragging three fresh hirelings is not a level-13 company, and taking the
   * highest would let one veteran walk everyone into something that kills
   * them. Nor the lowest — one hireling should not bar the door.
   *
   * Rounded, not floored: a company of three 14s and a 13 averages 13.75, and
   * it is a level-14 company, not a level-13 one. Flooring it read them as 13
   * and shut them out of a sanctum pitched at their own leader — and since
   * nothing down here respawns, there is no grinding the fraction away. */
  companyLevel() {
    const live = this.livingMembers();
    if (!live.length) return (this.state.player && this.state.player.level) || 1;
    return Math.round(live.reduce((n, m) => n + (m.level || 1), 0) / live.length);
  }

  /* A written sanctum states the strength it was built for, and holds the
   * door until the company has it. The founding three are never gated: they
   * are unlocked in order by what you have killed, and a level gate on top of
   * that could only ever strand somebody between the two rules. */
  dungeonBarred(d) {
    if (!d || !d.minLevel) return null;
    if (this.baseDungeonIds().includes(d.id)) return null;
    const have = this.companyLevel();
    if (have >= d.minLevel) return null;
    return `${d.name} is shut to you. The way down is cut for a company of level ` +
      `${d.minLevel}; yours averages ${have}.`;
  }

  enterDungeon(id) {
    const d = this.dungeonById(id);
    if (!d) { this.log('That path is not written yet.'); return; }
    const barred = this.dungeonBarred(d);
    if (barred) { this.log(barred); return; }
    this.state.player.dungeonId = id;
    this.state.player.floorIdx = 0;
    if (!this.state.player.visitedDungeons[id]) {
      this.markCompany((m2) => {
        if (!m2.visitedDungeons) m2.visitedDungeons = {};
        m2.visitedDungeons[id] = true;
      });
      this.journal('The company first set foot in ' + d.name + '.');
      const arc = arcForDungeon(id);
      if (this.ui.showArrival) this.ui.showArrival(d);
      else this.log('— ' + d.name + ' —');
    } else {
      if (this.ui.setLocation) this.ui.setLocation(d.name + ' · ' + (this.state.player.floorIdx + 1) + '/' + d.floors);
    }
    /* The mouth remembers. Monsters do not respawn, so the floors above your
     * deepest mark are swept corridors and nothing else — the stairs take you
     * straight back to where the work stopped. Climbing UP still walks.
     *
     * But people LIVE on these floors, and the ones who ask things of you
     * live near the entrance: dropping the company four floors down turned
     * every hand-in into a climb. So when there is a choice to make, the
     * player makes it. */
    const p = this.state.player;
    const known = Math.min((p.deepest && p.deepest[id]) || 0, d.floors - 1);
    if (known > 0 && this.ui.askDepth) {
      this.ui.askDepth(d, known, (floorIdx) => this.arriveAtDepth(d, floorIdx));
      return;
    }
    this.arriveAtDepth(d, known);
  }

  arriveAtDepth(d, floorIdx) {
    if (floorIdx > 0) this.log('The upper halls are swept and the stairs are known — you descend to floor ' + (floorIdx + 1) + '.');
    this.loadFloor(floorIdx);
  }

  /* `arriveAt` says which end of the floor you come in at:
   *   'up'   — the up-staircase, which is where you land coming DOWN a flight
   *   'down' — the down-staircase, which is where you land coming UP one
   *   'keep' — exactly where you were, for a floor being rebuilt under you
   * It defaulted to 'up' unconditionally, so climbing a flight put you on the
   * stairs that go up AGAIN rather than on the ones you had just come down. */
  loadFloor(floorIdx, arriveAt = 'up') {
    const p = this.state.player;
    if (p.dungeonId === TOWN_ID) { this.loadTown(arriveAt); return; }
    const d = this.dungeonById(p.dungeonId);
    if (!d) return;
    this.snapshotFloor();   /* remember the floor we are stepping off */
    for (const m of (this.state.party && this.state.party.members) || []) {
      if (!m) continue;
      this.clearActorTurn(m);
      m.ini = undefined;   /* a new floor is a new encounter */
    }
    this._round = null;
    /* The breath at the stairs is paid for reaching somewhere NEW.
     *
     * loadFloor is also how you climb back up, how the camp button puts you
     * back and how a save is loaded, so paying it every time meant 15% of your
     * maximum health for walking up one flight and straight back down, over
     * and over, and another 15% on every page reload. Testing "am I going
     * down" alone does not fix that — down, up, down is still down twice. It
     * has to be deeper than you have ever been, which the run already tracks. */
    const deepestSoFar = (p.deepest && p.deepest[d.id] !== undefined) ? p.deepest[d.id] : -1;
    const wentDeeper = floorIdx > deepestSoFar;
    p.floorIdx = floorIdx;
    const isLast = floorIdx >= d.floors - 1;
    const boss = isLast ? (this.monsterTemplate(d.bossId) || null) : null;
    /* No boss means bossesSlain is never set, which means the dungeon can never
     * be cleared and the next one never unlocks. Say so rather than shrug. */
    if (isLast && !boss) console.warn(`[lapsai] dungeon "${d.id}" has no boss for bossId "${d.bossId}" — it cannot be cleared`);
    const pool = this.resolveMonsterPool(d, floorIdx);
    const npcs = npcsForDungeonFloor(d.id, floorIdx);
    const floor = generateFloor({
      /* Without this every character ever rolled walked the same twelve floors:
       * generateFloor falls back to hashSeed("temple:0") and the engine never
       * passed anything else. */
      seed: hashSeed(this.state.seed + ':' + d.id + ':' + floorIdx),
      dungeon: d, floorIdx, state: this.state,
      monsterPool: pool, boss, npcs,
      pickItem: (fi, rng) => this.pickItem(fi, rng),
      pickConsumable: (fi, rng) => this.pickConsumable(fi, rng),
      makeTreasure: (fi, rng) => this.makeTreasure(fi, rng),
    });
    if (boss && p.bossesSlain[d.id] && floor.monsters) {
      floor.monsters = floor.monsters.filter((m) => m.boss !== true);
    }
    const memo = this.floorMemo(d.id, floorIdx);
    this.applyFloorMemo(floor, memo);
    this.currentFloor = floor;
    this.placeOnArrival(floor, arriveAt);
    this.placePartyAround(floor, p);
    p.pending = undefined;
    this.markCompany((m2) => {
      if (!m2.deepest) m2.deepest = {};
      m2.deepest[d.id] = Math.max(m2.deepest[d.id] || 0, floorIdx);
    });
    this.seen = Array.from({ length: H }, () => Array(W).fill(false));
    this.vis = Array.from({ length: H }, () => Array(W).fill(false));
    this.charted = Array.from({ length: H }, () => Array(W).fill(false));
    this.restoreSeen(memo);   /* the map you drew stays drawn */
    this.secretsRevealed = false;
    this.turn = 0;
    this.fireBeats('enter', floorIdx);
    if (this.ui.setLocation) this.ui.setLocation(d.name + ' · ' + (floorIdx + 1) + '/' + d.floors);
    if (this.ui.showFloor) this.ui.showFloor(d, floorIdx, isLast);
    /* A flight of stairs is worth a breath, so arriving on a new floor at two
     * hit points is not an automatic death. Once per new depth — see above. */
    const der = this.derived();
    if (wentDeeper) {
      const breath = Math.max(1, Math.round(p.maxhp * DESCENT_RECOVERY));
      /* Mends the ceiling before the bar. Measured before this, the breath
       * fired 61 times and delivered zero hit points every time, because the
       * player was already full when they reached the stairs — a ceiling gives
       * it something to do. */
      this.mendWounds(Math.round(breath / 2), p);
      p.hp = Math.max(p.hp, Math.min(this.restedCap(p), p.hp + breath));
      p.power = Math.min(der.maxpower, p.power + Math.max(1, Math.round(der.maxpower * DESCENT_RECOVERY)));
    }
    this.questReached(d.id, floorIdx);
    this.log('You stand at the ' + (floorIdx === 0 ? 'entrance' : 'stairs') + ' of ' + d.name + '.');
    this.computeVisibility();
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
    /* The first round exists BEFORE the first keypress. Without this, a
     * monster's round-one slot and round-two opening both fired inside the
     * first input — the exact twice-in-a-window the stable order forbids. */
    this.advanceQueue();
  }

  /* HOW DEEP THIS FLOOR IS IN THE WHOLE DESCENT, not just in its own dungeon.
   *
   * The second dungeon's first floor is the FIFTH floor of the game and should
   * be harder than the fourth, not softer than the first — and it was softer
   * than the first: measured, the average monster on the Upper Reaches' opening
   * floor had 9 hit points against 17 on the Temple's last, and the commonest
   * thing you met on either was a Sewer Rat. Every dungeon restarted the curve
   * from zero because every dungeon counted its own floors from zero. */
  dungeonStartDepth(d, seen) {
    if (!d) return 0;
    const guard = seen || new Set();
    if (guard.has(d.id)) return 0;   /* a cycle in the chain is not fatal here */
    guard.add(d.id);
    const bases = this.baseDungeonIds();
    const at = bases.indexOf(d.id);
    if (at >= 0) {
      let depth = 0;
      for (let i = 0; i < at; i++) depth += (this.dungeonById(bases[i]) || {}).floors || 0;
      return depth;
    }
    /* Anything the Library wrote hangs off whatever it requires. */
    const req = d.requires || d.unlockAfter || bases[bases.length - 1];
    const first = Array.isArray(req) ? req[0] : req;
    const prev = this.dungeonById(first);
    if (!prev) return 0;
    return this.dungeonStartDepth(prev, guard) + (prev.floors || 0);
  }

  floorDepth(d, floorIdx) {
    return this.dungeonStartDepth(d) + (floorIdx || 0);
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
    /* Open the pool by TIER, not by a fraction of the list. Opening by fraction
     * ignores gaps in a bestiary, so wherever a dungeon's roster jumps — the
     * Temple's leap from tier 3 to tier 6, the Upper Reaches' from 5 to 11 —
     * a whole band of monsters arrived on one floor and built a wall there.
     *
     * The band has a FLOOR as well as a ceiling, and both ride the depth of
     * the whole descent. Without a floor every tier from zero up stayed in the
     * pool for ever, so Sewer Rats were still turning up on the last floor of
     * the second dungeon — and since the draw is weighted towards the gentlest
     * thing in the pool, they were the commonest thing there. */
    const depth = this.floorDepth(d, floorIdx);
    /* floor(), not round(): rounding made the ceiling climb two tiers between
     * one floor and the next wherever the fraction crossed a half, which put a
     * wall in the middle of a dungeon. */
    const want = Math.floor(2 + depth * 1.25);
    /* The CEILING is capped at the top of this dungeon's own roster, so the
     * band cannot float above everything the dungeon has to offer. The FLOOR
     * is not capped — it keeps rising, and only relaxes when it would leave
     * too little to build a floor from. Capping both is what made the Serpent's
     * four floors identical: the band stopped moving on its first one. */
    const topTier = sorted[sorted.length - 1].tier;
    const ceiling = Math.min(topTier, want);
    let bottom = Math.max(0, want - BAND_WIDTH);
    let inBand = sorted.filter((m) => m.tier >= bottom && m.tier <= ceiling);
    while (inBand.length < 3 && bottom > 0) {
      bottom--;
      inBand = sorted.filter((m) => m.tier >= bottom && m.tier <= ceiling);
    }
    if (inBand.length >= 3) return inBand;
    /* A roster with nothing in the band still needs something on the floor.
     * Take whatever sits NEAREST to it — taking the gentlest few instead is
     * how a dungeon full of trolls ended up putting out rats. */
    return [...sorted]
      .sort((a, b) => bandDistance(a.tier, bottom, ceiling) - bandDistance(b.tier, bottom, ceiling))
      .slice(0, Math.min(3, sorted.length))
      .sort((a, b) => a.tier - b.tier);
  }

  /* WHAT IS LYING ON THE FLOOR.
   *
   * The same three faults the monster pool had, and the same three fixes. It
   * banded on floorIdx, so every dungeon restarted the loot curve from
   * daggers; it took pools 0..top cumulatively, so the starting kit stayed in
   * the draw for ever; and the enchantment chance and size restarted too.
   * Measured before this: the Temple's last floor averaged 67 gold an item and
   * was 40% enchanted, and the Upper Reaches' first floor — the very next
   * floor a player walks — averaged 21 gold and was 80% drawn from the
   * dagger-and-mace table. */
  pickItem(floorIdx, rng) {
    const d = this.dungeonById(this.state.player.dungeonId) || {};
    const depth = this.floorDepth(d, floorIdx);
    const tierChance = Math.min(0.65, 0.08 + depth * 0.045 + rng.next() * 0.2);
    const pools = [
      /* potion-heal used to be in no pool at all — it survived only as a
       * fallback that could never fire, because the candidate list is never
       * empty. The whole shipped game therefore held ONE healing item. */
      { arr: ['dagger', 'short-sword', 'mace', 'staff', 'hand-axe', 'potion-heal', 'potion-heal'], max: 2 },
      /* scroll-identify was in NO pool — it existed in the data and had never
       * once dropped, the same bug shape as the one healing item. Now that
       * enchantment hides until read, it is the counter to the curse. */
      { arr: ['broadsword', 'war-hammer', 'padded-armor', 'leather-armor', 'small-shield', 'ring-protection', 'potion-heal', 'potion-power', 'scroll-identify'], max: 3 },
      { arr: ['battle-axe', 'studded-armor', 'chainmail', 'large-shield', 'ring-strength', 'amulet-ward', 'potion-major-heal', 'scroll-reveal', 'scroll-flame', 'scroll-identify', 'wand-of-fire'], max: 100 },
      { arr: ['two-handed-sword', 'scale-armor', 'plate', 'tower-shield', 'ring-arcana', 'amulet-seeing', 'amulet-luck', 'scroll-remove-curse', 'scroll-sanctuary', 'wand-of-healing', 'wand-of-frost'], max: 100 },
    ];
    /* Four tables across twelve floors, seen through a window two tables wide
     * that slides one table per dungeon — so a dungeon opens on what the last
     * one was ending with and closes on something new, and what you were
     * finding three floors ago stops turning up. Within the window the mix
     * shifts from the lower table to the upper one as the floors go by, so the
     * step is a slope rather than a door. */
    const SPAN = 4;
    const bottom = Math.min(pools.length - 2, Math.floor(depth / SPAN));
    const top = bottom + 1;
    const through = Math.min(1, (depth % SPAN) / (SPAN - 1));
    const cands = [];
    for (let i = Math.round((1 - through) * 3) + 1; i > 0; i--) cands.push(...pools[bottom].arr);
    for (let i = Math.round(through * 3) + 1; i > 0; i--) cands.push(...pools[top].arr);
    /* Generated items are drawn from the same table as hand-authored ones,
     * banded by their own tier so a tier-9 blade cannot turn up on floor one.
     * Without this, everything the Library made was unreachable. */
    const reach = (top + 1) * 2;
    for (const it of this.registry.items || []) {
      if (!it || !it.id) continue;
      const t = it.tier ?? 1;
      if (t <= reach && t >= bottom) cands.push(it.id);
    }
    let tpl = this.itemTemplate(rng.pick(cands) || 'potion-heal');
    if (!tpl) tpl = this.itemTemplate('potion-heal');
    const it = deepItem(tpl);
    const topTier = tpl.tier >= 3;
    const magicChance = tierChance + (topTier ? 0.12 : 0);
    /* The guard tested `kind`, but a potion's kind is 'potion' and only its
     * SLOT is 'consumable' — so enchantment was landing on potions and scrolls,
     * producing a "+2 Potion of Superior Healing" carrying a useless acBonus. */
    if (rng.chance(magicChance) && it.slot !== 'consumable' && it.kind !== 'special') {
      /* How big an enchantment can be also rides the whole descent: at one
       * per dungeon it reset to "+1 only" every time you walked through a
       * door. */
      const mag = 1 + Math.floor(rng.next() * Math.min(4, 1 + Math.floor(depth / 3)));
      /* A curse used to be a +2 sword you could not put down — the same
       * bonuses, plus an inconvenience, shown in red the moment it hit the
       * pack. Now it wears the same blue gleam and the same unread rune as a
       * blessing, with the enchantment run the other way. The rng draws are in
       * the old order (next, then chance) so seeded floors do not reshuffle. */
      if (rng.chance(0.15)) applyCurse(it, mag);
      else applyMagic(it, mag);
    }
    return it;
  }

  /* A floor that rolls no consumable at all is a floor you can only leave by
   * dying. One is guaranteed; the rest is chance. */
  pickConsumable(floorIdx, rng) {
    const shallow = ['potion-heal', 'potion-heal', 'potion-power'];
    const deep = ['potion-heal', 'potion-major-heal', 'potion-power', 'scroll-sanctuary', 'scroll-recall'];
    const pool = floorIdx >= 2 ? deep : shallow;
    const tpl = this.itemTemplate(rng.pick(pool)) || this.itemTemplate('potion-heal');
    return deepItem(tpl);
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
    const floor = this.currentFloor;
    if (!floor) return;
    /* Daylight: the town hides nothing from anyone. */
    if (this.inTown()) {
      this.vis = Array.from({ length: H }, () => Array(W).fill(true));
      this.seen = Array.from({ length: H }, () => Array(W).fill(true));
      /* Daylight hides nothing and hearsay has no place in it. */
      this.charted = Array.from({ length: H }, () => Array(W).fill(false));
      return;
    }
    this.vis = Array.from({ length: H }, () => Array(W).fill(false));
    const side = 17;
    /* The union of everyone's eyes: what any member can see, the party sees.
     * A party of one reduces to exactly the old loop. */
    const eyes = this.livingMembers();
    if (!eyes.length && this.state.player) eyes.push(this.state.player);
    for (const e of eyes) {
      const sight = this.derived(e).sight;
      const sx = Math.max(0, e.x - side), ex = Math.min(W - 1, e.x + side);
      const sy = Math.max(0, e.y - side), ey = Math.min(H - 1, e.y + side);
      for (let y = sy; y <= ey; y++) {
        for (let x = sx; x <= ex; x++) {
          if (this.vis[y][x]) continue;
          this.vis[y][x] = this.los(e.x, e.y, x, y, sight);
          if (this.vis[y][x]) {
            this.seen[y][x] = true;
            /* Seen with your own eyes: it stops being hearsay. */
            if (this.charted) this.charted[y][x] = false;
          }
        }
      }
    }
    if (this.monstersBurning !== false) {
      for (const m of (floor.monsters || [])) if (m && m.revealed) { this.vis[m.y][m.x] = true; this.seen[m.y][m.x] = true; }
    }
    this.hearTheDen();
  }

  /* THE DEN IS NOT SILENT.
   *
   * A last floor's boss stands behind one hidden door in the same place
   * every time — the west wall of the den frame, one step off the lane that
   * runs back to the stairs — and a search is a roll you have to think to
   * make against a wall that looks like every other wall.
   *
   * Everything else a secret gates is optional. The cache is loot, and
   * missing loot costs a player a shrug. This one gates the boss, and behind
   * the boss is the quest, the next dungeon and the end of the run: a roll
   * that never comes up, or a wall nobody thought to push, is not a puzzle
   * there. It is a save that cannot be finished, which is what the playtest
   * walked into on the fourth floor of the third dungeon.
   *
   * So the thing on the other side gives itself away. Come within a couple
   * of tiles of the only way in and you hear it through the rock — better
   * fiction than a blind roll against masonry, and every OTHER secret in the
   * game stays exactly as hard to find as it was. */
  hearTheDen() {
    const floor = this.currentFloor;
    const den = floor && floor.den;
    if (!den) return;
    const x = den.x - 1, y = den.y + Math.floor(den.h / 2);
    if (!this.inBounds(x, y) || floor.tiles[y][x] !== T.SECRET) return;
    if (!this.livingMembers().some((m) => dist8(m, { x, y }) <= 2)) return;
    floor.tiles[y][x] = T.DOOR_O;
    this.rememberDoor(x, y);
    this.log('Something on the far side of this wall draws breath. The seam gives.');
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

  /* No squeezing through the gap where two walls meet at a corner. Without
   * this, a diagonal step passes through solid rock. */
  canCorner(fromX, fromY, toX, toY) {
    const floor = this.currentFloor;
    if (!floor) return false;
    /* The two tiles a diagonal step slips between. At least one has to be
     * open, or the step passes through the corner where two walls meet. */
    const side = floor.tiles[fromY] && floor.tiles[fromY][toX];
    const over = floor.tiles[toY] && floor.tiles[toY][fromX];
    return (side !== undefined && isTravelable(side)) || (over !== undefined && isTravelable(over));
  }

  /* THE WHOLE FLOOR, DRAWN.
   *
   * `mapRevealed` was set here and read by NOTHING — the scroll turned up
   * the secret doors, said its line about ghost-lines, and left the map
   * exactly as dark as it found it. The map the renderer draws is `seen`,
   * so that is what a chart fills in: every tile remembered, none of it
   * lit, which is the difference between having walked a place and having
   * a map of it. Snapshotted like any other exploring, so it survives the
   * stairs and the save. */
  revealMap() {
    const floor = this.currentFloor;
    if (!floor || !this.seen) { this.log('There is no ground here to chart.'); return false; }
    let drawn = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.seen[y][x]) continue;
        /* Only ground worth drawing, and the walls that shape it — the
         * solid rock beyond is not a room anybody charts. */
        const t = floor.tiles[y][x];
        const near = (isTravelable(t) || isDoor(t));
        const edge = !near && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .some(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
            const q = floor.tiles[ny][nx];
            return isTravelable(q) || isDoor(q);
          });
        if (!near && !edge) continue;
        this.seen[y][x] = true;
        /* KNOWN, NOT WALKED. A chart is hearsay until you stand on it, and
         * after reading one there was no way to tell the two apart — "it is
         * impossible to know where you have been", which for a floor you are
         * halfway through is the whole use of a map. */
        if (this.charted) this.charted[y][x] = true;
        drawn++;
      }
    }
    this.revealSecrets();
    if (!drawn) { this.log('The chart shows you nothing you had not already walked.'); return false; }
    this.log('Ghost-lines crawl across the floor map: ' + drawn + ' tiles you had not seen.');
    this.snapshotFloor();   /* the drawing keeps, across the stairs and the save */
    this.computeVisibility();
    if (this.ui.render) this.ui.render(this);
    return true;
  }

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

  /* Nothing awake and hostile within CALM_RADIUS. Asleep monsters do not
   * count — you are only in a fight when something is in one with you. */
  outOfCombat() {
    const floor = this.currentFloor;
    const members = this.livingMembers();
    if (!members.length || !floor) return false;
    return !(floor.monsters || []).some((m) =>
      m.hp > 0 && m.aggro && members.some((mm) => dist1(m, mm) <= CALM_RADIUS));
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
    /* Cardinals on WASD and the arrows; diagonals on the vi keys, because the
     * number row belongs to the abilities. uiFlags.dx/dy carries the numpad. */
    let dx = { arrowleft: -1, a: -1, arrowright: 1, d: 1, y: -1, b: -1, u: 1, n: 1 }[k] || 0;
    let dy = { arrowup: -1, w: -1, arrowdown: 1, s: 1, y: -1, u: -1, b: 1, n: 1 }[k] || 0;
    if (uiFlags.dx !== undefined || uiFlags.dy !== undefined) {
      dx = uiFlags.dx || 0;
      dy = uiFlags.dy || 0;
    }
    if (dx !== 0 || dy !== 0) {
      /* The autopilot knows where its route CONTINUES past the next tile;
       * a slip past a companion should eject along the route, not blindly
       * straight — straight-through at a corner ping-ponged forever. */
      const exit = (uiFlags.exitDx !== undefined || uiFlags.exitDy !== undefined)
        ? { dx: uiFlags.exitDx || 0, dy: uiFlags.exitDy || 0 } : undefined;
      turn = this.tryMove(dx, dy, exit);
      if (turn && !this.dying) {
        /* A step spends ground; a blow or a search spends the standard.
         * endPlayerTurn knows which holds the turn open and which ends it.
         * `p` and not state.player: if the mover fell to the opening,
         * memberDown has already moved the reins, and the bill must still
         * go to the one who stepped. */
        this.endPlayerTurn(turn === 'step' || turn === 'swap' || turn === 'door' ? 'move' : undefined, p);
      }
      return !!turn;
    } else if (k === 'g') {
      /* The loot goes to the pack of whoever the sheets are OPEN ON — the
       * character in focus — not silently to whoever holds the reins. Out
       * of combat the company shares freely; mid-fight a pack across the
       * room is out of reach, and the loot stays with the taker. */
      let carrier = null;
      if (uiFlags.lootTo !== undefined) {
        const cand = this.state.party.members[uiFlags.lootTo];
        if (cand && cand !== p && cand.hp > 0) {
          if (!this.outOfCombat() && dist8(cand, p) > 1) {
            this.log(cand.name + ' is too far to hand it across a fight — you keep it.');
          } else {
            carrier = cand;
          }
        }
      }
      const got = this.tryPickup(p.x, p.y, true, carrier);
      /* Nothing to take is not nothing to learn: say what is here instead, so
       * the key teaches itself the first time someone presses it. */
      if (got) this.uiLog('Looted.');
      else this.lookAround();
    } else if (k === ' ' || k === 'x') {
      this.endPlayerTurn(undefined, p);
    } else if (k === 'r') {
      this.rest();
    } else {
      return false;
    }
    if (turn && !this.dying) this.endPlayerTurn(undefined, p);
    return turn;
  }

  /* Wait until healed, interrupted, or long enough that something is wrong.
   * Regeneration without this is twenty presses of the wait key. */
  rest(maxTurns = 200) {
    const p = this.state.player;
    if (!this.outOfCombat()) { this.log('Not with something awake this close.'); return false; }
    const der = this.derived();
    /* "As rested as this place allows" is literally true now: resting ends at
     * the rested line, not at the top of the bar. It is still free, still
     * unlimited and still one keypress — it is just shorter. */
    /* The whole company sits down together, and sits until the LAST of them
     * has rested all they can — a member is not left half-mended because the
     * one at the reins happened to fill first. */
    const rested = (m) => m.hp >= this.restedCap(m) && m.power >= this.derived(m).maxpower;
    const allRested = () => this.livingMembers().every(rested);
    if (allRested()) {
      this.log('You are as rested as this place allows.');
      if (p.wounds > 0) this.log('The worst of it will not close on its own: ' + p.wounds + ' hit points beyond your reach.');
      return false;
    }
    let turns = 0;
    /* Sitting down mends at the OLD pace — every tick, not every tenth.
     * The slow trickle is for walking wounded; rest is the deliberate act,
     * and it would otherwise take two hundred turns to close what one
     * keypress promises. */
    this._resting = true;
    try {
      while (turns < maxTurns && !this.dying) {
        if (allRested()) break;
        if (!this.outOfCombat()) { this.log('Something stirs — you are on your feet again.'); break; }
        this.endPlayerTurn();
        turns++;
      }
    } finally {
      this._resting = false;
    }
    if (turns) this.log('You sit against the stone for a while. (' + turns + ' turns)');
    /* Mending: the best mender in the company closes wounds nothing else
     * reaches, for everyone, once per sit-down. This is the skill's whole
     * promise — wounds were the one number resting could not touch. */
    const mender = Math.max(...this.livingMembers().map((m) => this.skillRank(m, 'mending')), 0);
    if (mender > 0) {
      let closed = 0;
      for (const m of this.livingMembers()) closed += this.mendWounds(mender, m);
      if (closed) this.log('Practiced hands close what sitting cannot: ' + closed + ' wound' + (closed === 1 ? '' : 's') + ' mended.');
    }
    if (p.wounds > 0) {
      this.log('You have rested all you can. What is left of this needs mending, not sitting — ' +
        p.wounds + ' hit points beyond your reach.');
    }
    return true;
  }

  tryMove(dx, dy, exit) {
    const p = this.state.player;
    const floor = this.currentFloor;
    const nx = p.x + dx, ny = p.y + dy;
    /* You turn the way you push, whether or not the push goes anywhere —
     * the renderer reads this to face the body where it last meant to go. */
    p.faceDx = dx; p.faceDy = dy;
    if (!this.inBounds(nx, ny)) { this.log('The dark walls give no ground.'); return false; }
    const tile = floor.tiles[ny][nx];

    const mo = floor.monsters.find((m) => m.x === nx && m.y === ny);
    if (mo) {
      this.attackMonster(mo);
      return 'strike';
    }
    /* Walking into a companion. Blocking outright would deadlock a corridor;
     * the old answer — swap, always — displaced whoever you brushed, churned
     * the column on the march, and mid-fight could hand a mage the exact
     * square the fighter was holding. Three answers now, in order:
     *
     *   PASS  — the tile beyond them is open: you slip through, they never
     *           move. Two tiles of ground for you, nothing for them.
     *   SHOVE — no room beyond: you take their square and they give ground
     *           to the free neighbouring tile farthest from the fight.
     *   SWAP  — nowhere to give: the classic trade, corridors stay passable. */
    const ally = this.memberAt(nx, ny);
    if (ally && ally !== p) {
      const tile2 = floor.tiles[ny][nx];
      if (dx && dy && !this.canCorner(p.x, p.y, nx, ny)) {
        this.log('The corner is too tight to slip through.');
        return false;
      }
      const open = (x, y, fromX, fromY) => {
        if (!this.inBounds(x, y)) return false;
        const t = floor.tiles[y][x];
        if (!isTravelable(t)) return false;
        const ddx = x - fromX, ddy = y - fromY;
        if (ddx && ddy && !this.canCorner(fromX, fromY, x, y)) return false;
        if (this.memberAt(x, y)) return false;
        if ((floor.monsters || []).some((m2) => m2.hp > 0 && m2.x === x && m2.y === y)) return false;
        if ((floor.npcs || []).some((n) => n.x === x && n.y === y)) return false;
        return true;
      };
      /* A tile worth STANDING ON is a destination, not a doorway: stairs,
       * an altar, anything lying there. Slipping past would carry you over
       * the very thing you were stepping onto — the stair "not working"
       * because the van was standing on it, and the walker ping-ponging
       * through the friend forever while the camera shook. */
      const worth = tile2 === T.UP || tile2 === T.DOWN || tile2 === T.ALTAR ||
        (floor.items || []).some((it) => it.x === nx && it.y === ny);
      /* Where the slip ejects: along the route's continuation when the
       * autopilot knows it, straight ahead when the keyboard does not. */
      const ex = exit && (exit.dx || exit.dy) ? exit : { dx, dy };
      const bx = nx + ex.dx, by = ny + ex.dy;
      if (!worth && open(bx, by, nx, ny)) {
        /* PASS. The opening is paid once, at the tile you left; in combat
         * the second tile of ground is paid for too. */
        if (!this.provokeShift(p)) return 'swap';
        if (!this.outOfCombat()) {
          this.actorTurn(p).moved = (this.actorTurn(p).moved || 0) + 1;
          this.log('You slip past ' + ally.name + '.');
        }
        p.x = bx; p.y = by;
        if (isSlowGoing(floor.tiles[by][bx])) this.wadeInto(bx, by);
        this.stepOn(bx, by);
        return 'swap';
      }
      if (!this.provokeShift(p)) return 'swap';   /* cut down mid-shuffle */
      /* SHOVE, or failing that SWAP: the displaced member goes to the open
       * tile beside them farthest from anything awake — never toward the
       * fight — and only lands back on your own square when nothing else
       * will have them. */
      const threats = (floor.monsters || []).filter((m2) => m2.hp > 0 && m2.aggro && !m2.submerged);
      const clearOf = (x, y) => threats.length ? Math.min(...threats.map((m2) => dist8(m2, { x, y }))) : 9;
      let spot = { x: p.x, y: p.y, score: clearOf(p.x, p.y) * 4 };   /* the swap, as the floor to beat */
      for (const [adx, ady] of DIRS8) {
        const ax = nx + adx, ay = ny + ady;
        if (ax === p.x && ay === p.y) continue;
        if (!open(ax, ay, nx, ny)) continue;
        /* Farther from the fight first; along the push, for the tie. */
        const score = clearOf(ax, ay) * 4 + (adx === dx && ady === dy ? 2 : 0) + 1;
        if (score > spot.score) spot = { x: ax, y: ay, score };
      }
      const swapped = spot.x === p.x && spot.y === p.y;
      ally.faceDx = Math.sign(spot.x - nx) || -dx;
      ally.faceDy = Math.sign(spot.y - ny) || -dy;
      ally.x = spot.x; ally.y = spot.y;
      p.x = nx; p.y = ny;
      if (!this.outOfCombat()) {
        this.log(swapped
          ? 'You trade places with ' + ally.name + ' — there is nowhere else to stand.'
          : ally.name + ' gives ground as you shoulder past.');
      }
      if (isSlowGoing(tile2)) this.wadeInto(nx, ny);
      /* You STOOD on it, so it happens: the stair ascends, the gem reports,
       * the altar hums. Swaps never stepped on what they landed on, which
       * is how a staircase could be broken by a friend standing on it. */
      this.stepOn(nx, ny);
      return 'swap';
    }
    const npc = (floor.npcs || []).find((n) => n.x === nx && n.y === ny);
    if (npc) {
      if (this.ui.openDialogue) this.ui.openDialogue(npc);
      return false;
    }
    if (tile === T.DOOR_C) {
      floor.tiles[ny][nx] = T.DOOR_O;
      this.rememberDoor(nx, ny);
      this.log('A heavy door groans open.');
      /* WHAT HEARS A DOOR.
       *
       * Everything within ten tiles of it used to — through solid rock, and
       * whether or not it was alive. Ten is wider than CALM_RADIUS, so any
       * door in a populated quarter of a floor put the company into combat
       * with something it could not see, could not reach, and which could
       * not reach it; corpses woke too. And the only thing said about it was
       * that a door had opened, so what the playtest saw was doors invoking
       * combat mode for no stated reason.
       *
       * The rule the water already uses is the right one: six tiles, the
       * living only, rousing SPOKEN aloud. Two things sound needs that sight
       * does not — the door is open by now, so what can see through the gap
       * hears through it, and whatever is close enough to touch the jamb
       * hears it around any corner. Bosses go on sleeping; they always did. */
      let roused = 0;
      for (const m of floor.monsters) {
        if (m.hp <= 0 || m.aggro || m.boss) continue;
        /* A power you stand with calls its own off: door or no door, a friend
         * of the toll or the garrison is not worth their notice. */
        if (this.pacifiedToward(m)) continue;
        const d = dist1(m, { x: nx, y: ny });
        if (d > DOOR_NOISE) continue;
        if (d > 2 && !this.los(nx, ny, m.x, m.y, DOOR_NOISE)) continue;
        m.aggro = true;
        m.lastSeen = this.turn;
        roused++;
      }
      if (roused) this.log('The groan carries — something in the dark hears it.');
      return 'door';
    }
    if (!isTravelable(tile)) {
      /* Searching happens where you push, not floor-wide: bumping a wall gives
       * one roll against the tile in front of you. */
      if (tile === T.SECRET && this.searchSecretAt(nx, ny)) return 'search';
      this.log(tile === T.WALL || tile === T.SECRET ? 'The way is blocked.' : 'You cannot pass here.');
      return false;
    }
    if (dx && dy && !this.canCorner(p.x, p.y, nx, ny)) {
      this.log('The corner is too tight to slip through.');
      return false;
    }
    if (!this.provokeShift(p)) return 'step';   /* the opening was fatal */
    p.x = nx; p.y = ny;
    if (isSlowGoing(tile)) this.wadeInto(nx, ny);
    this.stepOn(nx, ny);
    return 'step';
  }

  /* ATTACKS OF OPPORTUNITY, the member's half. Leaving a square something
   * hostile threatens gives it one free blow, once per round per creature —
   * with one mercy: a single careful step, and no more, is the shift, and
   * the shift is free. The mercy is PROVISIONAL: take a second step this
   * turn and the creatures you slipped past on the first collect after all,
   * which is the 3.5 rule this chapter is named for. Returns false if the
   * opening killed the mover, so the caller can abandon the move. */
  provokeShift(mover) {
    if (this.outOfCombat()) return true;
    const at = this.actorTurn(mover);
    const here = (this.currentFloor.monsters || []).filter((m) =>
      m.hp > 0 && m.aggro && !(m.stunned > 0) && !m.submerged && dist8(m, mover) <= 1);
    /* The debts live on the Game, not the actors: they are runtime-only,
     * and refs from a member's save to a monster's (and back) would tie the
     * save file in a circle. Only one member is ever mid-turn. */
    if ((at.moved || 0) < 1) {
      this._memberShiftDebt = here;
      return true;
    }
    const owed = [...(this._memberShiftDebt || []), ...here];
    this._memberShiftDebt = null;
    for (const m of owed) {
      if (m.hp <= 0 || m.aooTurn === this.turn) continue;
      m.aooTurn = this.turn;
      this.log('The ' + m.t.name + ' seizes the opening!');
      this.monsterOpportunity(m, mover);
      if (this.dying || mover.hp <= 0) return false;
    }
    return true;
  }

  /* One plain swing, outside the creature's own turn: no routine, no arms
   * for the whole company — an opening is one blow wide. */
  monsterOpportunity(m, target) {
    const der = this.derived(target);
    const r = this.rngOfTurn();
    const dc = Math.max(1, 20 - der.ac);
    const raw = r.d(20);
    if (raw !== 20 && raw + m.toHit < dc) {
      this.log('The blow whistles past ' + this.nameOf(target) + '.');
      return;
    }
    const dmg = this.rollDamage({ dice: m.dmg.dice, sides: m.dmg.sides, bonus: m.dmg.bonus }, m.t);
    this.log('The ' + m.t.name + ' hits ' + this.nameOf(target) + ' for ' + dmg + ' hit points.');
    this.damageMember(target, dmg, m);
  }

  /* The company's half of the same law. A monster stepping out of a
   * member's reach is struck at by that member — one opening per member
   * per round, spent from their turn state. */
  memberOpportunity(member, mo) {
    /* A hidden member lets the moment pass: a reflex swing would spend the
     * shadow on a graze when it was saved for a throat. */
    if (member.buffs && member.buffs.shadow > 0) return;
    const at = this.actorTurn(member);
    if (at.aoo) return;
    at.aoo = true;
    const der = this.derived(member);
    const r = this.rngOfTurn();
    const dc = Math.max(1, 20 - mo.t.ac);
    const raw = r.d(20);
    const who = member === this.state.player ? 'You seize' : member.name + ' seizes';
    this.log(who + ' the opening as the ' + mo.t.name + ' turns!');
    if (raw !== 20 && raw + der.toHit < dc) {
      this.log('The blow goes wide.');
      return;
    }
    const dmg = this.rollDamage(der.dmg, mo.t);
    this.log((member === this.state.player ? 'You strike' : member.name + ' strikes') +
      ' the ' + mo.t.name + ' for ' + dmg + ' hit points.');
    this.applyDamageToMonster(mo, dmg, false, der);
  }

  /* FLANKING: +2 to hit when an ally stands roughly opposite the attacker
   * across the target — the pincer the tokens were built for. The dot
   * product test admits true opposites and the near-opposite diagonals,
   * and refuses anyone on the attacker's own side. */
  flankBonus(attacker, target, allies) {
    for (const a of allies || []) {
      if (!a || a === attacker || a.hp <= 0) continue;
      if (dist8(a, target) > 1) continue;
      const dot = (attacker.x - target.x) * (a.x - target.x) +
                  (attacker.y - target.y) * (a.y - target.y);
      if (dot <= -1) return 2;
    }
    return 0;
  }

  /* Water is crossable, but you flounder: the turn costs double and the noise
   * carries. Making it impassable was severing whole sewer floors. */
  wadeInto(x, y) {
    /* THE DROWNED SISTERS stand in cold water twice a day and will warn
     * anyone off the deep channels for nothing. A company they have taken to
     * has been told which ones those are: the water is still loud, and it
     * still wakes what is lying in it, but it no longer costs the ground. */
    const taught = this.standing('drowned-sisters') > 0;
    this.log(taught
      ? 'You take the channel the Sisters named — loud, but sure-footed.'
      : 'You wade into black water — slow going, and loud.');
    /* MID-FIGHT the cost is GROUND, not the turn: a step into water eats a
     * second tile of the mover's speed, so a fighter's three tiles carry
     * them two through the drains and a thief's five carry two and a half.
     * Nothing here touches the standard action — you may still swing from
     * the water at no penalty. Out of combat the old surcharge stands:
     * everything hostile moves twice while you flounder. */
    if (taught) {
      /* Nothing is added to the cost — but the noise below still carries. */
    } else if (!this.outOfCombat()) {
      const at = this.actorTurn();
      at.moved = (at.moved || 0) + 1;
    } else {
      this.actorTurn().wading = true;
    }
    let roused = 0;
    for (const m of (this.currentFloor.monsters || [])) {
      if (m.hp <= 0) continue;
      const near = dist1(m, { x, y }) <= 6;
      /* Even the splash carries no weight with a power that counts you its
       * own — though what lies in the water still hears it, and answers. */
      if (!m.aggro && near && !this.pacifiedToward(m)) { m.aggro = true; m.lastSeen = this.turn; roused++; }
      /* Whatever is lying in the same water certainly hears it. */
      if (m.submerged && near) this.surface(m);
    }
    if (roused) this.log('Something in the dark hears the splashing.');
  }

  /* Up it comes. Kept in one place because three things can trigger it: coming
   * within reach, splashing into the water it is lying in, and being hit. */
  surface(m) {
    if (!m || !m.submerged) return;
    m.submerged = false;
    m.aggro = true;
    m.lastSeen = this.turn;
    this.log('The water breaks — a ' + m.t.name + '!');
  }

  /* One roll against one tile. Thieves are better at it; True Seeing skips it. */
  searchSecretAt(x, y) {
    const p = this.state.player;
    const floor = this.currentFloor;
    if (!p || !floor || floor.tiles[y][x] !== T.SECRET) return false;
    if (this.derived().seeSecrets) { this.revealSecretAt(x, y); return true; }
    const keen = this.passives().some((a) => a.findsSecrets);
    /* Fieldcraft: hidden doors give themselves up sooner under practiced
     * hands — a tenth per rank, on top of whatever the calling knows. */
    /* THE KEEPERS OF THE COILS will teach the halls to anybody who asks —
     * honestly, at length, and with the survey open. Standing with Venn's
     * office is thirty years of somebody else's measuring, and it shows in
     * the hands: a seam you would have walked past gives itself up. */
    const surveyed = this.standing('keepers-coils') * 0.12;
    const odds = Math.min(0.9, (keen ? 0.35 : 0.12) + p.level * 0.03 +
      this.skillRank(p, 'fieldcraft') * 0.10 + surveyed);
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
      /* In town, a stair down is a dungeon's mouth: step in and you are
       * under that world's first floor. */
      if (this.inTown()) {
        const mouth = (floor.mouths || []).find((m) => m.x === x && m.y === y);
        if (mouth) { this.enterDungeon(mouth.dungeonId); return; }
      }
      /* Only something at your heels stops you — anything further off can be
       * outrun, and anything walled off must not hold the stairs forever. */
      const atYourHeels = (floor.monsters || []).some((m) => m.hp > 0 && m.aggro && dist8(m, p) <= 2);
      if (atYourHeels) { this.log('Something at your heels bars the descent.'); return; }
      this.log('You descend.');
      if (this.ui.prepareTransition) this.ui.prepareTransition();
      this.loadFloor(p.floorIdx + 1);
      return;
    }
    if (tile === T.UP) {
      if (p.floorIdx === 0) {
        this.log('You climb back to the sunlit world above.');
        this.enterTown(p.dungeonId);
        return;
      }
      this.log('You ascend.');
      this.loadFloor(p.floorIdx - 1, 'down');
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
      [T.WATER]: 'Black water, deeper than it looks. Slow going, and it carries the sound.',
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

    const npc = ((floor.npcs) || []).find((n) => dist8(n, p) <= 1);
    if (npc) this.log((npc.tpl ? npc.tpl.name : 'Someone') + ' stands beside you — walk into them to speak.');
  }

  /* An altar gives once, to each character, on each floor: the old rites still
   * work, which is the point the world keeps making. */
  useAltar(x, y) {
    const p = this.state.player;
    const memo = this.currentMemo();
    /* Keyed per character, so one altar serves each member of a party once —
     * a bare "x,y" from an older save still counts as spent. */
    const key = x + ',' + y + '#' + (p.name || '');
    if (memo) {
      if (!memo.altars) memo.altars = [];
      if (memo.altars.includes(key) || memo.altars.includes(x + ',' + y)) {
        this.log('The altar is cold. It gave what it had.');
        return;
      }
      memo.altars.push(key);
    }
    const der = this.derived();
    const wounded = p.wounds || 0;
    const healed = Math.min(p.maxhp - p.hp, Math.max(1, Math.round(p.maxhp * 0.35)));
    const restored = Math.min(p.maxpower - p.power, Math.max(1, Math.round(der.maxpower * 0.5)));
    const cursedHere = [...p.inventory, ...Object.values(p.equipment || {})].some((it) => it && it.cursed);
    /* Do not spend a one-shot on someone who needs nothing from it. */
    if (healed <= 0 && restored <= 0 && !cursedHere && wounded <= 0) {
      this.log('An altar, still kept. You have nothing to ask it for yet.');
      if (memo && memo.altars) memo.altars = memo.altars.filter((k) => k !== key);
      return;
    }
    /* Wounds close FIRST, so the 35% is measured against a bar that is whole
     * again. This is the altar's whole point now: it is the only free thing in
     * the dungeon that reaches what sitting down cannot. */
    const lifted = this.mendWounds(wounded, p);
    if (lifted > 0) this.log('What would not close, closes. (+' + lifted + ' HP you can reach again)');
    p.hp = Math.min(p.maxhp, p.hp + healed);
    p.power = Math.min(p.maxpower, p.power + restored);
    this.log('You set your hands on the altar. Someone kept this rite up long after the last of them stopped being paid.');
    const gains = [healed > 0 ? '+' + healed + ' HP' : '', restored > 0 ? '+' + restored + ' PWR' : ''].filter(Boolean);
    if (gains.length) this.log('The old words answer: ' + gains.join(', ') + '.');
    /* The rite kept, here, once. An undertaking that asks for it counts the
     * altar, not the asking — one mark per distinct altar, whoever knelt. */
    this.questAltarUsed(p.dungeonId + ':' + p.floorIdx + ':' + x + ',' + y);
    const cursed = [...p.inventory, ...Object.values(p.equipment || {})].filter((it) => it && it.cursed);
    if (cursed.length) {
      this.removeAllCurses();
      this.log('What was bound to you is not, any more.');
    }
  }

  tryPickup(x, y, manual, who) {
    const floor = this.currentFloor;
    const here = (floor.items || []).filter((it) => it.x === x && it.y === y);
    let got = 0;
    for (const it of here) {
      if (manual || it.auto) {
        if (this.pickupItem(it.i, who)) {
          got++;
          this.rememberTake(it);
          this.forgetDrop(it);
          floor.items = floor.items.filter((f) => f !== it);
        }
      }
    }
    return got > 0;
  }

  pickupItem(it, who) {
    const p = who || this.state.player;
    const me = p === this.state.player;
    if (!it) return false;
    if (it.kind === 'special') {
      const v = Math.round((it.value || 10) * this.goldMul());
      this.earnGold(v);
      this.uiLog((me ? 'Picked up ' : p.name + ' pockets ') + v + ' gold' + (it.name && it.name !== 'Pile of Gold' ? ' (' + it.name + ')' : '') + '.');
      return true;
    }
    if (p.inventory.length >= PACK_LIMIT) {
      this.log(me ? 'Your pack is full.' : p.name + '’s pack is full.');
      return false;
    }
    p.inventory.push(it);
    /* THE LORE-WEAVERS keep everything that was ever written, and a company
     * they count as their own finds the Archive reading over its shoulder:
     * what it lifts, it can already name. The motes off a Ring of the Archive
     * are scrapings from pages they were forbidden to copy — this is what
     * those pages know. */
    if (it.identified === false) {
      if (this.standing('lore-weavers') > 0) {
        this.revealItem(it);
        this.log('The Archive names it before you can ask: ' + it.name + '.');
      } else {
        /* Lore: a chance per rank that the thing is recognised the moment it
         * is lifted — the label read on the spot instead of at the Lector's fee. */
        const lore = Math.max(...this.livingMembers().map((m) => this.skillRank(m, 'lore')), 0);
        if (lore > 0 && this.rngOfTurn().chance(0.15 * lore)) {
          this.revealItem(it);
          this.log('A practiced eye knows it at once: ' + it.name + '.');
        }
      }
    }
    this.refreshQuestProgress();
    const idk = !it.identified ? ' unknown' : '';
    /* Name the pack, always. "You take: Scroll of Cartography" and then
     * not finding it is a mystery; "it goes in Porter's pack" is not. */
    this.uiLog((me ? 'You take: ' : p.name + ' takes: ') + it.name + idk + '.' +
      (me ? '' : ' (' + p.name + '\u2019s pack)'));
    return true;
  }

  /* ---- combat ---- */
  attackMonster(m) {
    this.breakSanctuary();
    const p = this.state.player;
    /* The blow from the dark: +4 to land it, twice the depth when it does,
     * and the hiding ends with the swing — landed or not, you are seen. */
    const shadowed = !!(p.buffs && p.buffs.shadow > 0);
    if (shadowed) delete p.buffs.shadow;
    const der = this.derived();
    const r = this.rngOfTurn();
    let raw = r.d(20);
    const dc = Math.max(1, 20 - m.t.ac);
    /* The pincer: an ally roughly opposite you across the target is worth
     * +2 — the reason a company spreads around a boss instead of queueing. */
    const flank = this.flankBonus(this.state.player, m, this.livingMembers()) + (shadowed ? 4 : 0);
    let hit = raw === 20 || raw + der.toHit + flank >= dc;

    /* The Lucky Coin was carrying a number nothing read. It buys one second
     * look at a blow that missed. */
    if (!hit && der.luck > 0 && r.chance(Math.min(0.6, der.luck * 0.15))) {
      raw = r.d(20);
      hit = raw === 20 || raw + der.toHit + flank >= dc;
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
    if (shadowed) dmg *= 2;
    this.log(shadowed
      ? 'From the shadows — your blade finds the ' + m.t.name + ' for ' + dmg + ' hit points.'
      : 'You strike the ' + m.t.name + ' for ' + dmg + ' hit points.' + (flank ? ' The pincer tells.' : ''));
    /* A blow landed with a focus draws power back through it. Paid BEFORE the
     * damage, because killing the thing ends the floor's business and the blow
     * should still have been worth striking. This is what turns a Mage out of
     * power from a commoner with a stick into a Mage winding up. */
    if (der.focusPower > 0 && this.isFocusWeapon(this.state.player.equipment.weapon)) {
      const drawn = this.gatherPower(der.focusPower, der);
      if (drawn > 0) this.log('The focus drinks: +' + drawn + ' PWR.');
    }
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
    this.surface(m);
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
    /* Dead is dead on the creature as well as on the floor. Every caller
     * until now arrived through applyDamageToMonster, which had already
     * taken the hp below zero, so this was true by luck rather than by
     * rule — and a finisher that kills WITHOUT rolling damage is the first
     * caller that does not. Anything still holding the reference (a round
     * order, a shift debt, a quest tally) reads hp, not the floor list. */
    if (m.hp > 0) m.hp = 0;
    this.state.totalKills = (this.state.totalKills || 0) + 1;
    const cleaves = this.hasPassive('cleave') && !this.actorTurn().cleaved;
    if (m.boss) this.onBossSlain(m);
    const xp = m.xp || 10;
    this.log('The ' + m.t.name + ' is slain!');
    this.gainXP(xp);
    const goldMin = m.goldMin || 0, goldMax = m.goldMax || 0;
    if (goldMax > 0) {
      const g = Math.round(this.rngOfTurn().int(goldMin, goldMax) * this.goldMul());
      this.earnGold(g);
      this.log('You strip ' + g + ' gold from the corpse.');
    }
    this.rememberKill(m);
    this.questKilled(m.t && m.t.id);
    floor.monsters = floor.monsters.filter((x) => x !== m);

    /* Cleave, the Fighter's level-1 passive: 'slaying a foe grants one bonus
     * attack this turn'. It was set to false in three places and never once
     * set to true. The blade carries into another adjacent foe at once — a
     * bonus ATTACK, not a bonus turn that could be spent walking away. */
    if (cleaves) {
      const next = (floor.monsters || []).find((o) => o.hp > 0 && dist8(o, p) <= 1);
      if (next) {
        this.actorTurn().cleaved = true;   /* set before the swing: no chains */
        this.log('Your blade carries.');
        this.attackMonster(next);
      }
    }
  }

  onBossSlain(m) {
    const p = this.state.player;
    const d = this.dungeonById(p.dungeonId);
    this.uiLog('The great ' + m.t.name + ' crashes down like a struck bell.');
    this.journal('The great ' + m.t.name + ' fell' + (d ? ', and ' + d.name + ' went quiet' : '') + '.');
    this.markCompany((m2) => {
      if (!m2.bossesSlain) m2.bossesSlain = {};
      if (!m2.explored) m2.explored = {};
      m2.bossesSlain[p.dungeonId] = true;
      m2.explored[p.dungeonId] = true;
    });
    /* A boss falling is the only way a `cleared` objective ever moves — read
     * the live undertakings now, so the capstone closes the moment the last
     * sanctum goes quiet rather than on the next errand. */
    this.refreshQuestProgress();
    this.fireBeats('boss', p.floorIdx);
    /* 'finish' was documented, written for, and never fired by anything. */
    this.fireBeats('finish', p.floorIdx);
    const next = this.baseDungeonIds();
    const idx = next.indexOf(p.dungeonId);
    if (idx >= 0 && idx < next.length - 1) {
      const opened = this.dungeonById(next[idx + 1]);
      if (opened) {
        /* The unlock was one log line in the middle of a boss kill, and a
         * player who missed it walked back into the cleared mouth and
         * wondered why the world had stopped. Say it durably. */
        this.journal('The way into ' + opened.name + ' opened — its mouth stands in the Whetstone\u2019s east field.');
        if (this.ui.unlock) this.ui.unlock(opened);
      }
    }
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
          gold: this.purse(),
          kills: this.state.totalKills,
        });
      }
    }
    if (this.opts.onAllBaseCleared) this.opts.onAllBaseCleared();
  }

  /* Experience is SPLIT among the living, the classic way — a party of four
   * levels at a quarter of a soloist's pace and covers four bodies for it. A
   * party of one takes the whole share, so nothing solo changes. */
  /* EXPERIENCE IS NOT DIVIDED.
   *
   * It was split among the living — "the classic way" — and the classic
   * way assumes a world tuned for a party. Ours is not: every tier band
   * and every boss in this game was fitted against what a SINGLE
   * character earns walking down, and the split was added when the party
   * landed without refitting any of it. Measured: clearing the Temple and
   * the Upper Reaches yields 17,059 XP, which takes a lone adventurer to
   * level 10 and each of a company of four to level SIX — and the third
   * dungeon opens with tier 9-11 monsters and a boss tuned for 14. That
   * is the whole of "my level 6 fighter constantly misses a Gorgon": he
   * is four levels below the ground he is standing on, because he brought
   * friends.
   *
   * So the whole award goes to each of the living. Hiring a companion is
   * a tactical choice about bodies on the board — it must never be a tax
   * on levelling, which is exactly what it had become. The fallen earn
   * nothing, which is still the classic rule and the one that matters. */
  gainXP(xp) {
    const members = this.livingMembers();
    if (!members.length) return;
    const award = Math.max(1, Math.round(xp));
    for (const m of members) {
      m.xp += award;
      while (m.xp >= XP_FOR_LEVEL(m.level)) {
        m.xp -= XP_FOR_LEVEL(m.level);
        this.levelUp(m);
      }
    }
  }

  levelUp(who) {
    const p = who || this.state.player;
    p.level++;
    /* A level teaches one thing outside of fighting, spent where its owner
     * chooses — the Arcanum point, one a level, no banking limit. */
    p.skillPoints = (p.skillPoints || 0) + 1;
    const c = CLASSES[p.cls] || CLASSES.fighter;
    const hpGain = this.rngOfTurn().d(Math.max(2, c.hpDie)) + Math.max(0, abilityMod(p.stats.con));
    p.maxhp += Math.max(1, hpGain);
    p.hp = Math.min(p.maxhp, p.hp + Math.max(1, hpGain));
    p.maxpower = this.computeMaxPower(p);
    p.power = Math.min(p.maxpower, p.power + this.computeMaxPower(p));
    this.uiLog((p === this.state.player ? 'You grow wise and strong — ' : p.name + ' grows wise and strong — ') +
      CLASSES[p.cls].name + ' level ' + p.level + '!');
    this.journal(p.name + ' reached level ' + p.level + '.');
    /* A condition beat is pinned to a floor, but level-ups happen wherever they
     * happen — an exact match meant the beat only fired if you happened to
     * level on that one floor. Fire everything at or above your current depth;
     * beatsSeen keys off the beat's own floor, so each still fires once. */
    for (let f = 0; f <= p.floorIdx; f++) this.fireBeats('condition', f);
    if (this.ui.refreshStats) this.ui.refreshStats(this);
  }

  /* ---- turn loop ---- */
  /* THE ROUND.
   *
   * endPlayerTurn no longer means "and now everything else happens" — it means
   * THIS MEMBER'S ACTION IS SPENT. In a party of one that is the whole round,
   * and the sequence below is byte-identical to what it replaced. With several
   * members, control passes to the next one who has not yet acted, and the
   * monsters wait until the last of them has moved — which is the shape the
   * initiative review said to build: a queue the player can SEE, because with
   * more than one of you "whose turn is it" is on the screen.
   *
   * Six call sites spend an action (move, wait, search, item, ability, rest);
   * none of them needs to know any of this. */
  memberSpeed(m) {
    const c = CLASSES[(m || this.state.player).cls];
    return (c && c.speed) || 3;
  }

  monsterInReach(member) {
    return (this.currentFloor.monsters || []).some((m) =>
      m.hp > 0 && m.aggro && !m.submerged && dist8(m, member) <= 1);
  }

  /* The turn holds without the round moving: the world repaints, control
   * stays with the same member. This is what a step in combat costs now —
   * ground, not the whole action. */
  midTurn() {
    this.computeVisibility();
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
  }

  /* In combat a member's turn is MOVEMENT AND A BLOW, the way the game this
   * chapter is named for played it: ground up to your speed, one standard
   * action, in the order you choose. A step (kind 'move') holds the turn
   * open while ground remains — or while something stands in reach, so a
   * full advance still ends in a swing rather than a shrug. Striking,
   * casting, quaffing, searching, or waiting spends the turn whole. Out of
   * combat none of this exists: one keypress is one round for everybody. */
  endPlayerTurn(kind, actor) {
    /* The turn is billed to whoever ACTED, not to whoever holds the reins
     * when the bill arrives. They were the same object for years — until a
     * member could fall to an opportunity blow mid-step, memberDown handed
     * the reins to a companion inside the same keystroke, and the rest of
     * this method charged the dead member's move to the living one: their
     * ground never reset, and the round queue stalled with it — no monster
     * turns, no cooldown ticks, no power regained, for as long as the stall
     * held. */
    const p = actor || this.state.player;
    if (!p || this.dying) return;
    if (p.hp <= 0) {
      /* The actor fell mid-action. Their turn is over by force; hand the
       * round back to the queue instead of booking what remains. */
      this._memberShiftDebt = null;
      this.advanceQueue();
      return;
    }
    if (kind === 'move' && !this.outOfCombat()) {
      const at = this.actorTurn(p);
      at.moved = (at.moved || 0) + 1;
      if (at.moved < this.memberSpeed(p) || this.monsterInReach(p)) {
        this.midTurn();
        return;
      }
    }
    this.actorTurn(p).acted = true;
    this._memberShiftDebt = null;   /* the turn is over; the shift held */
    /* OUTSIDE OF COMBAT THE PARTY MOVES AS ONE. Whatever the member at the
     * reins just did — a step, a search, a swig — the rest of the company
     * keeps pace behind them and their actions are spent with it, so one
     * keypress is one round for everybody. The moment something is awake and
     * near, this stops holding, and the round breaks into initiative turns.
     *
     * A STANDING CAST is the exception: a companion working a power between
     * fights spends the round for everybody, but nobody keeps pace with
     * anybody — following the caster would drag the leader across the room
     * toward whoever just said a prayer. */
    if (this.outOfCombat()) {
      if (this._standingCast) {
        for (const m of this.livingMembers()) this.actorTurn(m).acted = true;
      } else {
        this.followTheLeader(p);
      }
    }
    this.advanceQueue();
  }

  /* THE ORDER OF THE COMPANY. The roster is not just a list: it decides
   * who stands where when the party arrives on a floor, and who the reins
   * fall to when the one holding them goes down. The player should be
   * able to say what that order is. `active` and any pinned view follow
   * the MEMBER, not the slot, or reordering would quietly hand the reins
   * to somebody else. */
  /* Tints ride with their owners, so the line can be redrawn freely. */
  reorderParty(from, to) {
    const party = this.state.party;
    const list = party && party.members;
    if (!list || from === to) return false;
    if (from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
    const held = list[party.active];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const at = list.indexOf(held);
    if (at >= 0) party.active = at;
    return true;
  }

  /* Where a member marches when the company moves as one: the VAN walks
   * ahead of whoever holds the reins, the REAR walks behind. Class sets the
   * default — steel ahead, robes behind — and the stat sheet overrides it,
   * so a mage at the reins is not also the party's shield when something
   * steps out of a doorway. */
  memberStance(m) {
    if (m && (m.stance === 'van' || m.stance === 'rear')) return m.stance;
    const c = CLASSES[(m || {}).cls];
    return (c && c.stance) || 'van';
  }

  followTheLeader(leader, free) {
    /* The FREE march (the form-up's column-closing) positions everyone,
     * acted or not — it spends no turns, so it owes the flag nothing. */
    const followers = this.livingMembers().filter((m) => m !== leader && (free || !this.actorTurn(m).acted));
    if (!followers.length) return;
    const floor = this.currentFloor;
    const field = this.distanceFieldFrom([leader]);
    /* THE MARCHING ORDER. Each stance seeds its own field: one march-step
     * ahead of the leader for the van, one behind for the rear — falling
     * back to the leader's own square where the hall refuses the spot, which
     * is also what happens while the leader has not yet moved anywhere. */
    const fdx = leader.faceDx || 0, fdy = leader.faceDy || 0;
    const spot = (dx, dy) => {
      const x = leader.x + dx, y = leader.y + dy;
      const t = floor.tiles[y] && floor.tiles[y][x];
      return t !== undefined && isTravelable(t) ? { x, y } : leader;
    };
    const fields = {
      van: this.distanceFieldFrom([spot(fdx, fdy)]),
      rear: this.distanceFieldFrom([spot(-fdx, -fdy)]),
    };
    /* Nearest first, so a single-file column moves front-to-back instead of
     * the second in line blocking on the first for a round. */
    followers.sort((a, b) => (field[a.y][a.x] ?? 99) - (field[b.y][b.x] ?? 99));
    for (const m of followers) {
      /* A FREE march — the form-up's closing of the column as calm breaks
       * — spends nobody's turn; the ordinary march spends the round. */
      if (!free) this.actorTurn(m).acted = true;
      const mine = fields[this.memberStance(m)] || field;
      /* A straggler hurries: two steps to the leader's one, so a column that
       * fell behind — a fight, a doorway, the stairs — closes up again instead
       * of trailing at a fixed distance for ever. */
      for (let hurry = 0; hurry < 2; hurry++) {
        const here = mine[m.y][m.x];
        /* ON the station, or cut off. Not "adjacent to" — a van that settles
         * for the leader's shoulder is not a van. When the spot is taken the
         * step search finds nothing closer and breaks by itself, which is
         * the old shoulder behaviour exactly where it belongs. */
        if (here <= 0) break;
        let best = null, bestD = here;
        for (const [dx, dy] of DIRS8) {
          const nx = m.x + dx, ny = m.y + dy;
          if (!this.inBounds(nx, ny)) continue;
          if (dx && dy && !this.canCorner(m.x, m.y, nx, ny)) continue;
          const d = mine[ny][nx];
          if (d < 0 || d >= bestD) continue;
          if (this.memberAt(nx, ny)) continue;
          if ((floor.monsters || []).some((mo) => mo.hp > 0 && mo.x === nx && mo.y === ny)) continue;
          /* Townsfolk are solid: a follower who marches INTO the widow
           * stands inside her, and every bump after that greets the
           * follower — she simply stops answering her own door. */
          if ((floor.npcs || []).some((n) => n.x === nx && n.y === ny)) continue;
          bestD = d; best = [nx, ny];
        }
        /* Followers step quietly: no wading surcharge and no pickups — the
         * splash and the loot belong to whoever holds the reins. */
        if (!best) break;
        m.faceDx = best[0] - m.x; m.faceDy = best[1] - m.y;
        m.x = best[0]; m.y = best[1];
      }
    }
  }

  /* THE LINE FORMS. Marching keeps the steel ahead of the robes, but a
   * one-wide corridor lets nobody pass: whoever holds the reins is point no
   * matter their stance, and when the reins are a mage the fight opens on
   * the party's softest member — reported from play, twice. Stance cannot
   * beat geometry while the party is walking; it can at the moment the
   * fight starts. So when calm breaks into initiative, adjacent members
   * exchange places until no rear-stance member stands nearer the woken
   * foes than a van-stance member beside them: the fighter shoulders past
   * the mage, and nobody moves further than the width of that swap. */
  formUp() {
    const floor = this.currentFloor;
    const foes = ((floor && floor.monsters) || [])
      .filter((mo) => mo.hp > 0 && mo.aggro && !mo.submerged);
    if (!foes.length) return false;
    /* CLOSE THE COLUMN FIRST. A march strung out behind a leader — fresh
     * off the stairs, say — leaves gaps no adjacent swap can cross, and
     * the fight opened on the mage anyway; reported from play a third
     * time, with the focus dutifully on the fighter. One free march step
     * pulls the van to its station beside the reins before the exchanges
     * begin; it spends nobody's turn. */
    const leader = this.state.player;
    if (leader && leader.hp > 0) {
      /* Marched to a fixpoint, not once: one free march moves each member
       * at most two tiles, and a column strung four back needs the second
       * wind. Bounded, and it stops the moment nobody moves. */
      for (let closeUp = 0; closeUp < 4; closeUp++) {
        const before = this.livingMembers().map((m) => m.x + ',' + m.y).join(';');
        this.followTheLeader(leader, true);
        if (this.livingMembers().map((m) => m.x + ',' + m.y).join(';') === before) break;
      }
    }
    const field = this.distanceFieldFrom(foes);
    const at = (m) => (field[m.y] ? field[m.y][m.x] : -1);
    let swapped = false;
    /* Bubble until stable: one exchange can expose the next (mage, fighter,
     * fighter in single file needs two). Bounded for form's sake; a party
     * is four members and settles in two or three passes. */
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      const ms = this.livingMembers();
      for (const robe of ms) {
        if (this.memberStance(robe) !== 'rear') continue;
        for (const steel of ms) {
          if (this.memberStance(steel) !== 'van') continue;
          const dx = steel.x - robe.x, dy = steel.y - robe.y;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) continue;
          /* No trading places through a wall's corner. */
          if (dx && dy && !this.canCorner(robe.x, robe.y, steel.x, steel.y)) continue;
          const dr = at(robe), ds = at(steel);
          if (dr < 0 || ds < 0 || dr >= ds) continue;
          const rx = robe.x, ry = robe.y;
          robe.x = steel.x; robe.y = steel.y;
          steel.x = rx; steel.y = ry;
          changed = true; swapped = true;
        }
      }
      if (!changed) break;
    }
    if (swapped) this.log('The line forms: steel steps ahead of the robes.');
    return swapped;
  }

  /* One pass through the round in INITIATIVE ORDER — members and monsters
   * interleaved, so a quick thing genuinely goes before the slow half of the
   * party and after the fast half. Control rests wherever the next unacted
   * member sits in the order; everything between two member slots plays out
   * between two keypresses.
   *
   * The queue itself is runtime state, never saved: a reload starts a fresh
   * round, which is the least surprising thing a reload can do. */
  buildRound() {
    /* Only combat's OPENING round forms the line — mid-fight repositioning
     * is what turns are for. `undefined` on the first round after a load
     * counts as "was calm", so loading into an ambush still forms up. */
    const calm = this.outOfCombat();
    if (!calm && this._lastRoundCalm !== false) this.formUp();
    this._lastRoundCalm = calm;
    const order = [];
    for (const m of this.livingMembers()) {
      if (!(m.ini > 0)) this.rollInitiative(m, true);
      order.push({ member: true, ref: m });
    }
    for (const mo of (this.currentFloor && this.currentFloor.monsters) || []) {
      if (mo.hp > 0 && mo.aggro && !mo.submerged) {
        if (!(mo.ini > 0)) this.rollInitiative(mo);
        order.push({ member: false, ref: mo });
      }
    }
    /* Ties go to the party — the benefit of the doubt goes to whoever is
     * paying for the torches — and then to standing order, so sort is stable.
     *
     * Out of combat there is no initiative, only a marching order: the leader
     * steers and the company follows, so the reins never land on a companion
     * between fights. */
    if (this.outOfCombat()) {
      /* The marching order starts at whoever HOLDS THE REINS — sorting by
       * roster order silently handed them back to the first member every
       * calm round, undoing the player's chip click one step later. */
      const leader = this.state.player;
      const rank = (e) => (e.member ? (e.ref === leader ? 0 : 1) : 2);
      order.sort((a, b) => rank(a) - rank(b));
    } else {
      order.sort((a, b) => (b.ref.ini || 0) - (a.ref.ini || 0) || (b.member ? 1 : 0) - (a.member ? 1 : 0));
    }
    this._round = { order, idx: 0 };
  }

  advanceQueue() {
    if (this.dying) return;
    if (!this._round) this.buildRound();
    const r = this._round;
    const field = this.playerDistanceField();
    while (r.idx < r.order.length) {
      const e = r.order[r.idx];
      if (e.member) {
        const m = e.ref;
        if (m.hp > 0 && !this.actorTurn(m).acted) {
          const at = this.state.party.members.indexOf(m);
          if (at >= 0) this.state.party.active = at;
          this.computeVisibility();
          if (this.ui.render) this.ui.render(this);
          if (this.ui.refreshHud) this.ui.refreshHud(this);
          if (this.ui.refreshStats) this.ui.refreshStats(this);
          return;   /* control rests here until a key spends this action */
        }
        r.idx++;
      } else {
        r.idx++;
        this.monsterTakeTurn(e.ref, field);
        if (this.dying) return;
      }
    }
    this.endRound();
  }

  nextUnactedMember() {
    const party = this.state.party;
    if (!party) return -1;
    for (let i = 0; i < party.members.length; i++) {
      const m = party.members[i];
      if (m && m.hp > 0 && !this.actorTurn(m).acted) return i;
    }
    return -1;
  }

  firstLivingMember() {
    const party = this.state.party;
    if (!party) return 0;
    const at = party.members.findIndex((m) => m && m.hp > 0);
    return at >= 0 ? at : 0;
  }

  /* Expedition knowledge — what fell, what was walked, how deep — belongs
   * to the COMPANY, not to whichever member held the reins or landed the
   * blow. Written to every sheet, so every reader agrees. */
  markCompany(write) {
    for (const m of (this.state.party && this.state.party.members) || []) {
      if (m) write(m);
    }
  }

  livingMembers() {
    const party = this.state.party;
    return party ? party.members.filter((m) => m && m.hp > 0) : [];
  }

  /* Who a monster may fix on: the living, minus anyone the dark has forgotten.
   * Sanctuary used to hide "the player"; with several bodies it hides the one
   * who read the scroll, and the rest of the party is still very much there. */
  targetableMembers() {
    return this.livingMembers().filter((m) =>
      !(m.buffs && m.buffs.sanctuary > 0) && !(m.buffs && m.buffs.shadow > 0));
  }

  memberAt(x, y) {
    return this.livingMembers().find((m) => m.x === x && m.y === y) || null;
  }

  nearestMember(from, pool) {
    let best = null, bd = Infinity;
    for (const m of (pool || this.targetableMembers())) {
      const d = dist1(from, m);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  adjacentMember(from) {
    let best = null, bd = Infinity;
    for (const m of this.targetableMembers()) {
      if (dist8(from, m) > 1) continue;
      const d = dist1(from, m);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /* 'you' when it is the one at the reins, a name when it is a companion —
   * "The Ghoul hits Marlyle for 4" has to read differently from a blow you
   * took yourself. */
  nameOf(member) {
    return member === this.state.player ? 'you' : member.name;
  }

  endRound() {
    const party = this.state.party;
    this.tickStatus();
    if (this.dying) return;
    /* Wading costs the turn twice over: everything else gets a second move.
     * The flag sits on whichever member waded and survives until here, since
     * turn state is cleared at the round's end, not the member's. */
    if (party.members.some((m) => m && this.actorTurn(m).wading)) {
      for (const m of party.members) if (m) this.actorTurn(m).wading = false;
      this.turn++;
      this.resolveMonsters();
      if (this.dying) return;
    }
    /* The sleeping look around once a round: anything that spots the party
     * wakes, rolls its initiative, and joins the NEXT round — you see it
     * before it moves, which is what spotting something first should buy. */
    for (const mo of (this.currentFloor && this.currentFloor.monsters) || []) {
      if (mo.hp <= 0 || mo.aggro || mo.submerged) continue;
      /* A truce keeps a creature looking the other way: the toll's crews and
       * the garrison's own do not wake for a friend of their order. */
      if (this.pacifiedToward(mo)) continue;
      if (this.vis[mo.y] && this.vis[mo.y][mo.x] && this.targetableMembers().length) {
        this.rollInitiative(mo);
        mo.aggro = true;
        mo.lastSeen = this.turn;
      }
    }
    for (const m of party.members) if (m) this.clearActorTurn(m);
    /* The reins STAY where the player put them — clicking a chip between
     * fights hands a member the lead, and a round ending must not snatch
     * it back. Only death moves them now. */
    const heldBy = party.members[party.active];
    if (!heldBy || heldBy.hp <= 0) party.active = this.firstLivingMember();
    this.computeVisibility();
    this.turn++;
    if (this.ui.render) this.ui.render(this);
    if (this.ui.refreshHud) this.ui.refreshHud(this);
    if (this.ui.refreshStats) this.ui.refreshStats(this);
    /* The new round begins at once: whatever outrolled the first member acts
     * NOW, before control returns — losing initiative means exactly this. */
    this._round = null;
    this.advanceQueue();
  }

  /* Time passes for the WHOLE company. This ran on the active member only,
   * which was invisible with one of them and a real bug with several: a
   * companion never regenerated a point, never cooled an ability down, and
   * wore a buff for ever. */
  tickStatus() {
    const calm = this.outOfCombat();
    for (const m of this.livingMembers()) this.tickMemberStatus(m, calm);
  }

  tickMemberStatus(p, calm) {
    const der = this.derived(p);
    /* Every other TICK, not every other value of this.turn. Wading advances
     * the turn counter twice for one action, so a player wearing a Ring of
     * Regeneration and crossing water only ever landed on even turns and the
     * ring simply stopped working. Measured: five points of mending over ten
     * actions on dry ground, none at all in the water. */
    /* Everything that mends without costing anything stops at the rested line.
     * Math.max on the outside, so a character who drank past it is never
     * dragged back down to it. */
    const cap = this.restedCap(p);
    if (der.regen) {
      if (!p.counters) p.counters = {};
      p.counters.regenTick = (p.counters.regenTick || 0) + 1;
      if (p.counters.regenTick % 2 === 0) p.hp = Math.max(p.hp, Math.min(cap, p.hp + der.regen));
    }
    if (calm) {
      /* One grant every tenth calm tick, not a smaller number every tick:
       * the max(1, ...) floor IS the rate for any character under ~100 max
       * health (the fraction rounds up to it), so shrinking the fraction
       * changed nothing and a stroll healed a level-1 party to full in two
       * dozen steps ("just absurd" — the playtest). Spacing the grants
       * divides the floor too, for every size of character alike. */
      if (!p.counters) p.counters = {};
      p.counters.calmTick = (p.counters.calmTick || 0) + 1;
      if (this._resting || p.counters.calmTick % HP_REGEN_EVERY === 0) {
        p.hp = Math.max(p.hp, Math.min(cap, p.hp + Math.max(1, Math.ceil(p.maxhp * HP_REGEN_FRACTION))));
      }
      p.power = Math.min(der.maxpower, p.power + Math.max(1, Math.ceil(der.maxpower * PWR_REGEN_FRACTION)));
      /* A half point never carries from one fight into the next. */
      if (p.counters) p.counters.mote = 0;
    } else if (der.powerRegen > 0) {
      /* The reserve is a tide, not a cup: while a fight is on it seeps back.
       * Deliberately slower than resting — lingering in a fight must never be
       * a quicker way to fill the bar than walking away from one. */
      this.gatherPower(der.maxpower * der.powerRegen, der);
    }
    for (const k in p.cooldowns) if (p.cooldowns[k] > 0) p.cooldowns[k]--;
    /* Every key in p.buffs is a countdown in turns. Anything that is a
     * magnitude rather than a duration belongs in p.buffLevels, or it decays. */
    for (const k in p.buffs) if (p.buffs[k] > 0) p.buffs[k]--;
    if (p.buffs.turn !== undefined && p.buffs.turn <= 0) this.buffsTurnRefresh(p);
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

  buffsTurnRefresh(who) {
    const p = who || this.state.player;
    delete p.buffs.turn;
    for (const m of (this.currentFloor && this.currentFloor.monsters || [])) if (m.fleeing) { m.fleeing = false; }
  }

  /* One BFS out from the player per turn. Every monster then walks downhill on
   * it, which routes them around corners instead of stalling against a wall. */
  /* Multi-source: seeded at every targetable member, so descending it walks a
   * monster towards whoever is NEAREST — which is what "the party is several
   * bodies" means to the thing hunting them. */
  playerDistanceField() {
    const seeds = this.targetableMembers();
    if (!seeds.length && this.state.player) seeds.push(this.state.player);
    return this.distanceFieldFrom(seeds);
  }

  distanceFieldFrom(seeds) {
    const floor = this.currentFloor;
    const dist = Array.from({ length: H }, () => Array(W).fill(-1));
    if (!floor) return dist;
    const queue = [];
    for (const m of seeds) {
      if (dist[m.y][m.x] !== -1) continue;
      dist[m.y][m.x] = 0;
      queue.push([m.x, m.y]);
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      const d = dist[y][x] + 1;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny) || dist[ny][nx] !== -1) continue;
        if (dx && dy && !this.canCorner(x, y, nx, ny)) continue;
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

  /* Every monster, all at once — the shape the tests drive and the wading
   * surcharge uses. Play itself goes through the initiative queue below, which
   * calls the same monsterTakeTurn one actor at a time. */
  resolveMonsters() {
    const alive = ((this.currentFloor.monsters) || []).filter((m) => m.hp > 0);
    const rng = this.rngOfTurn();
    const field = this.playerDistanceField();
    for (const m of rng.shuffle(alive)) {
      this.monsterTakeTurn(m, field);
      if (this.dying) return;
    }
  }

  monsterTakeTurn(m, field) {
    if (m.hp <= 0) return;
    /* The dark forgets the party only when there is nobody left for it to
     * remember: every member under Sanctuary at once. One hidden member does
     * not hide the others standing next to them. */
    const hidden = this.targetableMembers().length === 0;

    /* Wand of Frost set `stunned` and nothing ever read it. */
    if (m.stunned > 0) {
      m.stunned--;
      return;
    }

    const near = this.nearestMember(m);
    /* Something under the surface does nothing at all until it breaks it —
     * which is the point of the drains: the water is not only slow and loud,
     * it is where things wait. */
    if (m.submerged) {
      if ((near && dist8(m, near) <= SURFACE_RANGE) || m.aggro) this.surface(m);
      else return;
    }
    const seen = !!(this.vis[m.y] && this.vis[m.y][m.x]);
    if (m.t.props && m.t.props.indexOf('flying') >= 0 && !seen) return;
    /* A truce stops a creature STARTING something. The toll's crews and the
     * garrison's own see a friend of their order and let them pass — but one
     * already crossed (aggro set, by a blow or an old grudge) stays crossed. */
    if (seen && !hidden && !this.pacifiedToward(m)) {
      if (!m.aggro) this.rollInitiative(m);
      m.aggro = true;
      m.lastSeen = this.turn;
    } else if (m.aggro && !this.adjacentMember(m) && (this.turn - (m.lastSeen ?? -AGGRO_MEMORY)) > AGGRO_MEMORY) {
      m.aggro = false;
      m.revealed = false;
      m.ini = undefined;   /* the next ambush is a new roll */
    }
    if (!m.aggro) return;
    if (hidden) return;   /* it knows something is there; it cannot fix on you */

    /* Monster speed (1-4) buys GROUND and INITIATIVE, never blows: a fast
     * thing closes sooner and goes earlier in the round, but nothing strikes
     * twice in one turn. It keeps going only while it is STEPPING. */
    const steps = Math.max(1, Math.min(4, m.t.speed || 1));
    const f = field || this.playerDistanceField();
    this._monShiftDebt = null;
    for (let i = 0; i < steps; i++) {
      this._monStep = i;   /* the first step is the shift, and free */
      const did = this.monsterAct(m, seen, null, f);
      if (this.dying) return;
      if (m.hp <= 0) break;
      if (did !== 'step') break;
    }
    this._monStep = 0;
    this._monShiftDebt = null;
  }

  /* The company's law applied to the other side: a monster's first step is
   * the same provisional shift, and its second step calls in the same debt.
   * memberOpportunity itself keeps each member to one opening per round. */
  provokeMonsterShift(m) {
    const here = this.targetableMembers().filter((mem) => dist8(mem, m) <= 1);
    if (!this._monStep) {
      this._monShiftDebt = here;
      return true;
    }
    const owed = [...(this._monShiftDebt || []), ...here];
    this._monShiftDebt = null;
    for (const mem of owed) {
      this.memberOpportunity(mem, m);
      if (m.hp <= 0) return false;
    }
    return true;
  }

  /* INITIATIVE, rolled once per encounter and held — the way the game this is
   * inspired by rolls it. Rolling every round was built and measured first: a
   * stable order gives every actor exactly one action between two of any
   * member's inputs, while a re-rolled one lets an actor land twice in that
   * window — measured, a character quaffing at a threshold that never fails
   * today died in three-quarters of runs. Dexterity is the member's edge;
   * speed is the monster's. */
  rollInitiative(actor, isMember = false) {
    const r = this.rngOfTurn();
    const bonus = isMember
      ? abilityMod(this.derived(actor).effValues.dex)
      : (Math.max(1, Math.min(4, (actor.t && actor.t.speed) || 1)) - 1) * 2;
    actor.ini = r.d(20) + bonus;
    return actor.ini;
  }

  /* Per-turn state belongs to the ACTOR, not to the game. It lived on the
   * Game because there was only ever one actor; a party has several, and an
   * initiative order can put two of them mid-turn at once. It is a fresh
   * object each round, so nothing has to remember to clear a flag it added —
   * and it is turnState rather than turn, because this.turn is the counter. */
  actorTurn(actor) {
    const a = actor || this.state.player;
    if (!a) return {};
    if (!a.turnState) a.turnState = {};
    return a.turnState;
  }

  clearActorTurn(actor) {
    const a = actor || this.state.player;
    if (a) a.turnState = {};
  }

  /* Says what it DID: 'strike', 'step' or 'nothing'. The caller used to work
   * that out by watching whether the thing had moved — which read a missed
   * swing and a blocked corridor as the same event, and is the first thing to
   * break once a creature can strike more than once in a turn. */
  monsterAct(m, seen, der, field) {
    const inReach = this.adjacentMember(m);
    if (!m.aggro) return 'nothing';
    /* Fleeing means FLEEING — it used to be checked after reach, so a thing
     * that had turned tail would stand and trade blows the moment anyone
     * closed with it. Now it runs even from beside you, and pays the law of
     * the battle map for it: the company strikes at what shows its back. */
    if (m.fleeing) {
      return this.monsterFlee(m) ? 'step' : 'nothing';
    }
    if (inReach) {
      this.monsterMelee(m, inReach);
      return 'strike';
    }
    const mark = this.nearestMember(m);
    if (!mark) return 'nothing';
    const dist = dist1(m, mark);
    const range = m.t.aggroRange || 8;
    const isRanged = m.t.props && m.t.props.some((x) => x === 'ranged');
    if (isRanged && seen && dist <= 12) {
      this.monsterRanged(m, mark);
      return 'strike';
    }
    if (dist <= range || seen) {
      return this.monsterChase(m, field) ? 'step' : 'nothing';
    }
    return 'nothing';
  }

  /* What the pack knows that the lone wolf does not: the other jaws. */
  monsterFlank(m, mark) {
    return this.flankBonus(m, mark,
      (this.currentFloor.monsters || []).filter((o) => o !== m && o.aggro && o.hp > 0 && !o.submerged));
  }

  monsterMelee(m, target) {
    if (m.t.attacks && m.t.attacks.length) { this.routineMelee(m, target); return; }
    const mark = target || this.state.player;
    const der = this.derived(mark);
    const r = this.rngOfTurn();
    const dc = Math.max(1, 20 - der.ac);
    const raw = r.d(20);
    /* A natural 20 always lands, as it does for the player. Without it, enough
     * armour put the player permanently out of a monster's reach. */
    const hit = raw === 20 || raw + m.toHit + this.monsterFlank(m, mark) >= dc;
    if (!hit) { this.log('The ' + m.t.name + ' lashes out — and misses!'); return; }
    const dmg = this.rollDamage({ dice: m.dmg.dice, sides: m.dmg.sides, bonus: m.dmg.bonus }, m.t);
    this.log('The ' + m.t.name + ' hits ' + this.nameOf(mark) + ' for ' + dmg + ' hit points.');
    this.damageMember(mark, dmg, m);
  }

  /* CLAW, CLAW, BITE.
   *
   * A routine REPLACES a creature's single attack: several blows, each with
   * its own roll, budgeted so the total against one body is about what the
   * single attack was. Three rules from the design review that attacked this
   * before it was written, each of which it failed on paper:
   *
   *  - Every entry aims wide (-1 to hit): splitting one roll into three
   *    collapses armour's whole payoff — the rate at which you walk away
   *    untouched — while the average stays flat and every test agrees nothing
   *    changed. The penalty gives armour its meaning back.
   *  - The depth bonus rides ONE entry, not each: added per blow it multiplied
   *    by routine length, and a budget-matched routine was measured at 1.8x
   *    its single-attack twin by floor ten.
   *  - Soak spends ONCE per body per action, not per blow: floored per blow,
   *    a ward that only ever saw small nibbles was measured worthless — the
   *    Mage's Ashen Mantle bought nothing at all against a routine.
   *
   * And the reason routines exist at all: THE GOD HAS ARMS FOR EACH OF YOU.
   * Against a company the routine grows one leading blow per extra body and
   * the blows spread across everyone in reach — which is the boss's answer to
   * an action economy that let any two adventurers beat every boss in the
   * game, measured at one hundred percent. */
  routineMelee(m, target) {
    const routine = m.t.attacks;
    const r = this.rngOfTurn();
    const reach = this.targetableMembers().filter((mm) => dist8(m, mm) <= 1);
    if (!reach.length) return;
    /* Proportional, not additive: one extra claw per body was measured to
     * leave every boss at a one hundred percent loss to any pair — a company
     * doubles its damage AND its pooled health, so the routine repeats whole
     * per body in the company, up to the company's own legal size. Alone, it
     * is exactly the budgeted routine. */
    const arms = Math.min(4, Math.max(1, this.targetableMembers().length));
    const entries = [];
    for (let a = 0; a < arms; a++) entries.push(...routine);
    const depthDelta = Math.max(0, (m.dmg.bonus || 0) - ((m.t.damage && m.t.damage.bonus) || 0));
    const landed = new Map();
    let ti = Math.max(0, reach.indexOf(target || this.state.player));
    entries.forEach((entry, i) => {
      const mark = reach[ti % reach.length];
      ti++;
      if (!mark || mark.hp <= 0) return;
      const der = this.derived(mark);
      const dc = Math.max(1, 20 - der.ac);
      const raw = r.d(20);
      const hit = raw === 20 || raw + m.toHit - 1 + this.monsterFlank(m, mark) >= dc;
      const label = entry.name || 'blow';
      if (!hit) { this.log('The ' + m.t.name + '\'s ' + label + ' misses ' + this.nameOf(mark) + '.'); return; }
      const d = entry.damage || { dice: 1, sides: 3, bonus: 0 };
      const dmg = this.rollDamage({ dice: d.dice, sides: d.sides, bonus: (d.bonus || 0) + (i === 0 ? depthDelta : 0) }, m.t);
      this.log('The ' + m.t.name + '\'s ' + label + ' finds ' + this.nameOf(mark) + ' for ' + dmg + '.');
      landed.set(mark, (landed.get(mark) || 0) + dmg);
    });
    for (const [mark, total] of landed) {
      this.damageMember(mark, total, m);
      if (this.dying) return;
    }
  }

  monsterRanged(m, target) {
    const mark = target || this.state.player;
    const r = this.rngOfTurn();
    const der = this.derived(mark);
    const dc = Math.max(1, 20 - der.ac);
    const raw = r.d(20);
    if (raw === 20 || raw + m.toHit >= dc) {
      const dmg = this.rollDamage({ dice: m.dmg.dice, sides: m.dmg.sides, bonus: m.dmg.bonus }, m.t);
      this.log('The ' + m.t.name + ' looses at ' + this.nameOf(mark) + ' and hits for ' + dmg + '.');
      this.damageMember(mark, dmg, m);
    } else {
      this.log('The ' + m.t.name + '\'s ranged attack whistles past.');
    }
  }

  monsterChase(m, field) {
    const floor = this.currentFloor;
    const here = field[m.y][m.x];
    let best = null;
    let bestD = here >= 0 ? here : Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (dx && dy && !this.canCorner(m.x, m.y, nx, ny)) continue;
      if (this.memberAt(nx, ny)) continue;
      const d = field[ny][nx];
      if (d < 0 || d >= bestD) continue;
      if (floor.monsters.some((o) => o !== m && o.hp > 0 && o.x === nx && o.y === ny)) continue;
      bestD = d; best = [nx, ny];
    }
    if (!best) return false;
    if (!this.provokeMonsterShift(m)) return false;
    m.x = best[0]; m.y = best[1];
    return true;
  }

  monsterFlee(m) {
    const floor = this.currentFloor;
    const p = this.nearestMember(m) || this.state.player;
    const dx = Math.sign(m.x - p.x) || 0, dy = Math.sign(m.y - p.y) || 0;
    const moves = [[dx, 0], [0, dy]];
    for (const [mx, my] of moves) {
      const nx = m.x + mx, ny = m.y + my;
      if (!this.inBounds(nx, ny)) continue;
      const t = floor.tiles[ny][nx];
      if (!isTravelable(t)) continue;
      if (floor.monsters.some((o) => o !== m && o.x === nx && o.y === ny)) continue;
      if (this.memberAt(nx, ny)) continue;
      if (!this.provokeMonsterShift(m)) return false;
      m.x = nx; m.y = ny;
      if (dist1(m, p) > 10) { m.aggro = false; m.fleeing = false; m.revealed = false; }
      return true;
    }
    return false;
  }

  /* Kept as the door everything used to knock on; it hits whoever holds the
   * reins. Traps, spells and old tests all still work through it. */
  damagePlayer(dmg, m) {
    this.damageMember(this.state.player, dmg, m);
  }

  damageMember(target, dmg, m) {
    if (!target) return;
    const der = this.derived(target);
    let soak = der.resist || 0;
    const unhallowed = m && m.t && m.t.props && (m.t.props.includes('undead') || m.t.props.includes('cursed'));
    if (unhallowed) soak += der.undeadResist || 0;
    if (soak > 0 && dmg > 1) {
      const stopped = Math.min(soak, dmg - 1);
      if (stopped > 0) {
        dmg -= stopped;
        this.log((target === this.state.player ? 'Your' : target.name + '\'s') + ' ward turns ' + stopped + ' of it aside.');
      }
    }
    target.hp -= dmg;
    this.takeWound(dmg, target);
    if (target.hp <= 0) {
      target.hp = 0;
      this.memberDown(target, m);
    }
  }

  /* One body down is a wound to the party; the LAST body down is the death.
   * The fallen keep their gear and are skipped by the rotation, the field and
   * every targeting path, all of which ask livingMembers. */
  memberDown(target, m) {
    this.clearActorTurn(target);
    const left = this.livingMembers();
    if (!left.length) {
      this.die(m);
      return;
    }
    this.log(target.name + ' falls!');
    this.journal(target.name + ' fell to a ' + ((m && m.t && m.t.name) || 'blow in the dark') + '.');
    const party = this.state.party;
    if (party.members[party.active] === target) {
      const next = this.nextUnactedMember();
      party.active = next >= 0 ? next : this.firstLivingMember();
    }
  }

  die(m) {
    const p = this.state.player;
    this.dying = true;
    /* Per-turn flags do not survive the end of a life. */
    this.clearActorTurn();
    const killer = m ? ('by a ' + m.t.name) : 'by misadventure';
    this.log('You are slain ' + killer + '!');
    if (this.ui.showDeath) this.ui.showDeath('You were laid low ' + killer + ' in ' + (this.dungeonById(p.dungeonId) || {}).name + '.');
  }

  returnToCamp(resurrect = false) {
    const p = this.state.player;
    this.dying = false;
    /* The standing rate is half, and a friend of the table pays the friend's
     * rate — see deathTollShare. The scribes are the same either way. */
    const toll = Math.floor(this.purse() * this.deathTollShare());
    if (resurrect) {
      this.spendGold(toll);
      this.log('The temple scribes haul you from the threshold for ' + toll + ' gold.');
    } else {
      this.spendGold(toll);
    }
    /* The one bed in the world, and it sleeps the whole party: the fallen get
     * up at camp, wounds and all mended — the resurrection fee already paid
     * for the trip. */
    for (const m of this.state.party.members) {
      if (!m) continue;
      m.hp = m.maxhp;
      m.power = m.maxpower;
      m.wounds = 0;
      if (m.counters) m.counters.woundMote = 0;
    }
    /* Back to the deepest floor you reached, not to the entrance. The floors
     * above are already cleared, so sending you to the top charged the death
     * in walking rather than in anything you could weigh. */
    const deepest = (p.deepest && p.deepest[p.dungeonId]) || 0;
    if (this.dungeonById(p.dungeonId)) {
      this.loadFloor(deepest);
      if (deepest > 0) this.log('You come to at the stairhead of floor ' + (deepest + 1) + ', poorer.');
    } else {
      this.enterDungeon(p.dungeonId);
    }
    if (this.ui.render) this.ui.render(this);
  }

  passives(who) {
    if (!(who || this.state.player)) return [];
    return this.allAbilities(who).filter((a) => a.kind === 'passive');
  }

  hasPassive(id) {
    return this.passives().some((a) => a.id === id);
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
  /* THE JOURNAL: the run, told back to its owner. Entries are written at
   * the moments a campfire retelling would keep — first arrivals, bosses
   * down, the company changing shape, levels earned, the narration the
   * dark offers — and capped, because a journal is memory, not a log. */
  journal(text) {
    const s = this.state;
    if (!s) return;
    if (!s.journal) s.journal = [];
    const p = s.player;
    const d = p && this.dungeonById(p.dungeonId);
    const where = this.inTown() ? 'The Whetstone'
      : d ? d.name + ', floor ' + ((p.floorIdx || 0) + 1) : '';
    s.journal.push({ turn: this.turn || 0, where, text });
    if (s.journal.length > 200) s.journal.splice(0, s.journal.length - 200);
  }

  fireBeats(kind, floorIdx) {
    const p = this.state.player;
    if (!p || !p.dungeonId) return;
    for (const beat of beatsAt(p.dungeonId, kind, floorIdx)) {
      if (this.beatSeen(kind, floorIdx, beat)) continue;
      this.rememberBeat(kind, floorIdx, beat);
      if (beat.type === 'narration') { this.log('… ' + beat.text + ' …'); this.journal(beat.text); }
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
    const key = this.beatKey(kind, floorIdx, beat);
    this.markCompany((m) => {
      if (!m.beatsSeen) m.beatsSeen = {};
      m.beatsSeen[key] = true;
    });
  }

  /* ---- THE UNDERTAKINGS ----
   *
   * A quest is the company's, like the purse and like what the company
   * knows: it does not live on a sheet, it does not travel with whoever
   * holds the reins, and it survives the death of the member who took it.
   * The ledger is one map on the state:
   *
   *   state.quests[id] = { state: 'active' | 'done', got: n, took: turn }
   *
   * `got` is progress toward the objective. A slay quest counts from the
   * moment it was ACCEPTED — counting kills already made would be a lie
   * the first time somebody takes a quest on a half-cleared floor — and a
   * gather quest reads the packs, so what you are already carrying counts
   * and nothing has to be dropped and picked up again. */
  questLedger() {
    if (!this.state.quests) this.state.quests = {};
    return this.state.quests;
  }

  questState(id) {
    const e = this.questLedger()[id];
    return (e && e.state) || 'unoffered';
  }

  /* What this NPC can put to the player right now: written order, minus
   * anything taken or finished, minus anything still gated. */
  questsOnOffer(npcId) {
    return questsFrom(npcId).filter((q) => {
      if (this.questState(q.id) !== 'unoffered') return false;
      if (q.requires && q.requires.quest && this.questState(q.requires.quest) !== 'done') return false;
      if (q.opens && q.opens.dungeonCleared && !this.isDungeonCleared(q.opens.dungeonCleared)) return false;
      return true;
    });
  }

  acceptQuest(id) {
    const q = questById(id);
    if (!q || this.questState(id) !== 'unoffered') return false;
    this.questLedger()[id] = { state: 'active', got: 0, took: this.turn || 0, parts: {}, seen: [] };
    this.log('Undertaken: ' + q.name + '.');
    this.journal('Took up an undertaking: ' + q.name + '.');
    /* A gather quest reads what is already in the packs; a cleared one reads
     * the chronicle. Both are live, so both are read on the way in. */
    this.refreshQuestProgress();
    return true;
  }

  activeQuests() {
    return QUESTS.filter((q) => this.questState(q.id) === 'active');
  }

  /* THE LEAVES. An objective is one leaf, or a bundle of them under `all`.
   * eachLeaf yields (leaf, key): key is null for a lone objective and the
   * sub-index for a bundled one, so every kind is evaluated in exactly one
   * place whatever shape the quest takes. */
  eachLeaf(q, fn) {
    const o = q.objective || {};
    if (o.kind === 'all' && Array.isArray(o.of)) o.of.forEach((leaf, i) => fn(leaf, i));
    else fn(o, null);
  }

  /* Progress on ONE leaf. Live kinds read the world as it stands — a gather
   * reads the packs, a cleared reads the chronicle — so they never lie about
   * what the company is already carrying or has already done. Counted kinds
   * read the ledger, which only moves when the trigger that owns them fires. */
  leafProgress(q, leaf, key) {
    if (!leaf || !leaf.kind) return 0;
    if (leaf.kind === 'gather') {
      return this.companyItems().filter((it) => it && it.id === leaf.item).length;
    }
    if (leaf.kind === 'cleared') {
      return (leaf.dungeons || []).filter((d) => this.isDungeonCleared(d)).length;
    }
    const e = this.questLedger()[q.id];
    if (!e) return 0;
    if (key === null || key === undefined) return e.got || 0;
    return (e.parts && e.parts[key]) || 0;
  }

  leafTarget(leaf) {
    if (!leaf) return 1;
    /* A delivery is a single act — its `count` is how many goods it takes to
     * make the drop, not how many drops there are. */
    if (leaf.kind === 'deliver') return 1;
    return leaf.count || (leaf.kind === 'cleared' ? (leaf.dungeons || []).length : 0) || 1;
  }

  leafSatisfied(q, leaf, key) {
    return this.leafProgress(q, leaf, key) >= this.leafTarget(leaf);
  }

  questProgressOf(q) {
    const o = q.objective || {};
    /* A bundle reports how many of its leaves are met, so the Undertakings
     * list can say "2 of 3 undertakings" instead of one bare number. */
    if (o.kind === 'all') {
      let n = 0;
      this.eachLeaf(q, (leaf, key) => { if (this.leafSatisfied(q, leaf, key)) n++; });
      return n;
    }
    return this.leafProgress(q, o, null);
  }

  questSatisfied(q) {
    const o = q.objective || {};
    if (o.kind === 'all') {
      let every = true;
      this.eachLeaf(q, (leaf, key) => { if (!this.leafSatisfied(q, leaf, key)) every = false; });
      return every;
    }
    return this.leafSatisfied(q, o, null);
  }

  bumpLeaf(q, key) {
    const e = this.questLedger()[q.id];
    if (!e) return;
    if (key === null || key === undefined) e.got = (e.got || 0) + 1;
    else { if (!e.parts) e.parts = {}; e.parts[key] = (e.parts[key] || 0) + 1; }
  }

  /* Hand over n of an item from across the company's packs — a gather quest's
   * goods at turn-in, a delivery's goods on arrival. Extracted because both
   * need it and only one had it. */
  consumeCompanyItems(itemId, n) {
    let owed = n;
    for (const m of (this.state.party && this.state.party.members) || []) {
      if (!m || owed <= 0) continue;
      for (let i = m.inventory.length - 1; i >= 0 && owed > 0; i--) {
        const it = m.inventory[i];
        if (!it || it.id !== itemId) continue;
        m.inventory.splice(i, 1);
        this.unbindItem(it, m);
        owed--;
      }
    }
  }

  /* Live kinds (gather, cleared) are read off the world, so this only has to
   * run where the packs or the chronicle change — and after a boss falls,
   * since that is the only way `cleared` ever moves. */
  refreshQuestProgress() {
    for (const q of this.activeQuests()) {
      let live = false;
      this.eachLeaf(q, (leaf) => { if (leaf.kind === 'gather' || leaf.kind === 'cleared') live = true; });
      if (live && this.questSatisfied(q)) this.noteQuestReady(q);
    }
  }

  noteQuestReady(q) {
    const e = this.questLedger()[q.id];
    if (!e || e.told) return;
    /* A field-closed undertaking (turnIn: false) needs no return trip: the
     * moment it is satisfied it pays out where the company stands, and `done`
     * is read as narration rather than as the giver's speech. */
    if (!q.turnIn) { this.completeQuest(q.id); return; }
    e.told = true;
    const who = getNPC(q.giver);
    this.log(q.name + ' — what was asked for is in hand' +
      (who ? '. Take it back to ' + who.name + '.' : '.'));
  }

  /* Called where the world changes in ways an objective might care about. */
  questKilled(monsterId) {
    for (const q of this.activeQuests()) {
      let changed = false;
      this.eachLeaf(q, (leaf, key) => {
        const isSlay = leaf.kind === 'slay' && leaf.monster === monsterId;
        const isCull = leaf.kind === 'slayAny' && (leaf.monsters || []).includes(monsterId);
        if (isSlay || isCull) { this.bumpLeaf(q, key); changed = true; }
      });
      if (!changed) continue;
      if (this.questSatisfied(q)) this.noteQuestReady(q);
      else this.log(q.name + ' — ' + objectiveText(q, this.questProgressOf(q)) + '.');
    }
  }

  questReached(dungeonId, floorIdx) {
    for (const q of this.activeQuests()) {
      let changed = false;
      this.eachLeaf(q, (leaf, key) => {
        if (leaf.kind === 'reach' && leaf.dungeon === dungeonId && floorIdx >= (leaf.floor || 0)) {
          const e = this.questLedger()[q.id];
          const cur = (key === null || key === undefined) ? e.got : (e.parts && e.parts[key]);
          if (!cur) { this.bumpLeaf(q, key); changed = true; }
        }
        /* A delivery is a reach that has to arrive carrying enough: the whole
         * consignment is handed over on the spot, not back at a counter. */
        if (leaf.kind === 'deliver' && leaf.dungeon === dungeonId && floorIdx >= (leaf.floor || 0)) {
          const e = this.questLedger()[q.id];
          const cur = (key === null || key === undefined) ? e.got : (e.parts && e.parts[key]);
          const carried = this.companyItems().filter((it) => it && it.id === leaf.item).length;
          if (!cur && carried >= (leaf.count || 1)) {
            this.consumeCompanyItems(leaf.item, leaf.count || 1);
            this.bumpLeaf(q, key);
            changed = true;
            const tpl = getItemTemplate(leaf.item);
            this.log('Delivered: ' + (tpl ? tpl.name : leaf.item) + (leaf.count > 1 ? ' ×' + leaf.count : '') + ', to where it was owed.');
          }
        }
      });
      if (!changed) continue;
      if (this.questSatisfied(q)) this.noteQuestReady(q);
      else this.log(q.name + ' — ' + objectiveText(q, this.questProgressOf(q)) + '.');
    }
  }

  /* An altar gives once, to one member; the undertaking cares about how many
   * DISTINCT altars the rite was kept at, so it keys them and counts each
   * once, whoever set their hands on it. */
  questAltarUsed(altarKey) {
    for (const q of this.activeQuests()) {
      let changed = false;
      this.eachLeaf(q, (leaf, key) => {
        if (leaf.kind !== 'altar') return;
        const e = this.questLedger()[q.id];
        if (!e.seen) e.seen = [];
        if (e.seen.includes(altarKey)) return;
        e.seen.push(altarKey);
        this.bumpLeaf(q, key);
        changed = true;
      });
      if (!changed) continue;
      if (this.questSatisfied(q)) this.noteQuestReady(q);
      else this.log(q.name + ' — ' + objectiveText(q, this.questProgressOf(q)) + '.');
    }
  }

  /* Anything this NPC is owed and can now be paid for. */
  questsToClose(npcId) {
    return this.activeQuests().filter((q) => q.giver === npcId && this.questSatisfied(q));
  }

  /* Undertakings that come from no person — the Black Library writes them on
   * a petition rather than speaking them. Offered where the Library is, not
   * where anyone stands. */
  libraryQuestsOnOffer() {
    return QUESTS.filter((q) => {
      if (q.via !== 'library') return false;
      if (this.questState(q.id) !== 'unoffered') return false;
      if (q.requires && q.requires.quest && this.questState(q.requires.quest) !== 'done') return false;
      if (q.opens && q.opens.dungeonCleared && !this.isDungeonCleared(q.opens.dungeonCleared)) return false;
      if (q.opens && q.opens.dungeonsCleared) {
        if (!q.opens.dungeonsCleared.every((d) => this.isDungeonCleared(d))) return false;
      }
      return true;
    });
  }

  /* Let one go. It returns to the offering rather than vanishing, so it can
   * be taken up again — setting an undertaking aside is not refusing it
   * forever, and the Undertakings list should not be a list you cannot edit. */
  abandonQuest(id) {
    const q = questById(id);
    if (!q || this.questState(id) !== 'active') return false;
    delete this.questLedger()[id];
    const who = getNPC(q.giver);
    this.log('Set aside: ' + q.name + '.' + (who ? ' ' + who.name + ' will ask again.' : ''));
    return true;
  }

  /* STANDING WITH THE POWERS OF THE WORLD.
   *
   * Seven factions were written at depth, three of them with a person you can
   * actually meet, and not one of them meant anything: the Codex printed the
   * notes and the game never asked who you had done right by.
   *
   * The ledger lives on the STATE, not on a member. This is the seventh time
   * that distinction has mattered — healing, loot, the purse, expedition
   * knowledge, the standing cast, the quests — and the rule has not changed:
   * a company earns a reputation together, and a favour owed to the woman who
   * carried the idols is not owed to her alone. */
  standing(faction) {
    if (!faction) return 0;
    return (this.state.standing && this.state.standing[faction]) || 0;
  }

  /* What they call you, for anything that needs to print it. */
  standingRank(faction) {
    return STANDING_RANKS[Math.min(STANDING_RANKS.length - 1, this.standing(faction))];
  }

  earnStanding(faction, n = 1) {
    if (!faction || !n) return;
    if (!this.state.standing) this.state.standing = {};
    const was = this.standing(faction);
    this.state.standing[faction] = was + n;
    const f = getFaction(faction);
    if (!f) return;
    const rank = STANDING_RANKS[Math.min(STANDING_RANKS.length - 1, was + n)];
    this.log('Word travels: ' + f.name + ' now count you ' + rank + '.');
    this.journal(f.name + ' count you ' + rank + '.');
  }

  /* Who a working of this kind answers to — the faction whose door the
   * favour was done at, or null for the quests nobody is behind. */
  factionOfNpc(npcId) {
    const n = npcId && getNPC(npcId);
    return (n && n.faction) || null;
  }

  /* WHAT A STANDING BUYS, for the orders that were written at depth but never
   * meant anything. Three factions already kept their promises (the Carriers'
   * price, the Sisters' channels, the Keepers' survey); these are the rest.
   *
   * Each effect reads the company ledger, like every other standing rule: a
   * favour owed to one delver is owed to the whole company. */

  /* THE TALLYMEN haul you back over the threshold for half your gold, because
   * half is the standing rate and rates are not negotiated. But a friend of
   * the table pays the friend's rate: it bends with standing, and it never
   * reaches nothing, because nothing is not a rate. */
  deathTollShare() {
    const owed = this.standing('tallymen');
    return Math.max(0.15, 0.5 - 0.10 * owed);
  }

  /* The garrison, by kind: the bones that remember marching orders and the
   * carved guards that stopped waiting. Kept as a list, not a prop sweep,
   * because the order is a specific set of creatures and not everything
   * undead answers to it — the flood's drowned dead are the Sisters' affair. */
  standingOrderCreatures() {
    return STANDING_ORDER_CREATURES;
  }

  /* THE STANDING TRUCES. A power you have done right by calls its own
   * creatures off. The Drain Toll would rather bill you than kill you, so
   * their wererat crews let a customer walk. The Standing Order knows its own
   * once the long arrears are closed — you are delivery, and the delivery is
   * made. A truce only stops a creature STARTING something: strike one and it
   * defends itself, as ever. Returns the faction the truce answers to, or
   * null. */
  pacifiedToward(m) {
    const id = m && m.t && m.t.id;
    if (!id) return null;
    if (id === 'wererat' && this.standing('drain-toll') > 0) return 'drain-toll';
    if (STANDING_ORDER_CREATURES.has(id) && this.standing('standing-order') > 0) return 'standing-order';
    return null;
  }

  completeQuest(id) {
    const q = questById(id);
    if (!q || this.questState(id) !== 'active' || !this.questSatisfied(q)) return false;
    /* Gather leaves hand the goods over — the whole company's, since they were
     * the company's to find. A bundle hands over every gather leaf in it; a
     * delivery already changed hands on arrival, so it is not taken twice. */
    this.eachLeaf(q, (leaf) => {
      if (leaf.kind === 'gather') this.consumeCompanyItems(leaf.item, leaf.count || 1);
    });
    /* A repeatable undertaking never leaves the list: it pays, hands over the
     * goods, and reopens at zero, so a faction can be stood with more than once
     * — the whole point of a standing bounty. */
    this.questLedger()[id] = q.repeatable
      ? { state: 'active', got: 0, told: false, took: this.turn || 0, parts: {}, seen: [], times: ((this.questLedger()[id] || {}).times || 0) + 1 }
      : { state: 'done', got: this.questProgressOf(q) };
    /* The favour lands with whoever the undertaking answers to — the order
     * named on it, or the giver's own order standing behind them. */
    this.earnStanding(q.faction || this.factionOfNpc(q.giver));
    const r = q.reward || {};
    if (r.gold) { this.earnGold(r.gold); this.log('Paid: ' + r.gold + ' gold.'); }
    if (r.xp) this.gainXP(r.xp);
    if (r.item) {
      const tpl = this.itemTemplate(r.item);
      const taker = this.state.player;
      if (tpl && taker && taker.inventory.length < PACK_LIMIT) {
        taker.inventory.push(deepItem(tpl));
        this.log('Given: ' + tpl.name + '.');
      }
    }
    this.log('Undertaking closed: ' + q.name + '.');
    this.journal(q.journal || (q.name + ' was seen through.'));
    return true;
  }

  introduceNpc(npcId) {
    const p = this.state.player;
    this.markCompany((m) => {
      if (!m.npcsMet) m.npcsMet = {};
      m.npcsMet[npcId] = true;
    });
    if (this.ui.flagNpcIntroduced) this.ui.flagNpcIntroduced(npcId);
  }

  /* ---- abilities ---- */
  allAbilities(who) {
    const p = who || this.state.player;
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

  /* A member who is NOT at the reins acts. Between fights any living
   * member may — the company stands still, the round passes, and the
   * reins go back where they were: an errand is not a coup. Mid-fight
   * the initiative order decides, the same as always. */
  asMember(member, act) {
    if (!member || member.hp <= 0) return false;
    if (member === this.state.player) { act(); return true; }
    const party = this.state.party;
    const idx = party.members.indexOf(member);
    if (idx < 0) return false;
    if (!this.outOfCombat()) {
      this.log('Not ' + member.name + '’s turn — in a fight the round decides.');
      return false;
    }
    const prev = party.active;
    party.active = idx;
    this._standingCast = true;
    try {
      act();
    } finally {
      this._standingCast = false;
      if (party.members[prev] && party.members[prev].hp > 0) party.active = prev;
    }
    return true;
  }

  /* The standing cast, the standing swig, the standing read: the same law
   * wearing three coats. */
  castAs(member, id) {
    return this.asMember(member, () => this.activateAbility(id));
  }

  useItemAs(member, item) {
    if (!item) return false;
    return this.asMember(member, () => this.useItem(item));
  }

  useBeltItemAs(member, index) {
    return this.asMember(member, () => this.useBeltItem(index));
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
    /* THE REFUSED-DRAUGHT LAW, for powers: a working with nothing to work on
     * costs neither power, cooldown nor turn. Blowing the backstab because
     * the round was on the wrong member was a tax on misreading a marker. */
    const held = this.abilityRefusal(a);
    if (held) { this.log(held); return; }
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
    this.endPlayerTurn(undefined, p);
  }

  /* Would this working find anything at all? Mirrors each kind's own target
   * search; a string is the refusal, spoken before anything is spent. */
  abilityRefusal(a) {
    const p = this.state.player;
    const floor = this.currentFloor;
    const monsters = (floor.monsters || []).filter((m) => m.hp > 0);
    if (a.kind === 'damage') {
      if (!this.damageTargets(a).length) return a.name + ' finds no target in the light — you hold the working.';
    } else if (a.kind === 'turn') {
      const answers = monsters.some((m) => m.t.props &&
        (m.t.props.indexOf('undead') >= 0 || m.t.props.indexOf('cursed') >= 0) &&
        dist1(m, p) <= (a.range || 6));
      if (!answers) return 'Nothing unholy is near enough to answer — you hold the working.';
    } else if (a.kind === 'heal') {
      if (a.party) {
        const any = this.livingMembers().some((m) => dist1(m, p) <= a.party && m.hp < m.maxhp);
        if (!any) return 'Nobody within reach is hurt — you hold the working.';
      } else {
        const mark = this.healTarget(a);
        if (mark.hp >= mark.maxhp) return (mark === p ? 'You are' : mark.name + ' is') + ' whole — you hold the working.';
      }
    }
    return null;
  }

  /* EVERYTHING A DAMAGING WORKING REACHES, in the order it should be told.
   *
   * There are three shapes, and the difference between them is what an
   * ability says about itself:
   *
   *   sight        every foe the light shows. Fatal Flurry throws knives at
   *                the room, not at a neighbour.
   *   aura, alone  a radius turning on the caster's own tile. Whirlwind is a
   *                dance of death "around you", so YOU are the centre of it.
   *   aura + range the thrown blast: pick a foe within reach, and let the
   *                burst catch what stands near THEM. Fireball.
   *
   * These used to be one expression, and it read an aura with no range of its
   * own as a reach of one — so both capstones that turn on the spot went
   * looking for an adjacent monster to be the centre instead of standing at
   * it. A thief with three foes in view and none of them touching her was
   * told her working found no target in the light; one step closer, and it
   * blasted the single monster she had walked up to.
   *
   * The refusal law calls this too, rather than keeping its own copy of the
   * search. The copy is how the two drifted apart in the first place. */
  damageTargets(a) {
    const p = this.state.player;
    const live = (this.currentFloor.monsters || []).filter((m) => m.hp > 0);
    const lit = (m) => !!(this.vis[m.y] && this.vis[m.y][m.x]);

    if (a.sight) return live.filter(lit);
    /* You cannot hit what you cannot see, and that goes for the workings that
     * turn on the spot too. It reads like pedantry at Whirlwind's two tiles —
     * anything at a fighter's elbow has line of sight to him by definition —
     * and stops being pedantry at Judgment's five, where the far edge of the
     * circle is through a wall and into the next room. */
    if (a.aura && !a.range) return live.filter((m) => dist1(m, p) <= a.aura && lit(m));

    /* Reach is KING-move reach — a Backstab refused a foe on the diagonal
     * that a plain strike would take. The preference among those in reach
     * stays Manhattan (the adjacentMember idiom): straight-on before the
     * corner, and ranged targeting unchanged. */
    const range = a.range || 1000;
    let target = null, best = 1e9;
    for (const m of live) {
      if (!lit(m) || dist8(m, p) > range) continue;
      const d = dist1(m, p);
      if (d < best) { best = d; target = m; }
    }
    if (!target) return [];
    if (!a.aura) return [target];
    return [target, ...live.filter((m) => m !== target && dist1(m, target) <= a.aura)];
  }

  abilityDamage(a, der) {
    this.breakSanctuary();
    const hit = this.damageTargets(a);
    if (!hit.length) { this.log(a.name + ' finds no target in the light.'); return; }
    const bonus = this.abilityBonus(a.damage, der);
    const spread = !!(a.aura || a.sight);
    let held = 0;
    for (const m of hit) {
      /* FINISHING. A foe already down to its last share does not get rolled
       * for — the working is the finish, not another blow. Measured before
       * the damage, so "already down to a third" means what it says. */
      if (a.execute && m.hp <= Math.max(1, Math.round(m.maxhp * a.execute))) {
        this.log(a.name + ' finds the seam — the ' + m.t.name + ' stops.');
        this.killMonster(m);
        if (this.dying) return;
        continue;
      }
      const dmg = Math.max(1, this.rollDamage(this.casterDice(a.damage)) + bonus);
      this.log(a.name + (spread ? ' blasts the ' : ' strikes the ') + m.t.name + ' for ' + dmg + '!');
      this.applyDamageToMonster(m, dmg, false, der);
      if (this.dying) return;
      /* HOLDING. monsterTakeTurn has read `stunned` since the Wand of Frost;
       * this is the first thing that sets it for more than a heartbeat. */
      if (a.stun && m.hp > 0) {
        m.stunned = Math.max(m.stunned || 0, a.stun);
        held++;
      }
    }
    if (held) {
      this.log('The cold closes: ' + held + (held === 1 ? ' of them stands still.' : ' of them stand still.'));
    }
  }

  /* THE CASTER'S DICE.
   *
   * A fighter's damage grows twice over — the level step every ability
   * gets, and a better weapon off the floor — while a staff is a staff for
   * ever. Measured at level six: the mage's PAID Firebolt (3-10) matched
   * the fighter's FREE swing (3-10), which is the "kinda crap offensively"
   * the playtest reported, and it is arithmetic, not taste. So an attack
   * that scales on INT gains a die with practice, the way every edition of
   * this game's ancestors scaled a caster: one more at level five, another
   * at ten, another at fifteen. Loot is the fighter's second curve; this
   * is the mage's.
   *
   * And it is EVERY ability's, because the same measurement damns the
   * lot: at level six a Backstab rolled 2-7 and a Shield Bash 2-7 while
   * the same character's FREE swing rolled 3-8 and 3-10. An ability that
   * costs power and a cooldown to do less than swinging is not a choice
   * anyone should be asked to make, and no amount of flavour text fixes
   * arithmetic. */
  casterDice(dmg) {
    if (!dmg) return dmg;
    const p = this.state.player;
    const extra = Math.floor(((p && p.level) || 1) / 5);
    if (!extra) return dmg;
    return { ...dmg, dice: (dmg.dice || 1) + extra };
  }

  abilityBonus(dmg, der) {
    /* Effective stats, not the raw sheet: a Ring of Might and a Potion of
     * Titan's Grip were both invisible to every ability that scales on STR. */
    const eff = (der && der.effValues) || this.derived().effValues;
    let b = 0;
    if (dmg && dmg.int) b += abilityMod(eff.int);
    else if (dmg && dmg.n === 'str') b += abilityMod(eff.str);
    /* And practice counts. Every ability in the game was flat dice forever —
     * a level 12 Firebolt was the same 1d8+INT as a level 1 one — while a
     * fighter's damage grew with the weapon, the strength and the level. That
     * is the whole reason the Mage measured as the WEAKEST attacker at depth
     * despite having the only attack that cannot miss. The same step the
     * player's own weapon gets (derived: bonus += floor((level-1)/3)). */
    b += Math.floor((this.state.player.level - 1) / 3);
    return b;
  }

  /* EVERY burst heal comes through here, so the floor cannot be applied in
   * three places and drift apart in two of them. See HEAL_FLOORS in base.js
   * for why there is a floor at all.
   *
   * Returns what was actually mended, not what was rolled: at 55 of 58 the old
   * log line promised +7 and delivered 3, and under a floor that lie only gets
   * larger. */
  /* THE RESTED LINE: how far up the bar sitting down can reach. */
  restedCap(who) {
    const p = who || this.state.player;
    if (!p) return 0;
    return Math.max(this.woundFloorHp(p), p.maxhp - (p.wounds || 0));
  }

  /* However badly used, half a bar is always yours to rest back to. */
  woundFloorHp(who) {
    const p = who || this.state.player;
    return Math.max(1, Math.ceil(p.maxhp * WOUND_FLOOR));
  }

  /* A share of every blow, carried as a FRACTION. Rounding each hit up would
   * make fifteen scratches worse than one mauling and would be lethal on a
   * 22 point bar — the same mistake as clamping the regeneration fraction up
   * to a whole point, which is what made that constant meaningless. */
  takeWound(dmg, who) {
    const p = who || this.state.player;
    if (!p || !(dmg > 0)) return 0;
    if (!p.counters) p.counters = {};
    p.counters.woundMote = (p.counters.woundMote || 0) + dmg * WOUND_SHARE;
    const whole = Math.floor(p.counters.woundMote);
    if (whole < 1) return 0;
    p.counters.woundMote -= whole;
    const room = Math.max(0, p.maxhp - this.woundFloorHp(p) - (p.wounds || 0));
    const took = Math.min(whole, room);
    p.wounds = (p.wounds || 0) + took;
    return took;
  }

  mendWounds(n, who) {
    const p = who || this.state.player;
    if (!p || !(n > 0)) return 0;
    const closed = Math.min(p.wounds || 0, Math.floor(n));
    p.wounds = (p.wounds || 0) - closed;
    if (p.wounds <= 0 && p.counters) p.counters.woundMote = 0;
    return closed;
  }

  applyHeal(rolled, fraction, who) {
    const p = who || this.state.player;
    const roll = Math.max(1, Math.round(Number(rolled) || 0));
    const floor = fraction > 0 ? Math.max(1, Math.round(p.maxhp * fraction)) : 0;
    const want = Math.max(roll, floor);
    const before = p.hp;
    p.hp = Math.min(p.maxhp, p.hp + want);
    /* Past the rested line, and it closes a share of what it mends — which is
     * what makes a draught worth carrying once sitting down has a limit. */
    this.mendWounds(Math.round(want * HEAL_MENDS), p);
    return p.hp - before;
  }

  /* Who a healing touch falls on: the worst-hurt living member in reach of
   * the caster, the caster included. Healing was welded to the active
   * member — a cleric in a company could mend nobody but themselves, which
   * betrayed the game's single-character origins the moment there was
   * anyone else to save. An ability marked selfOnly (the Fighter's Second
   * Wind is his own breath, no one else's) keeps to its caster. */
  healTarget(a) {
    const p = this.state.player;
    if (a && a.selfOnly) return p;
    let best = p, worst = p.hp / Math.max(1, p.maxhp);
    for (const m of this.livingMembers()) {
      if (dist8(m, p) > 1) continue;
      const ratio = m.hp / Math.max(1, m.maxhp);
      if (ratio < worst) { worst = ratio; best = m; }
    }
    return best;
  }

  abilityHeal(a) {
    /* Hand-authored abilities carry "3d6"; generated ones carry {dice,sides}. */
    const roll = () => ((a.heal && typeof a.heal === 'object')
      ? this.rollDamage(a.heal)
      : evaluateDice(a.heal, this.rngOfTurn()));
    const fraction = healFractionForAbility(a);
    /* Mending for the company: everyone hurt within reach, each rolling
     * their own dice and each with their own floor, because a quarter of a
     * mage is not a quarter of a fighter. */
    if (a.party) {
      const p = this.state.player;
      const marks = this.livingMembers().filter((m) => dist1(m, p) <= a.party && m.hp < m.maxhp);
      let total = 0;
      const said = [];
      for (const m of marks) {
        const mended = this.applyHeal(roll(), fraction, m);
        total += mended;
        said.push((m === p ? 'you' : m.name) + ' ' + mended);
      }
      this.log(marks.length
        ? 'The old gods answer for all of you: ' + total + ' hit points — ' + said.join(', ') + '.'
        : 'The old gods answer, and nobody here needs it.');
      return;
    }
    const mark = this.healTarget(a);
    const mended = this.applyHeal(roll(), fraction, mark);
    this.log('Old forces knit ' + (mark === this.state.player ? 'your' : mark.name + '’s') +
      ' wounds for ' + mended + ' hit points.');
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

  /* Two kinds of buff: an edge on what you swing, and a skin against what
   * swings at you. `aura` doubles as the duration here because that is what
   * the validator has always passed; `turns` says it plainly. */
  abilityBuff(a) {
    const p = this.state.player;
    /* Grows with practice, like everything else an ability does — a mantle
     * that turns aside three blows' worth is a wall at level 3 and a rumour at
     * level 13, and the blows themselves nearly double over that stretch. */
    const bonus = Math.max(1, (a.bonus || 2) + Math.floor((p.level - 1) / 4));
    const turns = Math.max(2, a.turns || a.aura || 5);
    /* THE SHADOW. Nothing hunts what it cannot see: a hidden member drops
     * out of every monster's targeting the way Sanctuary's reader does,
     * and the first blow from the dark is the whole point of going there —
     * attackMonster pays it out and ends the hiding. */
    if (a.buff === 'shadow') {
      p.buffs.shadow = turns;
      this.log('You step out of the world’s attention. (' + turns + ' turns, or one blow)');
      return;
    }
    const kind = a.buff === 'ward' ? 'ward' : 'might';
    /* A mantle worn for the company rather than for yourself: `party` is a
     * radius in steps, and everyone standing inside it wears the same one.
     * Their countdowns tick on their own turns — tickMemberStatus already
     * runs for every living member, which is why this needs nothing else. */
    const marks = a.party
      ? this.livingMembers().filter((m) => dist1(m, p) <= a.party)
      : [p];
    for (const m of marks) {
      if (!m.buffs) m.buffs = {};
      if (!m.buffLevels) m.buffLevels = {};
      m.buffs[kind] = turns;
      m.buffLevels[kind] = bonus;
    }
    /* NAME THEM. "2 of you" is not an answer to the only question a
     * protective working raises, which is whether it covered the person you
     * cast it for — the playtest watched a priest take a blow and could not
     * tell whether the ward had been on them or not. */
    const many = marks.length > 1;
    const who = marks.map((m) => (m === p ? 'you' : m.name));
    const list = who.length > 1
      ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1]
      : who[0];
    this.log(kind === 'ward'
      ? (many
        ? 'You plant, and the company plants with you — ' + list + ': ' + bonus +
          ' turned aside from every blow, ' + turns + ' turns.'
        : 'A skin of cold air closes over you: ' + bonus + ' turned aside from every blow, ' + turns + ' turns.')
      : (many
        ? 'Every arm here steadies — ' + list + ': +' + bonus + ' to hit, ' + turns + ' turns.'
        : 'Your aim sharpens: +' + bonus + ' to hit for ' + turns + ' turns.'));
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
    const user = this.state.player;
    const fx = item.effects || {};
    if (item.kind === 'potion' || item.kind === 'scroll' || item.slot === 'consumable') {
      /* A refused draught costs neither the flask nor the turn. */
      if (this.consumeItem(item, fx) === false) return;
    } else if (item.kind === 'wand') {
      this.castWand(item);
    } else if (isWorn(item)) {
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
    this.endPlayerTurn(undefined, user);
  }

  consumeItem(item, fx) {
    const p = this.state.player;
    /* Drinking at full health spent the flask AND the turn for nothing. The
     * altar has always refused that trade; so does this now. */
    if (fx.heal && p.hp >= p.maxhp) { this.log('You are whole. The flask stays corked.'); return false; }
    if (fx.heal) { const v = this.applyHeal(evaluateDice(fx.heal, this.rngOfTurn()), healFractionForItem(item)); this.log('Sweet relief: +' + v + ' HP.'); }
    else if (fx.power) { const v = evaluateDice(fx.power, this.rngOfTurn()); p.power = Math.min(p.maxpower, p.power + v); this.log('Crackling force surges: +' + v + ' PWR.'); }
    else if (fx.buffStr) { p.buffs.str = fx.buffStr; this.log('Your arm bulges with borrowed might.'); }
    else if (fx.removeCurse) { this.removeAllCurses(); }
    else if (fx.identify) { this.identifyAll(); }
    else if (fx.teleport) { this.teleportRandom(); }
    else if (fx.map) { if (this.revealMap() === false) return false; }
    else if (fx.flame) { if (this.scrollFlame(fx.flame) === false) return false; }
    else if (fx.sanctuary) { p.buffs.sanctuary = fx.sanctuary; this.log('For a while, the dark forgets your name.'); }
    else if (fx.recall) { if (!this.scrollRecall()) return false; }
    else { this.log('It does nothing you can perceive.'); }
    const idx = p.inventory.indexOf(item);
    if (idx >= 0) p.inventory.splice(idx, 1);
    /* Drinking the potion that was in a belt loop used to empty the loop, even
     * with four more of the same in the pack — so every draught cost a trip to
     * the Gear tab. The loop refills itself from the rest of the stack. */
    const loop = p.belt.findIndex((e) => this.beltUid(e) === item.uid);
    this.unbindItem(item);
    if (loop >= 0) this.refillBeltLoop(loop, item);
  }

  /* The replacement has to be one nothing else is holding, or refilling one
   * loop would quietly empty another. */
  refillBeltLoop(loop, spent) {
    const p = this.state.player;
    const key = itemStackKey(spent);
    const bound = new Set(p.belt.map((e) => this.beltUid(e)).filter(Boolean));
    const next = p.inventory.find((it) => it && !bound.has(it.uid) && itemStackKey(it) === key);
    if (!next) return;
    if (!next.uid) next.uid = rngIntId();
    p.belt[loop] = next.uid;
  }

  scrollFlame(dice) {
    const p = this.state.player;
    const floor = this.currentFloor;
    let target = null, best = 1e9;
    for (const m of floor.monsters) {
      const d = dist1(m, p);
      if (d < best) { best = d; target = m; }
    }
    /* Nothing to burn, nothing spent: the refused-draught law. */
    if (!target) { this.log('The flame finds nothing to burn — the scroll stays rolled.'); return false; }
    const dmg = evaluateDice(dice, this.rngOfTurn());
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
      /* Wands written before the heal was data still roll the old 1d6+3 —
       * and a healing wand, like a healing touch, favours whoever in reach
       * is worst hurt. */
      const mark = this.healTarget(null);
      const v = this.applyHeal(fx.heal ? evaluateDice(fx.heal, r) : r.d(6) + 3, healFractionForItem(item), mark);
      this.log('The wand warms ' + (mark === p ? 'you' : mark.name) + ': +' + v + ' HP. (' + fx.charges + ' charges)');
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

  /* A worn curse holds. unequip refused to remove one, but equip would happily
   * SWAP one out — so "will not come off" was a door with no wall around it.
   * Failing to shift it is also how a hidden curse announces itself. */
  curseHolds(cur, doing) {
    if (!cur || !cur.cursed) return false;
    const hidden = cur.identified === false;
    this.revealItem(cur);
    this.log(hidden
      ? 'You try to ' + doing + ' — and cannot. The ' + cur.name + ' is cursed! Seek a Draught of Unbinding, or an altar.'
      : 'The cursed ' + cur.name + ' will not come off! Seek a Draught of Unbinding.');
    return true;
  }

  /* Asked of the TEMPLATE as well as the item, because items in old saves —
   * including copies asleep in floor memories as dropped loot — are snapshots
   * from before the rule existed. A stamp-on-load migration missed those:
   * measured, an unflagged sword from a floor drop equipped beside a shield. */
  isTwoHandedItem(it) {
    if (!it) return false;
    if (it.twoHanded) return true;
    const t = it.id ? getItemTemplate(it.id) : null;
    return !!(t && t.twoHanded);
  }

  equip(item, who) {
    const p = who || this.state.player;
    const slot = item.slot;
    if (!WEARABLE_SLOTS.includes(slot)) { this.useItem(item); return; }
    const cur = p.equipment[slot];
    if (this.curseHolds(cur, 'swap it out')) return;

    /* Both hands are both hands: a two-handed weapon and a shield cannot be
     * held at once. Equipping either slings the other to your pack — with a
     * log line, since gear quietly vanishing reads as a bug — and refuses
     * cleanly when the pack is full or a curse has the conflicting hand. */
    if (slot === 'weapon' && this.isTwoHandedItem(item) && p.equipment.shield) {
      const shield = p.equipment.shield;
      if (this.curseHolds(shield, 'free your shield arm')) return;
      if (p.inventory.length >= PACK_LIMIT) { this.log('Your pack is too full to sling the ' + shield.name + '.'); return; }
      p.equipment.shield = null;
      p.inventory.push(shield);
      this.log('Both hands on the ' + item.name + ' — the ' + shield.name + ' goes on your back.');
    }
    if (slot === 'shield' && this.isTwoHandedItem(p.equipment.weapon)) {
      const w = p.equipment.weapon;
      if (this.curseHolds(w, 'put the ' + w.name + ' up')) return;
      if (p.inventory.length >= PACK_LIMIT) { this.log('Your pack is too full to sling the ' + w.name + '.'); return; }
      p.equipment.weapon = null;
      p.inventory.push(w);
      this.log('You sling the ' + w.name + ' to take up the ' + item.name + '.');
    }

    p.equipment[slot] = item;
    const idx = p.inventory.indexOf(item);
    if (idx >= 0) p.inventory.splice(idx, 1);
    this.unbindItem(item, p);   /* worn is not carried: it leaves the belt */
    if (cur) { p.inventory.push(cur); this.log('You swap the ' + cur.name + ' for the ' + item.name + '.'); }
    else { this.log('You ready the ' + item.name + '.'); }
    p.maxpower = this.computeMaxPower();
    p.power = Math.min(p.maxpower, p.power);
  }

  unequip(slot, who) {
    const p = who || this.state.player;
    const cur = p.equipment[slot];
    if (!cur) return;
    if (this.curseHolds(cur, 'set it down')) return;
    if (p.inventory.length >= PACK_LIMIT) { this.log('Your pack is full.'); return; }
    p.inventory.push(cur);
    p.equipment[slot] = null;
    p.maxpower = this.computeMaxPower();
    p.power = Math.min(p.maxpower, p.power);
    this.log('You set down the ' + cur.name + '.');
  }

  drop(item, who) {
    const p = who || this.state.player;
    const idx = p.inventory.indexOf(item);
    if (idx < 0) return;
    p.inventory.splice(idx, 1);
    this.unbindItem(item, p);
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

  beltItem(index, who) {
    const p = who || this.state.player;
    const uid = this.beltUid(p.belt[index]);
    if (!uid) return null;
    return p.inventory.find((it) => it && it.uid === uid) || null;
  }

  unbindItem(item, who) {
    const p = who || this.state.player;
    if (!p || !item || !item.uid) return;
    for (let i = 0; i < p.belt.length; i++) {
      if (this.beltUid(p.belt[i]) === item.uid) p.belt[i] = null;
    }
  }

  setBelt(index, item, who) {
    const p = who || this.state.player;
    if (index < 0 || index >= p.belt.length) return;
    if (!item) { p.belt[index] = null; return; }
    if (p.inventory.indexOf(item) < 0) return;
    if (!item.uid) item.uid = rngIntId();
    this.unbindItem(item, p);   /* one loop per item: binding again moves it */
    p.belt[index] = item.uid;
    this.log('Bound to the belt: ' + item.name + '.');
  }

  /* The first free loop, so binding is one click rather than a puzzle. */
  bindToBelt(item, who) {
    const p = who || this.state.player;
    if (!item) return false;
    if (!item.uid) item.uid = rngIntId();
    if (p.belt.some((e) => this.beltUid(e) === item.uid)) {
      this.log(item.name + ' is already on your belt.');
      return false;
    }
    const free = p.belt.findIndex((x) => !x);
    if (free < 0) { this.log('Your belt is full. Unbind something first.'); return false; }
    this.setBelt(free, item, p);
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

  /* The moment a thing stops lying: the true name swaps in, curse and all. */
  revealItem(it) {
    if (!it || it.identified !== false) return false;
    it.identified = true;
    if (it.trueName) { it.name = it.trueName; delete it.trueName; }
    return true;
  }

  /* HANDING SOMETHING OVER. Free while the party is marching — they walk in
   * each other's pockets — but mid-fight it takes a hand in reach: the giver
   * and the taker must stand beside each other. Arranging straps is a free
   * action either way; DRINKING what you were handed still costs the turn of
   * whoever drinks it. */
  giveItem(item, to, from) {
    const giver = from || this.state.player;
    if (!giver || !to || to === giver) return false;
    const idx = giver.inventory.indexOf(item);
    if (idx < 0) { this.log('You are not carrying that.'); return false; }
    if (to.hp <= 0) { this.log(to.name + ' is in no state to carry anything.'); return false; }
    /* Reach matters only IN THE THICK OF IT. The gate used to be the
     * calm radius — nine tiles — so one woken thing across the room, or
     * behind a wall, made the whole company unable to pass a potion down
     * a quiet corridor. What the rule is actually for is stopping a
     * cross-room handoff while blades are out, so it asks the narrow
     * question: is anything hostile close enough to interrupt either of
     * them? If not, hands are free however far apart they stand. */
    const pressed = (this.currentFloor.monsters || []).some((m) =>
      m.hp > 0 && m.aggro && !m.submerged && !(m.stunned > 0) &&
      (dist8(m, giver) <= 2 || dist8(m, to) <= 2));
    if (pressed && dist8(giver, to) > 1) {
      this.log(to.name + ' is not in reach — not with something this close.');
      return false;
    }
    if (to.inventory.length >= PACK_LIMIT) { this.log(to.name + '\'s pack is full.'); return false; }
    giver.inventory.splice(idx, 1);
    this.unbindItem(item, giver);
    to.inventory.push(item);
    this.log(this.nameOf(giver) === 'you'
      ? 'You hand the ' + item.name + ' to ' + to.name + '.'
      : giver.name + ' hands the ' + item.name + ' to ' + this.nameOf(to) + '.');
    return true;
  }

  identifyAll() {
    const named = [];
    const held = this.companyItems();
    for (const it of held) { if (this.revealItem(it)) named.push(it.name); }
    if (named.length) {
      this.log('The letters settle and hold still: ' + named.join('; ') + '.');
      if (held.some((it) => it.cursed)) this.log('Some of what the company carries wishes you ill.');
    } else {
      this.log('You read by touch and firelight — all is known.');
    }
  }

  /* Every pack and every back in the company — the fallen included, their
   * gear travels with the rest. Reading and unbinding welded to the active
   * member was the heal-yourself bug wearing different clothes: a companion's
   * ring had to be handed over, read, and handed back. */
  companyItems() {
    const out = [];
    for (const m of (this.state.party && this.state.party.members) || []) {
      if (!m) continue;
      out.push(...(m.inventory || []), ...Object.values(m.equipment || {}));
    }
    return out.filter(Boolean);
  }

  /* THE COMPANY PURSE. Gold was stored on whichever member held the reins
   * and spent from the same place — which was invisible while the reins
   * never moved, and became "my 2000 gold turned into 25" the moment a
   * chip click could hand them over. Coin belongs to the expedition: one
   * purse, on the party, wherever the reins happen to be. */
  purse() {
    const party = this.state && this.state.party;
    return (party && party.gold) || 0;
  }

  earnGold(n) {
    const party = this.state && this.state.party;
    if (!party || !(n > 0)) return 0;
    party.gold = (party.gold || 0) + Math.round(n);
    return Math.round(n);
  }

  /* Returns false and spends nothing when the purse is short, so no caller
   * can half-pay for anything. */
  spendGold(n) {
    const party = this.state && this.state.party;
    const cost = Math.round(n || 0);
    if (!party || (party.gold || 0) < cost) return false;
    party.gold = (party.gold || 0) - cost;
    return true;
  }

  removeAllCurses() {
    let n = 0;
    /* Lifting a curse also names it: you should know what it was that had you. */
    for (const it of this.companyItems()) {
      if (it.cursed) { this.revealItem(it); it.cursed = false; n++; }
    }
    this.log(n ? 'The curses slip away like sweat (' + n + ').' : 'Nothing is bound to anyone here.');
  }

  /* THE WAY HOME. Climbing out by the stairs is walking the same emptied
   * halls twice — monsters do not respawn, so the trip up is pure toll.
   * Refusals follow the refused-draught law: no scroll spent, no turn. */
  scrollRecall() {
    if (this.inTown()) { this.log('You are already under the Whetstone’s lamps.'); return false; }
    if (!this.outOfCombat()) { this.log('Not with something awake this close.'); return false; }
    const p = this.state.player;
    this.log('The words lift off the page and take the company with them.');
    this.enterTown(p.dungeonId);
    return true;
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
    /* Whatever shape it arrives in — a save written today, or one written
     * before there was a party — comes out with a party and a live accessor. */
    this.state = adoptParty(state);
    /* Saves written before floor memory existed simply have none. */
    if (!this.state.floors) this.state.floors = {};
    /* A floor memory says "monster 4 is dead" by index, which only means
     * anything against the generator that produced it. When the generator
     * changes shape, keep the character and forget the floors. */
    if (this.state.genVersion !== GEN_VERSION) {
      const had = Object.keys(this.state.floors).length;
      this.state.floors = {};
      this.state.genVersion = GEN_VERSION;
      if (had) this.log('The depths have been re-cut since you were last down. What you mapped is no longer true.');
    }
    const p = this.state.player;
    if (p) {
      if (p.hp <= 0) p.hp = 1;   /* a save caught mid-death resumed at zero */
      if (!p.deepest) p.deepest = {};
      if (!Number.isFinite(p.wounds) || p.wounds < 0) p.wounds = 0;
      /* Items in a save are copies of their template as it stood then. A rule
       * added to the template since — two-handedness — is re-stamped by id, and
       * the both-hands invariant is enforced on what the save was carrying. */
      const stamp = (it) => {
        if (!it) return;
        /* Enchanted under the old scheme: the name already says "+3 ... of the
         * Whetstone" but identified is false, so the card would show base
         * stats and an unread rune under a name that has spilled everything.
         * Nothing hidden remains to reveal — mark it read. */
        if (it.identified === false && !it.trueName) it.identified = true;
        if (!it.id) return;
        const t = getItemTemplate(it.id);
        if (t && t.twoHanded) it.twoHanded = true;
      };
      (p.inventory || []).forEach(stamp);
      Object.values(p.equipment || {}).forEach(stamp);
      if (p.equipment && this.isTwoHandedItem(p.equipment.weapon) && p.equipment.shield) {
        p.inventory.push(p.equipment.shield);
        this.log('You cannot hold the ' + p.equipment.weapon.name + ' and the ' + p.equipment.shield.name + ' at once — the shield goes to your pack.');
        p.equipment.shield = null;
      }
      if (!p.buffLevels) p.buffLevels = {};
      if (!p.beatsSeen) p.beatsSeen = {};
      if (!p.npcsMet) p.npcsMet = {};
      /* Characters from before the Arcanum turn: no background to invent
       * for them, but the learning their levels earned is owed in full. */
      for (const m of (this.state.party && this.state.party.members) || []) {
        if (!m) continue;
        if (!m.skills) m.skills = {};
        if (!Number.isFinite(m.skillPoints)) {
          m.skillPoints = Math.max(0, (m.level || 1) - 1);
          if (m.skillPoints > 0) this.log((m.name || 'A member') + ' has ' + m.skillPoints + ' unspent learning — the stat sheet takes it.');
        }
        /* The blink scroll gave up the name 'Recall' to the scroll that goes
         * home; copies already in a pack take the new name with them. */
        for (const it of m.inventory || []) {
          if (it && it.id === 'scroll-teleport' && it.name === 'Scroll of Recall') it.name = 'Scroll of Blinking';
        }
        /* Turn state is runtime-only — a save written mid-round restores
         * members already "acted", and the first march (and the form-up's
         * free step) skips them for a phantom round. */
        m.turnState = {};
      }
      /* THE BACK PAY.
       *
       * Experience used to be divided by the size of the company, and the
       * tier bands were never fitted for that — so every save written
       * under the old rule holds a party stranded below the ground it is
       * standing on, with no way out: the monsters that would pay for the
       * levels cannot be beaten at the level the split delivered. Fixing
       * the rule going forward does not rescue a character already stuck.
       *
       * So the split is refunded, once, on load. The leader's lifetime
       * earnings are multiplied by the company they were divided among,
       * and the whole company is brought to the level that buys — the
       * muster's own rule, that a companion stands at the leader's
       * measure. Marked on the state so it can never run twice. */
      if (!this.state.xpUnsplit) {
        this.state.xpUnsplit = true;
        const party3 = this.state.party;
        const roster = ((party3 && party3.members) || []).filter(Boolean);
        const lifetime = (m) => {
          let sum = m.xp || 0;
          for (let l = 1; l < (m.level || 1); l++) sum += XP_FOR_LEVEL(l);
          return sum;
        };
        if (roster.length > 1) {
          const leader = this.state.player || roster[0];
          /* The BEST-TRAVELLED member sets the mark, not whoever happens
           * to hold the reins: a company can be led by a fresh face with
           * veterans behind them, and keying off the leader would refund
           * that company nothing at all. */
          const owed = Math.max(...roster.map(lifetime)) * roster.length;
          /* What that buys, walked up the same ladder gainXP climbs. */
          let target = 1, left = owed;
          while (left >= XP_FOR_LEVEL(target)) { left -= XP_FOR_LEVEL(target); target++; }
          let raised = 0;
          for (const m of roster) {
            while ((m.level || 1) < target) { this.levelUp(m); raised++; }
            if (m === leader) m.xp = left;
            /* A raised character stands up whole: being handed levels at
             * the bottom of a dungeon you cannot leave is no favour if
             * you are still at two hit points. */
            if (m.hp > 0) { m.hp = m.maxhp; m.power = m.maxpower; }
          }
          if (raised) {
            this.log('The ledger is corrected: experience was never meant to be divided by the size of the company. The expedition stands at level ' + target + '.');
            this.journal('The reckoning was recounted — the company came into the levels its work had already earned.');
          }
        }
      }
      /* Expedition knowledge recorded before it was company-wide sits on
       * whichever sheet was active at the time — the demon fell to the
       * fighter and the town never heard. Pool it, and deal it back out. */
      {
        const members2 = (this.state.party && this.state.party.members) || [];
        const pool = { bossesSlain: {}, visitedDungeons: {}, explored: {}, deepest: {}, beatsSeen: {}, npcsMet: {} };
        for (const m of members2) {
          if (!m) continue;
          Object.assign(pool.bossesSlain, m.bossesSlain || {});
          Object.assign(pool.visitedDungeons, m.visitedDungeons || {});
          Object.assign(pool.explored, m.explored || {});
          Object.assign(pool.beatsSeen, m.beatsSeen || {});
          Object.assign(pool.npcsMet, m.npcsMet || {});
          for (const k in (m.deepest || {})) pool.deepest[k] = Math.max(pool.deepest[k] || 0, m.deepest[k]);
        }
        for (const m of members2) {
          if (!m) continue;
          m.bossesSlain = { ...pool.bossesSlain };
          m.visitedDungeons = { ...pool.visitedDungeons };
          m.explored = { ...pool.explored };
          m.deepest = { ...pool.deepest };
          m.beatsSeen = { ...pool.beatsSeen };
          m.npcsMet = { ...pool.npcsMet };
        }
      }
      /* A class whose base health was raised should raise it for the character
       * who reported the problem, not only for freshly rolled ones. */
      const c = CLASSES[p.cls];
      if (c && Number.isInteger(p.level)) {
        const floorHp = c.hpBase + Math.max(1, c.hpDie + abilityMod(p.stats.con));
        if (p.maxhp < floorHp) {
          const credit = floorHp - p.maxhp;
          p.maxhp += credit;
          p.hp = Math.min(p.maxhp, p.hp + credit);
          this.log('You are steadier on your feet than you remember. (+' + credit + ' max HP)');
        }
      }
      /* A character part-way to the next level under an older, steeper curve
       * should not have to earn that ground twice. */
      if (Number.isInteger(p.level) && p.xp >= XP_FOR_LEVEL(p.level)) this.gainXP(0);
      /* Two numbers claimed to be the maximum power: the one stored on the
       * player, which the bar and every "is it full" test read, and the one
       * derived() computes fresh from class, level and gear, which the
       * regeneration clamps to. A save carrying a stale stored one therefore
       * filled past its own brim and showed 26/20. One of them has to be the
       * answer, and it is the derived one. */
      p.maxpower = this.computeMaxPower();
      if (!(p.power <= p.maxpower)) p.power = p.maxpower;
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

