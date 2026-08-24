/* Small dice / item helpers shared across modules. */

export function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

export function rollDice(d) {
  let s = 0;
  for (let i = 0; i < (d.dice || 1); i++) s += rollDie(d.sides || 6);
  return s + (d.bonus || 0);
}

/* Evaluate strings like "3d6+2", or plain numbers.
 *
 * Takes the roller as an argument. Everything else a turn rolls comes out of
 * the turn's own seeded stream (Game.rngOfTurn), and this did not — so the
 * five things that go through it, every healing potion and power draught and
 * scroll of flame and class heal and wand among them, were the only rolls in
 * the game that a seed could not reproduce. */
export function evaluateDice(v, rng) {
  const die = (sides) => (rng ? rng.d(sides) : 1 + Math.floor(Math.random() * sides));
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v;
    return 0;
  }
  const m = String(v).match(/(\d+)d(\d+)([+-]?\d+)?/);
  if (!m) return 0;
  let s = 0;
  const dice = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  for (let i = 0; i < dice; i++) s += die(sides);
  if (m[3]) s += parseInt(m[3], 10);
  return s;
}

export function rngIntId() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* Manhattan: how far, in steps, ignoring diagonals. Used for ranges. */
export function dist1(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/* Chebyshev: how far in KING moves. This is the one that means "adjacent" now
 * that everything can move diagonally — a foe on the diagonal is one step away,
 * but its Manhattan distance is two. */
export function dist8(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/* Enchantment, hidden until read.
 *
 * The true name goes into `trueName` and `item.name` stays the plain one, so
 * an unread find is "Broadsword", not "+2 Broadsword" — the name is a claim,
 * and a claim you have not verified is exactly what a curse hides behind.
 * Identification (revealItem in the engine) swaps the true name in. */
export function applyMagic(item, level) {
  item.magicLevel = level;
  item.color = 'brightblue';
  const e = item.effects || (item.effects = {});
  let trueName;
  if (item.kind === 'weapon' && e.damage) {
    e.toHit = (e.toHit || 0) + level;
    e.damage = { ...e.damage, bonus: (e.damage.bonus || 0) + level };
    const suffixes = ['of the Whetstone', 'of Lapsai', 'Biting', 'Singing', 'of the Far Reach'];
    trueName = `+${level} ${item.name} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`.trim();
  } else {
    e.acBonus = (e.acBonus || 0) + level;
    trueName = `+${level} ${item.name}`;
  }
  item.trueName = trueName;
  item.value = Math.round(item.value * (1 + level));
  item.identified = false;
  item.flavor = item.flavor || 'Humming with unseen temper.';
  return item;
}

/* A curse is an enchantment lying about its sign. It wears the same blue gleam
 * and the same unread rune as a blessing, and its bonuses run the other way —
 * you find out by wearing it, by trying to take it off, or by reading it
 * first. That last option is what the Scroll of Identify is FOR. */
export function applyCurse(item, level) {
  item.magicLevel = level;
  item.color = 'brightblue';
  const e = item.effects || (item.effects = {});
  /* Clamped past zero: a -2 curse on Studded Leather (+3 base) would still be
   * a net gain, and a trap that pays out is a discount. Whatever it started
   * as, a cursed thing is worse than wearing nothing at all. */
  if (item.kind === 'weapon' && e.damage) {
    e.toHit = Math.min((e.toHit || 0) - level, -1);
    e.damage = { ...e.damage, bonus: (e.damage.bonus || 0) - level };
  } else {
    e.acBonus = Math.min((e.acBonus || 0) - level, -1);
  }
  item.trueName = `-${level} ${item.name} (accursed)`;
  item.cursed = true;
  item.value = Math.max(1, Math.round(item.value * 0.5));
  item.identified = false;
  item.flavor = item.flavor || 'Humming with unseen temper.';
  return item;
}

export function deepItem(template) {
  return { ...JSON.parse(JSON.stringify(template)), uid: rngIntId() };
}
