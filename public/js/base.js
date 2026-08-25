/* Core content data: classes, colors, monsters, items, abilities, dungeons. */

import { COLORS as PALETTE_COLORS } from './contract.js';

/* Palette lives in the content contract so the server validates against the
 * same names the canvas draws. Re-exported here for the modules that had it. */
export { COLORS } from './contract.js';

export const cls = (name) => PALETTE_COLORS[name] || '#9dc97a';

/* ---------------- Classes ---------------- */

export const CLASSES = {
  fighter: {
    id: 'fighter',
    name: 'Fighter',
    glyph: 'F',
    desc: 'Steel sinew of the expedition. High endurance, heavy armor, broad blades.',
    hpDie: 10,
    hpBase: 12,
    powerBase: 6,
    toHitBonus: 2,
    acBonus: 1,
    dmgBonus: 1,
    critBonus: 0.05,
    goldMul: 1.0,
    statAdj: { str: 1, dex: 0, con: 1, int: 0, wis: 0, cha: 0 },
    weapon: 'Broadsword',
    /* The basic loadout: what anyone of this calling walks in wearing.
     * Three rungs — green, seasoned, veteran — chosen by level, so a
     * high-priced hire arrives dressed for the floor they are owed. */
    armor: ['leather-armor', 'studded-armor', 'chainmail'],
    shield: 'small-shield',
    speed: 3,   /* tiles of ground a combat turn buys, before the blow */
  },
  thief: {
    id: 'thief',
    name: 'Thief',
    glyph: 'T',
    desc: 'Shadow of the torchlight. Swift, cunning, and quicker to the loot.',
    hpDie: 8,
    hpBase: 9,
    powerBase: 8,
    toHitBonus: 1,
    acBonus: 2,
    dmgBonus: 1,
    critBonus: 0.05,   /* the other 10% comes from Sharp & Keen, which now grants it */
    goldMul: 1.5,
    statAdj: { str: 0, dex: 2, con: 0, int: 1, wis: 0, cha: 0 },
    weapon: 'Short Sword',
    armor: ['leather-armor', 'studded-armor', 'studded-armor'],
    shield: null,   /* the other hand is for knives and locks */
    speed: 5,   /* the swift one: ground is the Thief's whole armour */
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    glyph: 'M',
    desc: 'Reader of the forbidden pages. Frail of frame, terrible of intent.',
    hpDie: 6,
    hpBase: 10,
    powerBase: 16,
    toHitBonus: 0,
    acBonus: 0,
    dmgBonus: 0,
    critBonus: 0.05,
    goldMul: 1.0,
    powerPerInt: 1,
    /* Was str -1 and con -1, which stacked a damage penalty on top of the
     * lowest hit points and the worst armour in the game. */
    statAdj: { str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0 },
    weapon: 'Staff',
    armor: ['padded-armor', 'padded-armor', 'leather-armor'],
    shield: null,   /* both hands belong to the staff */
    speed: 4,   /* unburdened by armour, if by nothing else */
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    glyph: 'C',
    desc: 'Voice of the old gods under the hill. Mace in one hand, mercy in no hand.',
    hpDie: 8,
    hpBase: 10,
    powerBase: 12,
    toHitBonus: 1,
    acBonus: 1,
    dmgBonus: 0,
    critBonus: 0.05,
    goldMul: 1.0,
    powerPerChr: 1,
    statAdj: { str: 0, dex: 0, con: 1, int: 0, wis: 2, cha: 1 },
    weapon: 'Mace',
    armor: ['leather-armor', 'studded-armor', 'chainmail'],
    shield: 'small-shield',
    speed: 3,   /* mail and conviction weigh about the same */
  },
};

/* T4, THE ARCANUM TURN: who you were before the stairs.
 *
 * A background is a past with a price — every one of them trades something
 * away, the way Arcanum's did, because a past that is all upside is just a
 * bonus with a paragraph attached. statAdj bakes into the rolled stats at
 * founding; perks ride derived() for the character's whole life; a free
 * skill rank is the trade a childhood teaches. */
export const BACKGROUNDS = [
  { id: 'unremarked', name: 'Unremarked', statAdj: {}, perks: {},
    blurb: 'No story worth a coin. The dark will write one for you.' },
  { id: 'temple-orphan', name: 'Temple Orphan', statAdj: { wis: 1, cha: -1 }, perks: { undeadResist: 1 },
    blurb: 'Raised in the ruin’s long shadow. The unhallowed feel oddly familiar, and people do not.' },
  { id: 'gravediggers-child', name: 'Gravedigger’s Child', statAdj: { con: 1, int: -1 }, perks: { regen: 0.5 },
    blurb: 'You grew up strong on turned earth, and never much needed to know why.' },
  { id: 'tinkers-apprentice', name: 'Tinker’s Apprentice', statAdj: { int: 1, str: -1 }, perks: { skill: 'lore' },
    blurb: 'Years at the bench, reading what others wind up and shake.' },
  { id: 'poachers-get', name: 'Poacher’s Get', statAdj: { dex: 1, cha: -1 }, perks: { skill: 'fieldcraft' },
    blurb: 'The woods fed you, and taught you where things hide.' },
  { id: 'debt-ridden', name: 'Debt-Ridden', statAdj: { wis: -1 }, perks: { goldMul: 0.25 },
    blurb: 'You owe someone everything, and it has made you very good at finding coin.' },
  { id: 'low-war-veteran', name: 'Veteran of the Low War', statAdj: { str: 1, int: -1 }, perks: { skill: 'mending' },
    blurb: 'You carried friends off a field nobody names. You know what closes and what does not.' },
  { id: 'lamplighter', name: 'Lamplighter', statAdj: { wis: 1, str: -1 }, perks: { sight: 2 },
    blurb: 'Years of small flames against big darks. Your eyes go further than most.' },
  { id: 'merchants-runaway', name: 'Merchant’s Runaway', statAdj: { cha: 1, con: -1 }, perks: { skill: 'haggle' },
    blurb: 'You fled the counting-house, but the counting came with you.' },
];

