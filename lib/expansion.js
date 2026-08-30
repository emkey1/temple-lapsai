/* Expansion validation and prompt building.
 *
 * Split out of server.js so it can be tested without opening a socket, and so
 * both the prompt and the validator are generated from one vocabulary — see
 * public/js/contract.js. Nothing here trusts the model: every string is
 * whitelisted, every number clamped, every unknown field dropped.
 */

import {
  COLORS, PALETTE, ITEM_KINDS, SLOT_FOR_KIND, EFFECT_SPELLS,
  MONSTER_PROPS, DUNGEON_THEMES, CLASS_IDS, ABILITY_KINDS, LIMITS,
  PLAYER_GLYPH, enumList, quotedEnum,
} from '../public/js/contract.js';

const COLOR_SET = new Set(Object.keys(COLORS));
const ITEM_KIND_SET = new Set(ITEM_KINDS);
const SPELL_SET = new Set(EFFECT_SPELLS);
const PROP_SET = new Set(MONSTER_PROPS);
const THEME_SET = new Set(DUNGEON_THEMES);
const CLASS_SET = new Set(CLASS_IDS);
const ABILITY_KIND_SET = new Set(ABILITY_KINDS);

/* ------------------------------------------------------------------ *
 *  Primitives
 * ------------------------------------------------------------------ */

export function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function str(v, lo, hi, dflt = '') {
  if (typeof v !== 'string') return dflt;
  const s = v.trim();
  if (s.length === 0) return dflt;
  return s.slice(0, hi);
}

/* Case is meaningful on the map — lowercase reads as lesser, the way the base
 * bestiary uses it — so it is preserved rather than upper-cased away. */
export function glyph(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '?';
  const ch = [...s][0];
  return /[\x21-\x7e]/.test(ch) ? ch : '?';
}

export function color(v) {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return COLOR_SET.has(c) ? c : 'white';
}

/* Reads {dice, sides, bonus}, a bare number of sides, or "2d6+1". The die
 * count used to be hard-coded to 1, which flattened every generated monster —
 * a boss designed as 3d6 arrived as 1d6. */
