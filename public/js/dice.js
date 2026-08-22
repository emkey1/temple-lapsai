/* Small dice / item helpers shared across modules. */

export function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

export function rollDice(d) {
  let s = 0;
  for (let i = 0; i < (d.dice || 1); i++) s += rollDie(d.sides || 6);
  return s + (d.bonus || 0);
}

/* evaluate strings like "3d6+2" or plain numbers */
export function evaluateDice(v) {
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v;
    return 0;
  }
  const m = String(v).match(/(\d+)d(\d+)([+-]?\d+)?/);
  if (!m) return 0;
  let s = 0;
  const dice = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  for (let i = 0; i < dice; i++) s += 1 + Math.floor(Math.random() * sides);
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

export function applyMagic(item, level) {
  item.magicLevel = level;
  item.color = 'brightblue';
  const e = item.effects || (item.effects = {});
  if (item.kind === 'weapon' && e.damage) {
    e.toHit = (e.toHit || 0) + level;
    e.damage = { ...e.damage, bonus: (e.damage.bonus || 0) + level };
    const suffixes = ['of the Whetstone', 'of Lapsai', 'Biting', 'Singing', 'of the Far Reach'];
    item.name = `+${level} ${item.name} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`.trim();
  } else if (item.kind === 'armor' || item.kind === 'shield') {
    e.acBonus = (e.acBonus || 0) + level;
    item.name = `+${level} ${item.name}`;
  } else {
    e.acBonus = (e.acBonus || 0) + level;
    item.name = `+${level} ${item.name}`;
  }
  item.value = Math.round(item.value * (1 + level));
  item.identified = false;
  item.flavor = item.flavor || 'Humming with unseen temper.';
  return item;
}

export function deepItem(template) {
  return { ...JSON.parse(JSON.stringify(template)), uid: rngIntId() };
}