export function backgroundById(id) {
  return BACKGROUNDS.find((b) => b.id === id) || null;
}

/* The non-combat skills, each wired to a system that already exists —
 * a rank that changes no number on any screen is a lie with a name. */
export const SKILLS = [
  { id: 'haggle', name: 'Haggle', max: 4,
    desc: 'The town’s prices bend: cheaper to buy, dearer to sell, per rank.' },
  { id: 'lore', name: 'Lore', max: 4,
    desc: 'A chance per rank to read an unidentified find the moment you take it.' },
  { id: 'fieldcraft', name: 'Fieldcraft', max: 4,
    desc: 'Hidden doors give themselves up sooner under your hands.' },
  { id: 'mending', name: 'Mending', max: 4,
    desc: 'Resting closes wounds nothing else reaches — the whole company’s, at the best mender’s rank.' },
];

export function skillById(id) {
  return SKILLS.find((s) => s.id === id) || null;
}

export const ABILITIES = [
  /* Fighter */
  { cls: 'fighter', level: 1, id: 'cleave', name: 'Cleave', kind: 'passive', description: 'Your blade carries: slaying a foe grants one bonus attack this turn.' },
  { cls: 'fighter', level: 3, id: 'shield-bash', name: 'Shield Bash', kind: 'damage', name2: 'Shield Bash', powerCost: 4, cooldown: 3, range: 1, damage: { sides: 6, bonus: 2, n: 'str' }, description: 'Knock a foe senseless: deal 1d6+STR and it cannot attack next turn.' },
  /* Half a bar, twice a fight. The fraction and the price moved together: with
   * the old 5 power it would have been four castings and two full bars. */
  { cls: 'fighter', level: 6, id: 'second-wind', name: 'Second Wind', kind: 'heal', selfOnly: true, powerCost: 8, cooldown: 0, heal: '3d6', healFraction: 0.5, description: 'Breathe deep and shake off the dark: heal 3d6. Your own breath — no one else’s.' },
  { cls: 'fighter', level: 9, id: 'whirlwind', name: 'Whirlwind', kind: 'damage', powerCost: 8, cooldown: 3, aura: 2, damage: { sides: 6, bonus: 3, dice: 2, n: 'str' }, description: 'A dance of death: deal 2d6+STR to every foe around you.' },

  /* Thief */
  { cls: 'thief', level: 1, id: 'sharp-keen', name: 'Sharp & Keen', kind: 'passive', critBonus: 0.10, findsSecrets: true, description: 'You strike where it tells: +10% to wound critically, and your hands find seams other people walk past.' },
  { cls: 'thief', level: 2, id: 'hide-shadows', name: 'Hide in Shadows', kind: 'buff', buff: 'shadow', powerCost: 3, cooldown: 5, turns: 6, description: 'Step out of the world’s attention: nothing hunts what it cannot see. Your first blow from the dark strikes true (+4) and cuts twice as deep — and ends the hiding.' },
  { cls: 'thief', level: 3, id: 'backstab', name: 'Backstab', kind: 'damage', powerCost: 4, cooldown: 3, range: 1, damage: { sides: 6, bonus: 4, dice: 1 }, description: 'Find the unguarded flank: deal 1d6+4 to a foe and vanish one tile.' },
  { cls: 'thief', level: 6, id: 'shadow-blink', name: 'Shadow Blink', kind: 'teleport', powerCost: 5, cooldown: 4, teleportRng: 6, description: 'Fold into the dark and reappear up to 6 tiles away. Monsters lose your trail.' },
  { cls: 'thief', level: 9, id: 'fatal-flurry', name: 'Fatal Flurry', kind: 'damage', powerCost: 8, cooldown: 3, aura: 2, damage: { sides: 4, bonus: 2, dice: 4 }, description: 'Strike every foe in sight like falling knives: 4d4+2 each.' },

  /* Mage */
  /* The reserve is a tide, not a cup. This is the half of the answer that
   * makes a Mage's own turns pay for themselves: while a fight is on, power
   * seeps back, and a blow landed with a staff — a weapon that carries power,
   * which a sword does not — draws deeper. So the turn you spend in reach is
   * how you buy the next Firebolt, and the mundane swing stops being the thing
   * you do INSTEAD of being a Mage. */
  { cls: 'mage', level: 1, id: 'ebb-flow', name: 'Ebb & Flow', kind: 'passive', powerRegen: 0.02, focusPower: 2, description: 'Your reserve is a tide, not a cup: while a fight is on it seeps back a little every turn, and a blow landed with a staff or other focus draws deeper.' },

  /* The other half: something to CAST when the reserve is low, so the answer
   * to a dry turn is a small spell rather than a stick. It hands nothing back —
   * Ebb & Flow above is the whole of the economy, and measured, a spark that
   * paid as well put the Mage above every other class at the first boss. Flat
   * dice on purpose: a floor to stand on, not a career. */
  { cls: 'mage', level: 1, id: 'witch-spark', name: 'Witch-Spark', kind: 'damage', powerCost: 0, cooldown: 0, range: 6, damage: { sides: 4, bonus: 0, dice: 1 }, description: 'The small working, always to hand: 1d4 at six paces, and it costs nothing at all.' },
  { cls: 'mage', level: 1, id: 'firebolt', name: 'Firebolt', kind: 'damage', powerCost: 3, cooldown: 0, range: 7, damage: { sides: 8, bonus: 0, dice: 1, int: true }, description: 'Lance of flame: 1d8+INT to the nearest foe in sight (range 7).' },
  /* Frailty was the Mage's whole late game: the pool was not the only thing
   * that ran out, the Mage did. A skin to stand behind for a few turns is the
   * oldest answer in the book and it is a decision rather than a passive. */
  { cls: 'mage', level: 3, id: 'ashen-mantle', name: 'Ashen Mantle', kind: 'buff', buff: 'ward', powerCost: 4, cooldown: 8, turns: 6, bonus: 2, description: 'Draw the cold air in close: turns aside 2 damage from every blow for 6 turns, and more as you learn.' },
  { cls: 'mage', level: 3, id: 'reveal', name: 'Light & Reveal', kind: 'reveal', powerCost: 2, cooldown: 0, description: 'Reveal all secret doors and traps on this floor until you leave it.' },
  { cls: 'mage', level: 6, id: 'blink', name: 'Blink', kind: 'teleport', powerCost: 4, cooldown: 4, teleportRng: 6, description: 'Rend the veil: teleport to a random spot up to 6 tiles away.' },
  { cls: 'mage', level: 9, id: 'fireball', name: 'Fireball', kind: 'damage', powerCost: 9, cooldown: 3, aura: 3, range: 5, damage: { sides: 6, bonus: 0, dice: 3, int: true }, description: 'Ball of doom: 3d6+INT to the target and everything within a 3-tile blast.' },

  /* Cleric */
  /* A third, not a quarter: at a quarter this was the same integer as a 15gp
   * bottle at every level for every Cleric, which is no kind of signature. */
  { cls: 'cleric', level: 1, id: 'lay-hands', name: 'Lay on Hands', kind: 'heal', powerCost: 5, cooldown: 0, heal: '2d6', healFraction: 1 / 3, description: 'Old gods answer: heal 2d6.' },
  { cls: 'cleric', level: 3, id: 'detect-evil', name: 'Detect Evil', kind: 'reveal', powerCost: 2, cooldown: 0, detectMonsters: true, description: 'Foes burn on your sight: show every monster on the floor until next turn.' },
  { cls: 'cleric', level: 6, id: 'turn-undead', name: 'Turn Undead', kind: 'turn', powerCost: 6, cooldown: 3, range: 6, damage: { sides: 6, bonus: 0, dice: 2 }, description: 'Drive the unhallowed back: undead & cursed creatures take 2d6 and flee.' },
  { cls: 'cleric', level: 9, id: 'judgment', name: 'Judgment', kind: 'damage', powerCost: 8, cooldown: 3, range: 5, damage: { sides: 6, bonus: 0, dice: 3 }, description: 'Sythe of the temple: 3d6 to every foe in a 5-tile blast.' },
];

