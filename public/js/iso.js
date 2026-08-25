/* THE PROJECTION: how a floor of square tiles becomes a scene.
 *
 * One diamond is 64x32 — the Flare fantasycore grid, since that is whose
 * floors are being drawn. World x runs toward the lower right of the
 * screen, world y toward the lower left, exactly as Flare's own art was
 * rendered; that is why the creature sheets' eight directions can be
 * indexed with world-space deltas and come out facing the right way.
 *
 * Pure arithmetic, no canvas: the renderer asks where a tile falls and the
 * mouse asks which tile a pixel means, and both answers come from here so
 * they can never disagree. Tested headless, round-trip and neighbourhood.
 */

export const ISO = {
  TW: 64,        /* diamond width */
  TH: 32,        /* diamond height */
  WALL_H: 44,    /* how tall a wall prism stands above its floor */
};

/* The centre of tile (x, y)'s ground diamond, in unscrolled scene pixels. */
export function isoToScreen(x, y) {
  return {
    sx: (x - y) * (ISO.TW / 2),
    sy: (x + y) * (ISO.TH / 2),
  };
}

/* The tile under a scene pixel, fractional; floor it to name the tile. The
 * +0.5s recentre the diamond, so the answer flips at its edges rather than
 * at its centre. */
export function screenToIso(sx, sy) {
  const fx = sx / (ISO.TW / 2), fy = sy / (ISO.TH / 2);
  return {
    x: Math.floor((fy + fx) / 2 + 0.5),
    y: Math.floor((fy - fx) / 2 + 0.5),
  };
}

/* The four corners of a tile's ground diamond, for outlines and fog. */
export function diamondPath(sx, sy) {
  const hw = ISO.TW / 2, hh = ISO.TH / 2;
  return [
    [sx, sy - hh], [sx + hw, sy], [sx, sy + hh], [sx - hw, sy],
  ];
}

/* Painter's order: rows of equal x+y share a screen row; smaller sums stand
 * further back. Within a row the order does not matter for ground pieces,
 * and barely matters for standing ones, so x breaks the tie stably. */
export function paintOrder(a, b) {
  return (a.x + a.y) - (b.x + b.y) || a.x - b.x;
}

/* Which tiles can touch a viewport that spans [left..right] x [top..bottom]
 * in scene pixels — with a margin, because floor pieces and wall prisms
 * hang over their diamonds. Returns a test, not a list, so the caller can
 * run its own loops. */
export function makeViewTest(left, top, right, bottom, margin = ISO.TW * 2) {
  return (x, y) => {
    const { sx, sy } = isoToScreen(x, y);
    return sx >= left - margin && sx <= right + margin &&
           sy >= top - margin && sy <= bottom + margin;
  };
}
