/* THE CONTENT CONTRACT.
 *
 * One vocabulary, imported by both sides: the client renders against it and the
 * server validates the oracle's output against it — and builds the prompt's
 * enum lists from it, so what the model is offered and what the validator will
 * accept cannot drift apart.
 *
 * This file is the reason a generated monster's behaviour reaches the player.
 * Before it existed the server emitted `properties` and the engine read `props`,
 * the prompt offered a colour the validator rejected, and the schema advertised
 * lowercase glyphs that the validator uppercased.
 */

/* Palette. Names are the vocabulary; the hex values are what the canvas draws. */
export const COLORS = {
  green: '#9dc97a',
  amber: '#d8b04a',
  amber2: '#8a7432',
  white: '#e8e8d8',
  gray: '#9aaa88',
  silver: '#c8d0c8',
  /* The red family is reserved for monsters — see MONSTER_TINTS. Nothing the
   * player can pick up is painted in it, so red on the map always means
   * something that wants to kill you. */
  rust: '#8f5a48',
  blood: '#b8362e',
  red: '#e05a4e',
  brightred: '#ff6a5a',
  ember: '#ff8a3a',
  searing: '#ffbfa0',
  yellow: '#e8d85a',
  brightgreen: '#aef08a',
  cyan: '#7ad8d0',
  brightblue: '#8ac8f0',
  blue: '#5a82b8',
  magenta: '#d45ad8',
  pink: '#e88ad0',
  brown: '#a87848',
  darkgray: '#556055',
  violet: '#a08af0',
  gold: '#e0c05a',
  teal: '#58a8a0',
  black: '#000000',
};

/* Monsters are not painted by name — they are tinted by how dangerous they
 * are, coldest to hottest. Before this every glyph on the map was drawn from
 * one shared palette, so a gargoyle and a gemstone were the same grey and the
 * only way to tell loot from a thing with teeth was to walk into it.
 *
 * The ramp carries information a name could not: colour is threat. */
export const MONSTER_TINTS = ['rust', 'blood', 'red', 'brightred', 'ember', 'searing'];

/* The player is a white '@', so nothing that can kill you may be one too —
 * at the top of the ramp the tint is pale enough that the two would sit a
 * shade apart. The Demon wears '&' instead, which no colour in the loot
 * palette can now imitate. */
export const PLAYER_GLYPH = '@';

/* One colour per party slot, worn by the token on the map, the member strip
 * over the sheets, and the name in the top bar — so "which of us is that" is
 * answered the same way everywhere. Slot-keyed rather than stored on the
 * member: stable across saves with nothing to migrate, and distinct from the
 * red family (monsters) and from each other. */
export const PARTY_TINTS = ['#f0f0e0', '#8ac8f0', '#aef08a', '#e8d85a'];

export function partyTint(slot) {
  return PARTY_TINTS[slot % PARTY_TINTS.length];
}

/* Upper tier of each band, by index into MONSTER_TINTS. */
const TINT_CEILINGS = [1, 3, 5, 7, 10];

export function monsterTint(tier, boss = false) {
  const t = Number.isFinite(Number(tier)) ? Number(tier) : 0;
  let band = TINT_CEILINGS.findIndex((c) => t <= c);
  if (band < 0) band = MONSTER_TINTS.length - 1;
  if (boss) band = Math.min(MONSTER_TINTS.length - 1, band + 1);
  return MONSTER_TINTS[band];
}

const TINT_SET = new Set(MONSTER_TINTS);

/* Offered to the oracle for the things it may colour, which is everything
 * except monsters. `black` on black is unreadable, amber2 is an internal
 * shade, and the red family belongs to the bestiary — none are advertised,
 * though all still render. */
export const PALETTE = Object.keys(COLORS)
  .filter((c) => c !== 'black' && c !== 'amber2' && !TINT_SET.has(c));

export const ITEM_KINDS = ['weapon', 'armor', 'shield', 'ring', 'amulet', 'potion', 'wand', 'scroll', 'special', 'misc'];

/* Which equipment slot each kind occupies. 'consumable' and 'misc' are not
 * worn — see Game.useItem, which must terminate on them rather than bounce. */
export const SLOT_FOR_KIND = {
  weapon: 'weapon',
  armor: 'body',
  shield: 'shield',
  ring: 'ring',
  amulet: 'amulet',
  wand: 'weapon',
  scroll: 'consumable',
  potion: 'consumable',
  special: 'special',
  misc: 'misc',
};

export const WEARABLE_SLOTS = ['weapon', 'body', 'shield', 'ring', 'amulet'];