export function abilitiesFor(clsId, level) {
  return ABILITIES.filter((a) => a.cls === clsId && level >= a.level);
}

export function getAbility(id) {
  return ABILITIES.find((a) => a.id === id) || null;
}

/* ---------------- Derived stat helpers ---------------- */

export function abilityMod(v) { return Math.floor((v - 10) / 2); }

/* XP needed to earn the NEXT level. gainXP SUBTRACTS as it goes, so reaching
 * level N costs the sum of every step below it — which is what made the old
 * coefficient of 150 so much steeper than it looked. Measured against what the
 * generator actually puts on the floors: clearing the whole of Temple floor one
 * paid 106 against the 150 that level two cost, so a player finished the first
 * floor of the game still at level one and barely past halfway.
 *
 * The coefficient is fitted to what the floors hold, and refitted whenever
 * they change — it moved from 150 to 70 when the floors were thin, and back to
 * 100 when the later dungeons were restocked to follow on from the earlier
 * ones instead of restarting. What it has to hit: level two arrives partway
 * through floor one, and each boss is met at the level it was measured
 * against — the Demon at five, the Umber Hulk at nine or ten, the Great Wyrm
 * at twelve or thirteen. */
export const XP_FOR_LEVEL = (lvl) => Math.floor(100 * (lvl * (lvl + 1) / 2));

/* ---------------- Healing ---------------- */

/* A burst heal mends at least a share of what you have.
 *
 * Flat dice do not scale and everything around them does. 2d4+2 was generous
 * on floor one and a rounding error on floor twelve — which is how a Potion of
 * Healing came to be a net LOSS beside the Demon of Lapsai: it gave back 7
 * while the turn it cost gave away 14, leaving the player worse off in 97 runs
 * out of 100. The potion was never broken. The turn was.
 *
 * The roll still stands whenever it is the larger number, so nothing heals for
 * less than it used to and level 1 plays exactly as it did — the floor only
 * starts to bite around level 4, which is where the dice start falling behind.
 * The altar has always worked this way (Game.useAltar mends 35% of max), as
 * has out-of-combat regeneration; this is the same idea reaching the things
 * you carry.
 *
 * Regeneration, rest and the altar are deliberately untouched. */
/* RECOVERY.
 *
 * Sitting down mends what sitting down can reach. A share of every blow leaves
 * a WOUND — a dead zone at the top of the bar that the calm-turn trickle, the
 * R key and a Ring of Regeneration all refuse to touch. A draught reaches past
 * it and closes a little of it; an altar closes all of it.
 *
 * This is here because the altar had become pointless, and measuring it showed
 * the cause was not that healing was fast. Out-of-combat regeneration is
 * oversubscribed by three to twelve times — the engine offers far more free
 * mending than a player has room to absorb — and the walk to a floor's one
 * altar is 31 turns, which at a hit point a turn is worth more than the altar
 * gives. Turning the supply down cannot fix a supply nobody can use up. A
 * CEILING is the one thing a walk cannot raise.
 */
export const RECOVERY = {
  woundShare: 0.15,   /* of every point taken, this much cannot be rested off */
  woundFloor: 0.4,    /* and the ceiling never falls below this much of maximum */
  healMends: 0.25,    /* a draught closes this share of what it mends */
};