export function dice(v, defaultSides = 6, defaultCount = 1) {
  let count = defaultCount;
  let sides = defaultSides;
  let bonus = 0;

  if (typeof v === 'number' && Number.isFinite(v)) {
    sides = clampInt(v, ...LIMITS.sides, defaultSides);
  } else if (typeof v === 'string') {
    const m = v.match(/(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i);
    if (m) {
      count = clampInt(m[1], ...LIMITS.dice, defaultCount);
      sides = clampInt(m[2], ...LIMITS.sides, defaultSides);
      if (m[3]) bonus = clampInt(m[3].replace(/\s+/g, ''), -20, 30, 0);
    }
  } else if (v && typeof v === 'object') {
    count = clampInt(v.dice ?? v.count ?? v.n, ...LIMITS.dice, defaultCount);
    sides = clampInt(v.sides, ...LIMITS.sides, defaultSides);
    bonus = clampInt(v.bonus, -20, 30, 0);
  }
  return { dice: count, sides, bonus };
}

/* ------------------------------------------------------------------ *
 *  Validators
 * ------------------------------------------------------------------ */

/* A heal may arrive as a number, as "2d4+2", or as the {dice,sides,bonus} the
 * prompt hands the model for weapon damage in the same breath. It used to
 * arrive as 1: clampInt does Number(v), Number("2d4+2") is NaN, and NaN takes
 * the default. Every healing potion the Library ever wrote was a one-hit-point
 * potion, and nobody noticed because nobody could see what an item did.
 *
 * Dice come back as a string, because that is what evaluateDice reads and what
 * the gear panel prints. */
export function healAmount(v) {
  if (typeof v === 'number' || /^\s*\d+\s*$/.test(String(v))) return clampInt(v, 1, 100, 1);
  const d = dice(v, 6, 1);
  const n = clampInt(d.dice, 1, 8, 1);
  const sides = clampInt(d.sides, 2, 12, 6);
  const bonus = clampInt(d.bonus, 0, 20, 0);
  return `${n}d${sides}${bonus ? '+' + bonus : ''}`;
}

/* The same value where dice cannot go: read a dice shape as what it averages
 * rather than throwing it away, because a model that writes {4,4,+4} for a
 * ring's power meant "a good one", not "one". */
export function flatAmount(v) {
  if (typeof v === 'number' || /^\s*-?\d+\s*$/.test(String(v))) return clampInt(v, 1, 100, 1);
  const d = dice(v, 6, 1);
  return clampInt(d.dice * (d.sides + 1) / 2 + d.bonus, 1, 100, 1);
}

export function validateEffects(e, opts) {
  if (!e || typeof e !== 'object') return {};
  const out = {};
  /* `power` carries two meanings on one field name: on a potion it is power to
   * restore, on a ring it is power to ADD TO YOUR MAXIMUM — and the second is
   * summed straight into an arithmetic expression. So only a consumable may
   * have dice there; a worn item keeps a plain integer, or equipmentPower
   * concatenates a string and max power comes out NaN. */
  const consumable = Boolean(opts && opts.consumable);
  if ('toHit' in e) out.toHit = clampInt(e.toHit, -10, 15, 0);
  if ('acBonus' in e) out.acBonus = clampInt(e.acBonus, -8, 12, 0);
  if ('heal' in e) out.heal = healAmount(e.heal);
  if ('power' in e) out.power = consumable ? healAmount(e.power) : flatAmount(e.power);
  if ('charges' in e) out.charges = clampInt(e.charges, 1, 30, 1);
  if ('regen' in e) out.regen = clampInt(e.regen, 1, 5, 1);
  if ('spell' in e && SPELL_SET.has(e.spell)) out.spell = e.spell;
  if ('seeSecrets' in e) out.seeSecrets = e.seeSecrets === true;
  if ('property' in e) out.property = str(e.property, 0, 20, '');
  const dmg = e.damage ?? e.dmg;
  if (dmg !== undefined) out.damage = dice(dmg, 6, 1);
  const sb = {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const raw = e[k] !== undefined ? e[k] : (e.statBonus && typeof e.statBonus === 'object' ? e.statBonus[k] : undefined);
    if (raw !== undefined && Number.isFinite(Number(raw))) sb[k] = clampInt(raw, -3, 5, 0);
  }
  if (Object.keys(sb).length) out.statBonus = sb;
  /* A healing wand mends a share of your health per charge (see HEAL_FLOORS),
   * so the thirty a model may ask for is six full bars out of a single drop.
   * Eight, the same as the one in the box. */
  if (out.spell === 'heal' && out.charges) out.charges = Math.min(out.charges, 8);
  return out;
}

export function validateItem(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('item payload missing');
  const kind = ITEM_KIND_SET.has(raw.kind) ? raw.kind : 'misc';
  return {
    type: 'item',
    name: str(raw.name, 2, 48, 'Curious Object'),
    kind,
    /* The slot comes from the kind, not from the model: an unrecognised slot
     * string would land in equipment under a name nothing ever reads. */
    slot: SLOT_FOR_KIND[kind] || 'misc',
    ...(kind === 'weapon' && raw.twoHanded === true ? { twoHanded: true } : {}),
    glyph: glyph(raw.glyph || '?'),
    color: color(raw.color),
    value: clampInt(raw.value, 0, 500000, 10),
    tier: clampInt(raw.tier, ...LIMITS.tier, 1),
    cursed: raw.cursed === true,
    /* A written curse arrives unread, or it would show in red the moment it
     * hit the pack — which is the exact thing this whole rule exists to stop. */
    identified: raw.cursed !== true,
    flavor: str(raw.flavor, 0, 240, ''),
    effects: validateEffects(raw.effects || raw, { consumable: SLOT_FOR_KIND[kind] === 'consumable' }),
  };
}

export function validateMonster(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('monster payload missing');
  const propsIn = Array.isArray(raw.props) ? raw.props : (Array.isArray(raw.properties) ? raw.properties : []);
  const goldMin = clampInt(raw.goldMin, 0, 100000, 0);
  /* The player is the only '@' on the map. An oracle that reached for the
   * obvious glyph for a humanoid would put a second one there. */
  const wanted = glyph(raw.glyph || 'M');
  const tier = clampInt(raw.tier, ...LIMITS.tier, 1);
  const m = {
    type: 'monster',
    name: str(raw.name, 2, 40, 'Unknown Horror'),
    glyph: wanted === PLAYER_GLYPH ? 'M' : wanted,
    /* No colour. Monsters are tinted from their tier by monsterTint when they
     * are drawn, so red on the map always means something alive — and an
     * oracle that picked "gold" could not paint a beast to look like loot. */
    tier,
    /* DEFAULTS THAT KNOW WHAT TIER THEY ARE.
     *
     * A flat 10 hit points, AC 10 and 1d6 is a reasonable stand-in for a
     * creature nobody said anything about, and nonsense for a tier-12 one:
     * a model that writes a magnificent name and skips the numbers used to
     * yield a boss a first-level thief could kill in two swings. These are
     * the shipped bestiary's own curve, kept deliberately just UNDER it — a
     * Sewer Rat sits at tier 0 and a Great Wyrm at 12 — so an under-specified
     * monster arrives playable at whatever depth it claimed, and errs toward
     * being a little soft rather than a little unfair. Anything the model DID
     * say still wins; these only fill silence. */
    hpMax: clampInt(raw.hpMax, 1, 4000, Math.round(3 + tier * tier * 0.75 + tier * 1.2)),
    ac: clampInt(raw.ac, -10, 12, Math.max(2, 11 - Math.round(tier * 0.7))),
    toHit: clampInt(raw.toHit, -5, 20, Math.round(tier * 0.6)),
    damage: dice(raw.damage ?? raw.dmg, 6, Math.max(1, Math.round(tier / 4))),
    dmgBonus: clampInt(raw.dmgBonus ?? raw.damageBonus, 0, 20, 0),
    xp: clampInt(raw.xp, 1, 100000, Math.max(5, Math.round(5 + tier * tier * 5))),
    goldMin,
    goldMax: clampInt(raw.goldMax, goldMin, 100000, Math.max(goldMin, 10)),
    speed: clampInt(raw.speed, 1, 4, 1),
    aggroRange: clampInt(raw.aggroRange, 1, 20, 8),
    /* `props` is what the engine reads. Emitting `properties` here is what made
     * every generated monster inert — no undead, no ranged, no flying. */
    props: [...new Set(propsIn.filter((p) => PROP_SET.has(p)))].slice(0, 6),
    flavor: str(raw.flavor, 0, 240, ''),
  };
  if (m.goldMax < m.goldMin) m.goldMax = m.goldMin;
  /* CLAW, CLAW, BITE — an attack routine REPLACES the single attack in melee,
   * capped at three blows and budgeted against it: a routine averaging more
   * than the single attack it replaces is a buff wearing texture's clothes,
   * so anything over budget is dropped whole rather than trimmed into a
   * different monster than the model designed. */
  if (Array.isArray(raw.attacks) && raw.attacks.length) {
    const avg = (d) => d.dice * (d.sides + 1) / 2 + (d.bonus || 0);
    const attacks = raw.attacks.slice(0, 3).map((a) => ({
      name: str(a && a.name, 0, 20, 'blow') || 'blow',
      damage: dice(a && (a.damage ?? a.dmg), 4, 1),
    }));
    const total = attacks.reduce((sum, a) => sum + avg(a.damage), 0);
    if (total <= avg(m.damage) * 1.25) m.attacks = attacks;
  }
  return m;
}

export function validateAbility(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ability payload missing');
  const kind = ABILITY_KIND_SET.has(raw.kind) ? raw.kind : 'passive';
  const out = {
    type: 'ability',
    cls: CLASS_SET.has(raw.cls) ? raw.cls : (CLASS_SET.has(raw.class) ? raw.class : 'fighter'),
    name: str(raw.name, 2, 40, 'New Ability'),
    level: clampInt(raw.level, ...LIMITS.abilityLevel, 1),
    kind,
    powerCost: clampInt(raw.powerCost, 0, 50, 0),
    cooldown: clampInt(raw.cooldown, 0, 20, 0),
    range: clampInt(raw.range, 1, 30, 1),
    description: str(raw.description, 0, 300, ''),
    flavor: str(raw.flavor, 0, 240, ''),
  };
  /* Only what the ability actually needs. The old validator invented an aura
   * and a power for every ability and wrote NaN into the die count, which
   * JSON.stringify then persisted as null. */
  if (raw.aura !== undefined) out.aura = clampInt(raw.aura, 1, 8, 3);
  if (raw.bonus !== undefined) out.bonus = clampInt(raw.bonus, 1, 30, 1);
  if (raw.turns !== undefined) out.turns = clampInt(raw.turns, 2, 12, 5);
  /* Which skin a buff puts on: an edge on what you swing, or armour against
   * what swings at you. Anything else is the edge, as it always was. */
  if (kind === 'buff') out.buff = raw.buff === 'ward' ? 'ward' : 'might';
  /* Renewal is deliberately NOT something the oracle may write. The engine
   * grants it through one passive (see Ebb & Flow), because a model-written
   * ability that hands power back is a fountain in any class that has
   * something expensive to spend it on — a Fighter with one casts Second Wind,
   * which mends half its maximum health, without limit. */
  if (kind === 'heal') out.heal = dice(raw.heal ?? raw.damage, 6, 2);
  if (raw.damage !== undefined && kind !== 'heal') out.damage = dice(raw.damage, 6, 1);
  if (kind === 'teleport') out.teleportRng = clampInt(raw.teleportRng ?? raw.range, 1, 12, 6);
  /* An AT-WILL attack is one that costs nothing and waits for nothing, and
   * powerCost and cooldown both DEFAULT to zero — so a model that simply did
   * not mention them wrote one. Left unbounded that is 10d100+30 in an
   * eight-tile blast at range thirty, every turn, for ever. The game ships one
   * at-will attack (the Mage's Witch-Spark, 1d4 at six paces) and this is the
   * budget it lives inside: a single small die, no bonus, no blast, short
   * range. Anything that wants to be bigger has to cost something. */
  if (kind === 'damage' && !out.powerCost && !out.cooldown) {
    out.range = Math.min(out.range || 1, 6);
    delete out.aura;
    if (out.damage) {
      out.damage = { dice: 1, sides: Math.min(out.damage.sides || 4, 6), bonus: Math.min(out.damage.bonus || 0, 0) };
    }
  }
  return out;
}

/* HOW DEEP A WRITTEN SANCTUM SITS, and who may walk into it.
 *
 * Nothing scaled a generated dungeon to the party — monsters take their
 * numbers from depth and the dungeon's own `threat`, deliberately, because
 * scaling on the player's level inflates every monster they have yet to meet.
 * That left the whole question of difficulty to a model's judgement and one
 * line of prompt: a generous one hands a post-game party a threat-1 stroll,
 * and a dramatic one hands a level-3 company something with four hundred hit
 * points and no warning.
 *
 * So: a floor under the threat, from what the party has already finished, and
 * a MINIMUM LEVEL derived from the boss rather than claimed. Boss tier is the
 * one number that cannot be talked up — the validator has already clamped it,
 * and it is what actually decides whether the fight is survivable. Against the
 * shipped three (bosses at tier 7, 9 and 12, tuned by measurement for levels
 * 5-7, 8-10 and 11-13), tier minus one lands on 6, 8 and 11. */
export function validateDungeon(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('dungeon payload missing');
  const boss = raw.boss ? validateMonster({ ...raw.boss, tier: clampInt(raw.boss.tier, 3, 15, 5) }) : null;
  /* A written sanctum comes AFTER the founding chronicle, so it may not be
   * gentler than the last thing the company cleared. */
  const floorThreat = clampInt(opts.minThreat, 0, LIMITS.threat[1], 0);
  const threat = Math.max(floorThreat, clampInt(raw.threat, ...LIMITS.threat, 0));
  const minLevel = boss ? Math.max(1, boss.tier - 1) : 1;
  return {
    type: 'dungeon',
    name: str(raw.name, 2, 48, 'The Unknown Sanctum'),
    title: str(raw.title, 0, 80, ''),
    flavor: str(raw.flavor, 0, 400, 'A strange place beneath the earth.'),
    floors: clampInt(raw.floors, ...LIMITS.floors, 3),
    theme: THEME_SET.has(raw.theme) ? raw.theme : 'temple',
    threat,
    minLevel,
    monsters: Array.isArray(raw.monsters) ? raw.monsters.slice(0, 4).map(validateMonster) : [],
    items: Array.isArray(raw.items) ? raw.items.slice(0, 3).map(validateItem) : [],
    boss,
  };
}

export function validateExpansion(obj, opts = {}) {
  const type = obj && typeof obj === 'object' ? obj.type : '';
  switch (type) {
    case 'item': return validateItem(obj.item || obj.payload || obj);
    case 'monster': return validateMonster(obj.monster || obj.payload || obj);
    case 'ability': return validateAbility(obj.ability || obj.payload || obj);
    case 'dungeon': return validateDungeon(obj.dungeon || obj.payload || obj, opts);
    default: throw new Error(`unsupported expansion type: ${type}`);
  }
}

/* ------------------------------------------------------------------ *
 *  Prompt building — every enum below is generated from the contract
 * ------------------------------------------------------------------ */

const SHARED = `
Valid colors for ITEMS: ${enumList(PALETTE)}. Monsters take no color — the map tints them from their tier, coldest to hottest, so the player can read danger at a glance.
"glyph" is ONE ASCII character shown on the map; case is kept, and lowercase conventionally means a lesser creature. "${PLAYER_GLYPH}" is the player and is never given to anything else.
"tier" is ${LIMITS.tier[0]}-${LIMITS.tier[1]} (0=harmless, 3=normal floor 1, 8=deep, 12+=endgame).
Dice are {"dice":int ${LIMITS.dice[0]}-${LIMITS.dice[1]}, "sides":int, "bonus":int} — the die COUNT matters, so a heavy hitter should use 2 or 3 dice.
`;

/* One definition each, because the dungeon prompt has to be able to include
 * what it asks for — see the dungeon branch below for what happened when it
 * could not. */
const MONSTER_FIELDS = `{ "name":string, "glyph":string, "tier":int, "hpMax":int, "ac":int, "toHit":int, "damage":{"dice":int,"sides":int,"bonus":int}, "dmgBonus":int, "xp":int, "goldMin":int, "goldMax":int, "speed":int 1-4, "aggroRange":int, "props":[${quotedEnum(MONSTER_PROPS)}], "flavor":string}`;

const ITEM_FIELDS = `{ "name":string, "kind":${quotedEnum(ITEM_KINDS)}, "glyph":string, "color":string, "value":int, "tier":int, "cursed":bool, "twoHanded":bool (weapons only; cannot be held with a shield), "flavor":string, "effects":{ "toHit":int, "acBonus":int, "damage":{"dice":int,"sides":int,"bonus":int}, "heal":int, "power":int, "charges":int, "regen":int, "seeSecrets":bool, "spell":${quotedEnum(EFFECT_SPELLS)}, "statBonus":{"str":int,"dex":int,"con":int,"int":int,"wis":int,"cha":int}}}`;

export function buildPrompt(action, context) {
  const ctx = context || {};
  /* focus is the field the client sends and the README documents; it used to
   * be ignored entirely, and only worked because the same string arrived as
   * theme as well. */
  const focus = ctx.focus ? ` The player asks specifically for: ${String(ctx.focus).slice(0, 400)}.` : '';
  const theme = ctx.theme && ctx.theme !== ctx.focus ? ` Theme/feel: ${String(ctx.theme).slice(0, 200)}.` : '';
  const depth = ctx.depth !== undefined
    ? ` Pitch it at an adventurer around level ${clampInt(ctx.depth, 1, 20, 1)} — tier roughly ${clampInt(ctx.depth, 1, 20, 1) + 1}.`
    : '';
  const world = ctx.existing
    ? ` Existing world elements to riff on (stay distinct from them): ${String(ctx.existing).slice(0, 600)}.`
    : '';

  /* THE WORLD IT IS WRITING INTO.
   *
   * Without this the oracle wrote for a generic 1982 module, because a list
   * of dungeon names is all it was ever told. The briefing carries the
   * history, the powers, who is already down there and — the part that does
   * the most work — the REGISTER: everything in this setting is bookkeeping
   * that outlived its clerks, and a model given the facts without the tone
   * writes high fantasy straight over the top of them. */
  const lore = ctx.lore
    ? `

THE WORLD THIS BELONGS TO. Write something that could be met by the same party on the same expedition, owed to or feared by the powers below. Do not restate this back; use it.
${String(ctx.lore).slice(0, 2000)}`
    : '';

  /* A NAMED SOURCE, when the player asks for one.
   *
   * "In the manner of Alice in Wonderland" should produce this world's
   * version of that book's LOGIC — the shapes, the imagery, the kind of
   * wrongness — and not a crossover. Borrow the grammar, never the cast: a
   * Cheshire Cat in the Whetstone is a costume, whereas a toll collected in
   * riddles by something that is only ever present in part is the same idea
   * wearing this world's clothes. */
  const source = ctx.source
    ? `

DRAW ON: ${String(ctx.source).slice(0, 200)}. Take its imagery, its logic and its kind of strangeness — NOT its characters, names or plot. Nothing should be recognisable as a borrowed figure; it should read as though this world had arrived at the same idea on its own, in its own vocabulary.`
    : '';

  const base = `You are co-designing content for a tabletop-styled, turn-based dungeon crawler inspired by the dungeon crawlers of 1982.${focus}${theme}${depth}${world}${lore}${source}

Output STRICT JSON only (no markdown fences, no prose) matching exactly one of the schemas below. Make it flavorful, concise, balanced, and evocative of classic 1980s pen-and-paper modules. Names should be short and memorable.`;

  if (action === 'item') {
    return base + `
CREATE A NEW ITEM.
Schema: {"type":"item","item":${ITEM_FIELDS}}
The slot is decided by the kind, so do not send one. Weapons need damage; armor and shields need acBonus. Only a small minority should be cursed.${SHARED}`;
  }

  if (action === 'monster') {
    return base + `
CREATE A NEW MONSTER.
Schema: {"type":"monster","monster":${MONSTER_FIELDS}}
AC uses DESCENDING values (10 = unarmored human, lower is tougher, 2 is a dragon). "props" drive behaviour: ranged attacks at a distance, flying only acts in sight, undead can be turned by clerics. An optional "attacks":[{"name":string,"damage":dice}] of up to 3 entries gives it a melee routine ("claw, claw, bite") that REPLACES its single attack — keep the routine's total average at or below the single attack's, or it will be rejected. Give it a memorable monstrous name.${SHARED}`;
  }

  if (action === 'ability') {
    return base + `
CREATE A NEW PLAYER ABILITY for a ${CLASS_SET.has(ctx.cls) ? ctx.cls : 'fighter'}.
Schema: {"type":"ability","ability":{ "cls":${quotedEnum(CLASS_IDS)}, "name":string, "level":int ${LIMITS.abilityLevel[0]}-${LIMITS.abilityLevel[1]}, "kind":${quotedEnum(ABILITY_KINDS)}, "powerCost":int, "cooldown":int, "range":int, "aura":int (only for blasts that hit an area), "damage":{"dice":int,"sides":int,"bonus":int} (for kind "damage"), "heal":{"dice":int,"sides":int,"bonus":int} (for kind "heal"), "buff":"might"|"ward" and "turns":int and "bonus":int (for kind "buff" — "might" adds to hit, "ward" turns damage aside), "description":string (rules text under 200 chars), "flavor":string}}
"level" is the character level that unlocks it. Make it feel like a classic class feature and keep the numbers modest.`;
  }

  if (action === 'dungeon') {
    /* THE SCHEMAS IT IS ASKED FOR, SPELLED OUT.
     *
     * This used to say "monsters":[2-3 MONSTER objects] and never say what a
     * MONSTER object was — those schemas were only ever emitted for their own
     * commissions. So the model wrote {name} and nothing else, the validator
     * filled the rest with its defaults, and a tier-12 boss came back with
     * ten hit points, no flavour and a d6. Every stat in a generated dungeon
     * was a default wearing a good name. */
    return base + `
CREATE A NEW DUNGEON.
Schema: {"type":"dungeon","dungeon":{ "name":string, "title":string, "flavor":string (3-5 sentences shown on entering), "floors":int ${LIMITS.floors[0]}-${LIMITS.floors[1]}, "theme":${quotedEnum(DUNGEON_THEMES)}, "threat":int ${LIMITS.threat[0]}-${LIMITS.threat[1]}, "monsters":[2-3 of MONSTER], "items":[1-2 of ITEM], "boss":MONSTER }}
where MONSTER is ${MONSTER_FIELDS}
and ITEM is ${ITEM_FIELDS}
FILL IN EVERY FIELD of each monster and item — a name alone is not a monster. Each one needs its own hpMax, ac, damage, xp and flavor, and the numbers must suit its tier: a tier-10 creature with ten hit points is a mistake, not a design.
AC DESCENDS (10 = unarmoured, 2 = a dragon). Monsters and items should feel native to the theme. The boss guards the lowest floor and must be markedly tougher than the rest — several damage dice, far more health, and a lower AC than anything else here.${SHARED}`;
  }

  return base;
}

export function extractJSON(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in LLM response');
  return JSON.parse(t.slice(start, end + 1));
}