/* HOW FAR A WORKING REACHES, in one place because three parts of the game now
 * ask: the card that describes it, the overlay that draws it on the ground,
 * and — through the shapes below — the engine that resolves it. An indicator
 * that disagreed with the resolution would be worse than none, so the shapes
 * here are the ones abilityDamage actually branches on, and the metrics are
 * the ones it actually measures with.
 *
 *   sight   everything the light shows; no boundary but the field of view
 *   aura    a ball centred on the caster
 *   aim     a ball you may pick a target inside, with an optional blast that
 *           opens around the TARGET rather than around you
 *
 * The metric matters as much as the radius. Picking a target measures in KING
 * moves (dist8, a square); a blast and a turning measure in steps (dist1, a
 * diamond). Drawing one as the other would put the ring a tile and a half
 * wrong on the diagonals, which is exactly where a player checks it.
 *
 * Null means the working does not reach across ground at all — a passive, a
 * buff worn on yourself — and null is what suppresses the checkbox. */
export function abilityReach(a) {
  if (!a || a.kind === 'passive') return null;
  /* A working that reaches the COMPANY reaches ground, whatever its kind —
   * a ward thrown over everyone within two tiles has a boundary worth
   * drawing even though nothing about it is an attack. */
  if (a.party) return { shape: 'aura', metric: 'manhattan', radius: a.party };
  if (a.kind === 'damage') {
    if (a.sight) return { shape: 'sight' };
    if (a.aura && !a.range) return { shape: 'aura', metric: 'manhattan', radius: a.aura };
    /* No reach named and no aura is the engine's thousand-tile default: it
     * hits the nearest thing in the light, so the light IS the boundary. */
    if (!a.range) return { shape: 'sight' };
    return { shape: 'aim', metric: 'chebyshev', radius: a.range, blast: a.aura || 0 };
  }
  if (a.kind === 'turn') return { shape: 'aura', metric: 'manhattan', radius: a.range || 6 };
  /* Teleport rolls each axis on its own, which is a square and not a ball. */
  if (a.kind === 'teleport') return { shape: 'aura', metric: 'chebyshev', radius: a.teleportRng || 6 };
  /* A healing touch finds the worst hurt within arm's length. */
  if (a.kind === 'heal') return a.selfOnly ? null : { shape: 'aura', metric: 'chebyshev', radius: 1 };
  return null;
}

/* KIND BEFORE SLOT, and one copy of the rule for everyone who needs it.
 *
 * A wand's slot is `weapon`, because a staff can be wielded and an equipped
 * one lends its damage and its power to the arm holding it. That made every
 * wand in the game look wearable to anything that asked the slot first — and
 * the click handler did, while the button's label and the engine both asked
 * the kind. So the button said FIRE and equipped the thing instead, out of
 * the pack and beyond any way of firing it.
 *
 * What decides whether a thing is worn or used is WHAT IT IS. Where it would
 * sit only matters once that is settled. */
export function isWorn(it) {
  if (!it) return false;
  if (it.kind === 'potion' || it.kind === 'scroll' || it.kind === 'wand') return false;
  return WEARABLE_SLOTS.includes(it.slot);
}

export const EFFECT_SPELLS = ['firebolt', 'fireball', 'frost', 'reveal', 'light', 'heal', 'detectevil', 'purge', 'teleport', 'identify', 'removecurse'];

/* The canonical field name is `props`, because that is what the engine reads.
 * The validator accepts `properties` too, since that is what reads naturally in
 * a schema, and always emits `props`. */
export const MONSTER_PROPS = ['undead', 'poison', 'regenerate', 'ranged', 'flying', 'intelligent', 'cursed', 'pack', 'trap', 'aquatic'];

export const DUNGEON_THEMES = ['temple', 'cavern', 'sewers', 'crystal', 'fire', 'ice', 'jungle', 'tomb', 'halls', 'abyss', 'arcane'];

export const CLASS_IDS = ['fighter', 'thief', 'mage', 'cleric'];

export const ABILITY_KINDS = ['damage', 'heal', 'buff', 'reveal', 'teleport', 'turn', 'passive'];

/* Ranges the validator clamps to, named here so the prompt can quote them. */
export const LIMITS = {
  tier: [0, 15],
  dice: [1, 10],
  sides: [1, 100],
  /* Ten, because the playtest asked for a ten-level dungeon and got six
   * without being told. Depth scaling stays sane down there: a monster on
   * floor nine carries about three times its card, which is the same curve
   * the founding four floors already ride. */
  floors: [2, 10],
  threat: [-4, 12],
  abilityLevel: [1, 20],
};

/* Rendered into the prompt so the model is told exactly what will be accepted. */
export function enumList(values) {
  return values.join('|');
}

export function quotedEnum(values) {
  return values.map((v) => `"${v}"`).join('|');
}