export const HEAL_FLOORS = {
  draught: 0.25,         /* anything you drink, unless it is named below */
  greatDraught: 0.5,     /* the Potion of Superior Healing */
  wandCharge: 0.2,       /* eight charges to a wand, so each is worth less than a draught */
  writtenPower: 0.25,    /* a healing power the Library invented, floored conservatively */
};

/* The strong draught is named rather than deduced from its tier, because the
 * two tier scales in this game do not agree: the hand-authored items run 0-5
 * (potion-heal 1, Superior 3, plate 5) while the prompt tells the oracle
 * "tier is 0-15, 3 = normal floor 1". A generated floor-one healing draught is
 * therefore tier 3 — the same number the shipped Superior carries — and a
 * tier test would hand every invented potion the strong fraction. An invented
 * potion can still be strong: it keeps whatever heal it was written with, and
 * the floor only ever raises a number, never lowers one. */
const GREAT_DRAUGHTS = new Set(['potion-major-heal']);

export function healFractionForItem(it) {
  if (!it) return 0;
  if (it.kind === 'wand') return HEAL_FLOORS.wandCharge;
  return GREAT_DRAUGHTS.has(it.id) ? HEAL_FLOORS.greatDraught : HEAL_FLOORS.draught;
}

/* A power's share is written on the power, because a class ability is tuned,
 * not classified. Anything without one is something the Library wrote. */
export function healFractionForAbility(a) {
  if (!a) return 0;
  if (Number.isFinite(a.healFraction)) return a.healFraction;
  /* A power that is not rationed is already unlimited, and a floor tied to your
   * maximum health would make it unlosable. The Library can write one —
   * validateAbility defaults both powerCost and cooldown to zero — so an
   * unrationed heal keeps its flat dice and stays a minor thing.
   *
   * The brakes have to be real ones. A cooldown of 1 is not: activateAbility
   * sets the counter and then ends the turn, and tickStatus decrements it on
   * that same turn, so it is back to zero before you next press the key. And a
   * power costing 1 out of a pool of twenty is twenty castings, which inside a
   * single fight is no ration at all. */
  if (!(a.powerCost >= 3) && !(a.cooldown >= 2)) return 0;
  return HEAL_FLOORS.writtenPower;
}

/* The player is told the floor. An item that quietly does more than it says is
 * the same failure as one that says nothing at all. The whole phrase lives
 * here rather than a bare word, so "half your health" does not come out as
 * "half of your health". */
const HEALTH_SHARES = [
  [0.2, 'a fifth of your health'],
  [0.25, 'a quarter of your health'],
  [1 / 3, 'a third of your health'],
  [0.5, 'half your health'],
  [0.75, 'three quarters of your health'],
];

export function healthShare(f) {
  const hit = HEALTH_SHARES.find(([v]) => Math.abs(v - f) < 0.005);
  return hit ? hit[1] : Math.round(f * 100) + '% of your health';
}

/* ---------------- Monsters ---------------- */

/* No colour column. A monster is painted from its tier by monsterTint, so the
 * whole bestiary reads as a heat ramp and nothing on the map can be red unless
 * it is alive. */
const M = (id, name, glyph, tier, hpMax, ac, toHit, dmg, xp, goldMin, goldMax, props = [], flavor = '', speed = 1, aggroRange = 8) => ({
  id, name, glyph, tier, hpMax, ac, toHit, damage: parseDmg(dmg), xp, goldMin, goldMax, speed, aggroRange, props: props.slice(), flavor,
});

function parseDmg(s) {
  const m = String(s).match(/(\d+)d(\d+)([+-]?\d+)?/);
  return { dice: m ? +m[1] : 1, sides: m ? +m[2] : 4, bonus: m && m[3] ? +m[3] : 0 };
}

export const MONSTERS = [
  M('rat', 'Sewer Rat', 'r', 0, 3, 10, 0, '1d2', 5, 1, 4, [], 'A bristling grey thing with eyes like wet beads.'),
  M('giant-rat', 'Giant Rat', 'R', 1, 6, 10, 0, '1d3', 12, 2, 8, [], 'A rat the size of a hound, all teeth and whiskers.'),
  M('giant-spider', 'Giant Spider', 'S', 1, 6, 12, 1, '1d4', 15, 3, 9, ['poison'], 'Web-slick legs and a bite that burns at the veins.', 2),
  M('goblin', 'Goblin', 'g', 2, 8, 11, 1, '1d6', 25, 5, 15, ['intelligent'], 'A knuckle-dragging knave with a stolen blade.'),
  M('kobold', 'Kobold', 'k', 2, 5, 11, 0, '1d4', 20, 4, 12, ['intelligent'], 'A yelping whelp of the dark, jabbing at your shins.'),
  M('giant-ant', 'Giant Ant', 'A', 2, 10, 12, 1, '1d4', 18, 2, 6, ['pack'], 'Carries off the remains of things bigger than you.'),
  M('centipede', 'Giant Centipede', 'c', 2, 7, 13, 1, '1d3', 16, 2, 8, ['poison'], 'A horrid bracelet of legs that spits venom.', 2),
  M('skeleton', 'Skeleton', 's', 3, 10, 10, 2, '1d6', 40, 5, 12, ['undead'], 'Old bones that remember marching orders.'),
  M('orc', 'Orc', 'o', 3, 13, 9, 2, '1d8', 45, 8, 20, ['intelligent'], 'A green brute with a notched cleaver and a grudge.'),
  M('hobgoblin', 'Hobgoblin', 'H', 4, 16, 8, 2, '1d8', 55, 10, 25, ['intelligent'], 'Bigger, uglier, and nastier than its little kin.'),
  M('ghoul', 'Ghoul', 'G', 4, 14, 9, 2, '1d6', 60, 6, 18, ['undead', 'pack'], 'Ravenous yeti-pale grave-things that eat warm flesh.'),
  M('giant-snake', 'Giant Snake', 'S', 4, 18, 8, 2, '1d6', 65, 8, 20, ['poison', 'aquatic'], 'A coil of muscle and bad intention.', 2),
  M('zombie', 'Zombie', 'z', 4, 20, 9, 1, '1d8', 55, 5, 15, ['undead'], 'A slow shambling ruin of a person, still hungry.'),
  /* The Temple's own elite, at the tier the band can actually reach on its
   * last floor. At six they were content no player ever met. */
  M('ghast', 'Ghast', 'Q', 5, 24, 7, 3, '1d8', 90, 10, 24, ['undead', 'poison', 'pack'], 'A ghoul grown old and powerful, stinking of the grave.'),
  M('wererat', 'Wererat', 'W', 5, 22, 7, 3, '1d6', 85, 15, 35, ['intelligent'], 'Man-shaped, whiskered, and half-bald with age and greed.', 2),
  M('giant-leech', 'Giant Leech', 'L', 5, 18, 8, 2, '1d6', 80, 8, 20, ['aquatic'], 'Drains you drink by drink; do not let it hold you.'),
  M('living-statue', 'Living Statue', 'h', 5, 32, 4, 3, '2d6', 130, 15, 40, [], 'The temple guards that never stood guard — until now.'),
  M('gargoyle', 'Gargoyle', 'v', 5, 30, 4, 3, '1d8', 125, 15, 35, [], 'A stone demon fixed to chew on intruders.'),
  M('mummy', 'Mummy', 'M', 5, 28, 5, 3, '1d8', 135, 20, 45, ['undead', 'cursed'], 'Linen and rage. Its touch leaves a failing of the flesh.'),
  M('wraith', 'Wraith', 'w', 7, 32, 4, 4, '1d8', 160, 20, 45, ['undead'], 'A cold wind that remembers being a person.'),
  M('spectre', 'Spectre', 'P', 7, 34, 4, 4, '2d6', 180, 24, 50, ['undead'], 'Ectoplasm with a grudge against the living.'),
  M('ogre', 'Ogre', 'O', 7, 42, 7, 4, '2d6', 175, 30, 60, [], 'A mountain of bad decisions with a club to match.'),
  M('displacer-beast', 'Displacer Beast', 'D', 8, 46, 4, 5, '2d6', 210, 30, 65, [], 'Seems to stand two feet from where it truly is.', 3),
  M('gelatinous-cube', 'Gelatinous Cube', 'C', 8, 50, 8, 3, '2d4', 200, 40, 80, ['trap'], 'A clear slab of jelly that dissolves anything it swallows.'),
  M('minotaur', 'Minotaur', 'B', 8, 55, 5, 6, '3d6', 240, 50, 100, ['intelligent'], 'Half bull, wholly furious. The maze is its hoarse memory.'),
  M('otyugh', 'Otyugh', 'Y', 8, 46, 5, 5, '2d6', 230, 40, 90, ['aquatic'], 'A three-legged garbage god that minds the temple drains.'),
  M('troll', 'Troll', 'T', 9, 66, 6, 6, '2d6', 300, 60, 120, ['regenerate'], 'Flesh knits as you watch. Burn it; burn it twice.'),
  M('basilisk', 'Basilisk', 'b', 9, 60, 4, 5, '2d8', 320, 70, 140, ['poison'], 'The gaze is a sentence. Do not look beneath the hood.'),
  M('wyvern', 'Wyvern', 'V', 9, 70, 4, 6, '2d6', 340, 80, 150, ['flying'], 'A dragon that flunked the final grade, and holds a grudge.', 3),
  M('fire-elemental', 'Fire Elemental', 'E', 9, 60, 3, 6, '2d8', 340, 50, 100, [], 'Heat given appetite. It feeds on what you burn.'),
  M('ettin', 'Ettin', 'E', 10, 88, 4, 7, '3d6', 420, 90, 170, ['intelligent'], 'Two heads, four fists, one shared hatred of doors.'),
  M('stone-giant', 'Stone Giant', 'N', 10, 92, 4, 7, '3d6', 450, 100, 190, [], 'Ancient mountain-bones wrapped in patience.'),
  M('gorgon', 'Gorgon', 'n', 11, 98, 3, 7, '3d8', 520, 120, 220, ['ranged'], 'An iron bull whose breath turns flesh to marble.'),
  { ...M('umber-hulk', 'Umber Hulk', 'U', 9, 79, 4, 8, '3d6', 540, 130, 240, [], 'A burrowing gut of a beast guided by antennae.'),
    attacks: [
      { name: 'claw', damage: { dice: 1, sides: 6, bonus: 0 } },
      { name: 'claw', damage: { dice: 1, sides: 6, bonus: 0 } },
      { name: 'mandibles', damage: { dice: 1, sides: 8, bonus: 0 } },
    ] },
  M('dracolisk', 'Dracolisk', 'D', 11, 100, 3, 8, '3d8', 580, 140, 260, ['poison'], 'Dragon by blood, basilisk by nature. The worst of both.', 2),
  { ...M('great-wyrm', 'Great Wyrm', 'd', 12, 138, 3, 9, '3d6', 800, 200, 400, ['flying', 'ranged'], 'The old serpent of the deep sanctum, crowned with rusted gold.', 2),
    attacks: [
      { name: 'claw', damage: { dice: 1, sides: 6, bonus: 0 } },
      { name: 'claw', damage: { dice: 1, sides: 6, bonus: 0 } },
      { name: 'bite', damage: { dice: 1, sides: 10, bonus: 0 } },
    ] },
  { ...M('lapsai-demon', 'Demon of Lapsai', '&', 7, 57, 4, 8, '2d6', 1200, 300, 600, ['cursed', 'undead'], 'The hungering god of the temple, woken to feed. Tier says where it is met, not how the stories rate it: this is the first sanctum you go down, and its god is sized for whoever gets there.', 2),
    attacks: [
      { name: 'claw', damage: { dice: 1, sides: 4, bonus: 0 } },
      { name: 'claw', damage: { dice: 1, sides: 4, bonus: 0 } },
      { name: 'bite', damage: { dice: 1, sides: 6, bonus: 0 } },
    ] },
];

export function getMonster(id) {
  return MONSTERS.find((m) => m.id === id) || null;
}

export function monstersForFloor(floorIdx, threat) {
  const pool = MONSTERS.map((m) => ({ m, tier: m.tier + threat + Math.floor(floorIdx * 1.35) }))
    .filter((x) => x.tier >= 0 && x.tier <= 16)
    .sort((a, b) => a.tier - b.tier);
  const minT = Math.max(0, floorIdx + threat - 1);
  const candidates = pool.filter((x) => x.tier >= minT && x.tier <= minT + 4);
  const use = candidates.length ? candidates : pool.slice(0, 4);
  return use;
}

/* ---------------- Items ---------------- */

function makeItem(id, name, kind, glyph, color, value, tier, effects, flavor = '') {
  const slot = { weapon: 'weapon', armor: 'body', shield: 'shield', ring: 'ring', amulet: 'amulet', potion: 'consumable', scroll: 'consumable', wand: 'weapon', special: 'special', misc: 'misc' }[kind];
  return { id, name, kind, slot, glyph, color, value, tier, effects: effects || {}, cursed: false, identified: true, flavor, uid: null };
}

export const baseWeapons = [
  makeItem('dagger', 'Dagger', 'weapon', 'd', 'white', 5, 1, { toHit: 0, damage: { dice: 1, sides: 4, bonus: 0 } }, 'Small mercy of sharpened steel.'),
  makeItem('short-sword', 'Short Sword', 'weapon', 's', 'silver', 8, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }),
  makeItem('mace', 'Mace', 'weapon', 'm', 'gray', 9, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }, 'For sermon and skull alike.'),
  makeItem('staff', 'Staff', 'weapon', '/', 'brown', 6, 1, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 }, power: 2 }, 'Walking stick of a wandering scholar. Humble but humming.'),
  makeItem('broadsword', 'Broadsword', 'weapon', 'b', 'silver', 15, 2, { toHit: 0, damage: { dice: 1, sides: 8, bonus: 0 } }, 'Standard-issue courage.'),
  makeItem('hand-axe', 'Hand Axe', 'weapon', 'a', 'gray', 12, 2, { toHit: 0, damage: { dice: 1, sides: 6, bonus: 0 } }),
  makeItem('war-hammer', 'War Hammer', 'weapon', 'W', 'silver', 20, 3, { toHit: 0, damage: { dice: 1, sides: 8, bonus: 1 } }),
  makeItem('battle-axe', 'Battle Axe', 'weapon', 'A', 'gray', 26, 4, { toHit: 0, damage: { dice: 1, sides: 10, bonus: 0 } }),
  /* Both hands are both hands: the flag means no shield alongside it. */
  { ...makeItem('two-handed-sword', 'Two-Handed Sword', 'weapon', 'T', 'brightblue', 40, 5, { toHit: 0, damage: { dice: 2, sides: 6, bonus: 0 } }), twoHanded: true },
  makeItem('wand-of-fire', 'Wand of Fire', 'wand', '~', 'yellow', 60, 3, { spell: 'firebolt', charges: 12 }, 'Flickering like a live coal.'),
  makeItem('wand-of-healing', 'Wand of Healing', 'wand', '~', 'brightgreen', 70, 3, { spell: 'heal', heal: '1d6+3', charges: 8 }, 'Warm as a hearth.'),
  makeItem('wand-of-frost', 'Wand of Frost', 'wand', '~', 'cyan', 80, 4, { spell: 'frost', charges: 10 }, 'Hoar-frost crawls along the haft.'),
];

export const baseArmor = [
  makeItem('padded-armor', 'Padded Armor', 'armor', '[', 'amber', 6, 1, { acBonus: 1 }),
  makeItem('leather-armor', 'Leather Armor', 'armor', '[', 'brown', 10, 1, { acBonus: 2 }),
  makeItem('studded-armor', 'Studded Leather', 'armor', '[', 'brown', 14, 2, { acBonus: 3 }),
  makeItem('chainmail', 'Chainmail', 'armor', '[', 'silver', 25, 3, { acBonus: 4 }),
  makeItem('scale-armor', 'Scale Armor', 'armor', '[', 'green', 32, 4, { acBonus: 5 }),
  makeItem('plate', 'Plate Armor', 'armor', '[', 'brightblue', 50, 5, { acBonus: 6 }),
  makeItem('small-shield', 'Small Shield', 'shield', ')', 'brown', 8, 1, { acBonus: 1 }),
  makeItem('large-shield', 'Large Shield', 'shield', ')', 'silver', 18, 2, { acBonus: 2 }),
  makeItem('tower-shield', 'Tower Shield', 'shield', ')', 'gray', 35, 4, { acBonus: 3, toHit: -1 }),
];

export const baseJewelry = [
  makeItem('ring-protection', 'Ring of Protection', 'ring', '=', 'gold', 60, 2, { acBonus: 1 }, 'A plain band that makes blades go wide.'),
  makeItem('ring-strength', 'Ring of Might', 'ring', '=', 'gold', 70, 2, { statBonus: { str: 1 } }, 'Muscles you never earned.'),
  makeItem('ring-regeneration', 'Ring of Regeneration', 'ring', '=', 'teal', 120, 4, { regen: 1 }, 'Flesh mends by finger-widths.'),
  makeItem('ring-arcana', 'Ring of the Archive', 'ring', '=', 'violet', 110, 4, { power: 3 }, 'Motes of stolen magic drift off it.'),
  makeItem('amulet-ward', 'Amulet of the Deep Ward', 'amulet', '&', 'blue', 90, 3, { resist: 1, undeadResist: 1 }, 'Old sigils against the things below.'),
  makeItem('amulet-seeing', 'Amulet of True Seeing', 'amulet', '&', 'gold', 130, 4, { seeSecrets: true }, 'Powdered dragon-eyes in amber. You distrust every wall.'),
  makeItem('amulet-luck', 'Lucky Coin of Lapsai', 'amulet', '$', 'gold', 150, 5, { luck: 2 }, 'Warm and heavy with someone else’s fortune.'),
];

export const basePotions = [
  makeItem('potion-heal', 'Potion of Healing', 'potion', '!', 'pink', 15, 1, { heal: '2d4+2' }, 'Bitter and vine-tart. Kills the hurting.'),
  makeItem('potion-major-heal', 'Potion of Superior Healing', 'potion', '!', 'magenta', 45, 3, { heal: '4d6+4' }, 'Thick as syrup; you can feel the mending.'),
  makeItem('potion-power', 'Potion of Arcana', 'potion', '!', 'violet', 35, 2, { power: '4d4+4' }, 'Tastes of the crackling between worlds.'),
  makeItem('potion-strength', 'Potion of Titan’s Grip', 'potion', '!', 'yellow', 40, 3, { buffStr: 10 }, 'Spoils of a giant’s cellar. Bulges every vein.'),
  makeItem('potion-remove-curse', 'Draught of Unbinding', 'potion', '!', 'cyan', 80, 4, { removeCurse: true }, 'Cold as a mountain spring; slips curses like wax.'),
];

export const baseScrolls = [
  makeItem('scroll-identify', 'Scroll of Identify', 'scroll', '?', 'gold', 30, 1, { identify: true }),
  makeItem('scroll-remove-curse', 'Scroll of Remove Curse', 'scroll', '?', 'cyan', 70, 3, { removeCurse: true }),
  /* Renamed from 'Scroll of Recall': it blinks you across the floor, and the
   * name belongs to the scroll that actually takes you home. */
  makeItem('scroll-teleport', 'Scroll of Blinking', 'scroll', '?', 'violet', 60, 3, { teleport: true }),
  makeItem('scroll-recall', 'Scroll of Recall', 'scroll', '?', 'white', 50, 2, { recall: true },
    'The way home, folded small. Read it below, and the Whetstone answers.'),
  makeItem('scroll-reveal', 'Scroll of Cartography', 'scroll', '?', 'brightgreen', 40, 2, { map: true }, 'Lines crawl to truth across the whole floor.'),
  makeItem('scroll-flame', 'Scroll of Flame Burst', 'scroll', '?', 'yellow', 50, 3, { flame: '3d6' }, 'Do not read aloud indoors.'),
  makeItem('scroll-sanctuary', 'Scroll of Sanctuary', 'scroll', '?', 'white', 55, 3, { sanctuary: 12 }, 'For a few quiet steps, the dark forgets you.'),
];

export const baseTreasure = [
  makeItem('gold-pile', 'Pile of Gold', 'special', 'o', 'gold', 10, 0, {}, 'Coins in a small heap.'),
  makeItem('gem', 'Gemstone', 'special', 'X', 'cyan', 40, 1, {}, 'A teardrop of mineral light.'),
  makeItem('statuette', 'Idol of Ubtao', 'special', 'I', 'amber', 80, 3, {}, 'A squat carved godling, worth more to the right eyes.'),
  makeItem('crown', 'Tarnished Crown', 'special', 'C', 'gold', 150, 4, {}, 'Someone wore this when the temple still had kings.'),
];

export const ALL_ITEMS = [...baseWeapons, ...baseArmor, ...baseJewelry, ...basePotions, ...baseScrolls, ...baseTreasure];

export function getItemTemplate(id) {
  return ALL_ITEMS.find((i) => i.id === id) || null;
}

/* Two items stack only if swapping one for the other would change nothing:
 * same template, same name, same worth, same effects, same curse, same state
 * of knowledge. A +2 Dagger, a cursed Dagger and a plain Dagger are three
 * stacks, because a pack that hid that distinction would be a trap — and a
 * half-spent wand never merges with a full one, since charges live in effects.
 *
 * The pack used to render one row per object, so eight Potions of Healing were
 * eight identical lines and the Gear tab scrolled for the wrong reason. */
export function itemStackKey(it) {
  if (!it) return '';
  return [
    it.id || it.name,
    it.name,
    it.kind,
    it.value,
    it.cursed ? 'c' : '',
    it.identified === false ? 'u' : 'i',
    stableJson(it.effects || {}),
  ].join('|');
}

/* Key order is insertion order, and applyMagic adds effects to a clone in a
 * different order than the template declares them — so a plain JSON.stringify
 * would rule two identical potions unstackable on a technicality. */
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

export function scaleDice(d, factor) {
  return { dice: Math.max(1, Math.round(d.dice * factor)), sides: Math.max(2, d.sides), bonus: d.bonus || 0 };
}

export function randomTreasureValue(rng, floorIdx, tier) {
  const base = 5 + rng.int(3, 10) * (floorIdx + 1) + tier * 4;
  return base;
}

/* ---------------- Dungeons ---------------- */

export const DUNGEONS = [
  {
    id: 'temple',
    name: 'The Temple of Lapsai',
    title: 'the old sanctum',
    flavor: 'Beneath a broken lintel the old temple yawns. Rank air breathes up from stairs worn smooth by a thousand years of offerings. Somewhere down there, in a bronze sanctuary, a thing that was once a god sleeps with its mouth open. You go down to meet it, because the march of destiny is poorly lit and somebody has to carry the torch.',
    floors: 4,
    theme: 'temple',
    threat: 0,
    monsterWeights: ['rat', 'giant-rat', 'giant-spider', 'goblin', 'kobold', 'orc', 'skeleton', 'ghoul', 'mummy', 'living-statue', 'gargoyle', 'otyugh', 'lapsai-demon'],
    bossId: 'lapsai-demon',
  },
  {
    id: 'upper',
    name: 'The Upper Reaches',
    title: 'the drowned warrens',
    flavor: 'Below the forge-quarter of the old city, the storm-drains knit themselves into a drowned warren. Green water and older smells. The rats here glow faintly, the better to be seen by whatever eats them. The tide comes in twice a day, and something rides it.',
    floors: 4,
    theme: 'sewers',
    threat: 2,
    /* Stocked for the depths it sits at, which are the fifth to the eighth
     * floor of the game and not the first to the fourth again. It used to open
     * with Giant Rats and Giant Spiders — the same tier-1 vermin as the Temple
     * — so the second dungeon began softer than the first one ended.
     * Drowned-warren things: leeches and wererats in the water, ghasts and a
     * wraith in the silt, an ogre and a troll in the big drains, a gelatinous
     * cube that IS the drain, and an otyugh minding it. */
    monsterWeights: ['giant-snake', 'wererat', 'giant-leech', 'ghast', 'wraith', 'ogre', 'gelatinous-cube', 'otyugh', 'troll', 'umber-hulk'],
    bossId: 'umber-hulk',
  },
  {
    id: 'serpent',
    name: 'Halls of the Serpent God',
    title: 'the coils of stone',
    flavor: 'The Serpent God was worshipped with fangs. Its halls wind like a swallowed spiral, and every chamber is a contraction. Worshippers learned to crawl. Their petrified remains still wear the geometry of reverence.',
    floors: 4,
    theme: 'cavern',
    threat: 4,
    /* Four floors need four bands to walk through, and a roster of 4, 8, 9, 9,
     * 9, 11, 11, 11 only has two — so its floors came out identical. Widened
     * with things that belong in a swallowed spiral of stone: the ghosts of
     * the worshippers who learned to crawl, a hunter that is never quite where
     * it looks, and the mountain-bones the halls were cut out of. */
    monsterWeights: ['giant-snake', 'spectre', 'displacer-beast', 'minotaur', 'basilisk', 'wyvern', 'troll', 'ettin', 'stone-giant', 'gorgon', 'dracolisk', 'umber-hulk', 'great-wyrm'],
    bossId: 'great-wyrm',
  },
];

export function getDungeon(id) {
  return DUNGEONS.find((d) => d.id === id) || null;
}

/* ---------------- Theme palettes (map rendering) ---------------- */

export const THEMES = {
  temple: { floor: '#23261c', floorEdge: '#3a3f2c', wall: '#7a6a45', wallHi: '#8f7c50', door: '#5a4a30', secret: '#443a26', accent: '#8a7432', vignette: '#9dc97a' },
  sewers: { floor: '#1c2620', floorEdge: '#2e3a30', wall: '#5a6350', wallHi: '#6d7860', door: '#46503e', secret: '#38403a', accent: '#58a8a0', vignette: '#7ad8d0' },
  cavern: { floor: '#232023', floorEdge: '#382d34', wall: '#7a5a63', wallHi: '#8c6a74', door: '#5e4550', secret: '#44323c', accent: '#a87848', vignette: '#e88ad0' },
  crystal: { floor: '#1a2230', floorEdge: '#27344a', wall: '#46708a', wallHi: '#5a8ca8', door: '#34505e', secret: '#2a4050', accent: '#8ac8f0', vignette: '#8ac8f0' },
  fire: { floor: '#2a1a14', floorEdge: '#40221a', wall: '#8a3a26', wallHi: '#a84a30', door: '#662c1e', secret: '#55241a', accent: '#e08a4a', vignette: '#ff6a5a' },
  ice: { floor: '#182230', floorEdge: '#223650', wall: '#5a86b8', wallHi: '#6f9cc8', door: '#466a92', secret: '#3a5878', accent: '#7ad8d0', vignette: '#8ac8f0' },
  tomb: { floor: '#1c1a18', floorEdge: '#2e2a24', wall: '#5a5448', wallHi: '#6d6557', door: '#463f34', secret: '#383228', accent: '#9dc97a', vignette: '#aef08a' },
  abyss: { floor: '#14141c', floorEdge: '#23232e', wall: '#3a3a5a', wallHi: '#4a4a70', door: '#2c2c46', secret: '#252538', accent: '#a08af0', vignette: '#a08af0' },
  halls: { floor: '#23201a', floorEdge: '#37321f', wall: '#6d6a3a', wallHi: '#7f7c46', door: '#52502c', secret: '#413f24', accent: '#e0c05a', vignette: '#e0c05a' },
  jungle: { floor: '#14241a', floorEdge: '#1f3726', wall: '#3f6d3a', wallHi: '#4f8046', door: '#31562e', secret: '#2a4628', accent: '#aef08a', vignette: '#aef08a' },
  arcane: { floor: '#181426', floorEdge: '#251c3a', wall: '#5a4a8a', wallHi: '#6d5ca6', door: '#443a68', secret: '#372e54', accent: '#d45ad8', vignette: '#d45ad8' },
  /* Daylight on the green: turf underfoot, timber walls, the one theme
   * that is not underground. */
  town: { floor: '#26331e', floorEdge: '#38492c', wall: '#6d5c3a', wallHi: '#8a744a', door: '#52432a', secret: '#443a26', accent: '#e0c05a', vignette: '#9dc97a' },
};

export function getTheme(name) {
  return THEMES[name] || THEMES.temple;
}
