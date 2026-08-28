/* A PNG reader and writer in the amount of code it actually takes.
 *
 * This exists because the art pipeline has to cut frames out of Flare's
 * packed sheets and lay them down in a smaller one, and "no npm install
 * required" is a promise the README makes. Node ships zlib; a PNG is zlib
 * plus a header, a filter per scanline, and a CRC. So: no dependency.
 *
 * Reads the colour types Flare's art actually uses — greyscale, RGB, palette
 * and RGBA at eight bits, uninterlaced — and always writes RGBA, because the
 * only consumer is a sprite atlas and sprite atlases have holes in them.
 */

import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* Channels per pixel, indexed by PNG colour type. The holes are the codes
 * the format does not define. */
const CHANNELS = [1, null, 3, 1, 2, null, 4];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/* Undo the per-scanline filter, in place, one row at a time — each row is
 * predicted from the one already reconstructed above it, so this cannot be
 * done out of order or in parallel. */
function unfilter(raw, h, stride, bpp) {
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const cur = y * stride, up = cur - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[cur + i - bpp] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = y > 0 && i >= bpp ? out[up + i - bpp] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4) v = x + paeth(a, b, c);
      else throw new Error(`unknown PNG filter ${ft} on row ${y}`);
      out[cur + i] = v & 0xff;
    }
  }
  return out;
}

export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let i = 8, hdr = null, plte = null, trns = null;
  const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      hdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!hdr) throw new Error('PNG has no IHDR');
  if (hdr.interlace) throw new Error('interlaced PNG not supported');
  if (hdr.depth !== 8 && hdr.depth !== 16) throw new Error(`PNG bit depth ${hdr.depth} not supported`);
  const ch = CHANNELS[hdr.color];
  if (!ch) throw new Error(`PNG colour type ${hdr.color} not supported`);

  const bytes = hdr.depth / 8;
  const stride = hdr.w * ch * bytes;
  let px = unfilter(zlib.inflateSync(Buffer.concat(idat)), hdr.h, stride, ch * bytes);
  /* Sixteen bits a channel is more than a screen can show and more than an
   * atlas needs; the high byte IS the eight-bit value. Flattening here means
   * everything downstream only ever handles one sample size. */
  if (bytes === 2) {
    const flat = Buffer.alloc(hdr.w * hdr.h * ch);
    for (let i = 0; i < flat.length; i++) flat[i] = px[i * 2];
    px = flat;
  }

  /* Everything becomes RGBA, so the packer only ever handles one shape. */
  const out = Buffer.alloc(hdr.w * hdr.h * 4);
  for (let p = 0, n = hdr.w * hdr.h; p < n; p++) {
    const s = p * ch, d = p * 4;
    if (hdr.color === 6) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
    else if (hdr.color === 2) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255; }
    else if (hdr.color === 0) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255; }
    else if (hdr.color === 4) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1]; }
    else {
      const idx = px[s];
      out[d] = plte[idx * 3]; out[d + 1] = plte[idx * 3 + 1]; out[d + 2] = plte[idx * 3 + 2];
      out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { w: hdr.w, h: hdr.h, data: out };
}

/* Pick the filter that leaves the row with the smallest sum of absolute
 * signed bytes — the heuristic the PNG spec itself suggests, and the reason
 * a written sheet lands near what an optimiser would produce. */
function filterRow(cur, prev, stride, bpp, scratch) {
  let best = null, bestScore = Infinity;
  for (let ft = 0; ft <= 4; ft++) {
    const buf = scratch[ft];
    let score = 0;
    for (let i = 0; i < stride; i++) {
      const x = cur[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x - a;
      else if (ft === 2) v = x - b;
      else if (ft === 3) v = x - ((a + b) >> 1);
      else v = x - paeth(a, b, c);
      v &= 0xff;
      buf[i] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) { bestScore = score; best = ft; }
  }
  return best;
}

export function encodePNG({ w, h, data }) {
  const stride = w * 4, bpp = 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const scratch = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    const ft = filterRow(cur, prev, stride, bpp, scratch);
    raw[y * (stride + 1)] = ft;
    scratch[ft].copy(raw, y * (stride + 1) + 1);
  }
  const z = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))]);
}

/* Copy a rectangle between two RGBA buffers. Reads outside the source are
 * transparent rather than an error: Flare's own definitions occasionally
 * name a frame a pixel or two past the edge of the sheet. */
export function blit(src, sx, sy, w, h, dst, dx, dy) {
  for (let y = 0; y < h; y++) {
    const syy = sy + y, dyy = dy + y;
    if (syy < 0 || syy >= src.h || dyy < 0 || dyy >= dst.h) continue;
    for (let x = 0; x < w; x++) {
      const sxx = sx + x, dxx = dx + x;
      if (sxx < 0 || sxx >= src.w || dxx < 0 || dxx >= dst.w) continue;
      const s = (syy * src.w + sxx) * 4, d = (dyy * dst.w + dxx) * 4;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = src.data[s + 3];
    }
  }
}

/* Box-filter downscale of one rectangle out of a source image.
 *
 * Averaging over the source pixels that fall under each destination pixel is
 * the right filter for making something smaller — it is what discards detail
 * without aliasing it into moire. Colour is averaged weighted by alpha, which
 * is the difference between a sprite with clean edges and a sprite with a
 * dark halo: the fully transparent pixels around a drawn edge are usually
 * black, and letting them vote on colour drags the outline towards soot.
 */
export function resample(src, sx, sy, sw, sh, dw, dh) {
  const out = { w: dw, h: dh, data: Buffer.alloc(dw * dh * 4) };
  const kx = sw / dw, ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(sy + y * ky), y1 = Math.max(y0 + 1, Math.ceil(sy + (y + 1) * ky));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(sx + x * kx), x1 = Math.max(x0 + 1, Math.ceil(sx + (x + 1) * kx));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        if (yy < 0 || yy >= src.h) continue;
        for (let xx = x0; xx < x1; xx++) {
          if (xx < 0 || xx >= src.w) continue;
          const s = (yy * src.w + xx) * 4;
          const al = src.data[s + 3];
          r += src.data[s] * al; g += src.data[s + 1] * al; b += src.data[s + 2] * al;
          a += al; wsum += al; n++;
        }
      }
      const d = (y * dw + x) * 4;
      if (!n) continue;
      out.data[d + 3] = Math.round(a / n);
      if (wsum > 0) {
        out.data[d] = Math.round(r / wsum);
        out.data[d + 1] = Math.round(g / wsum);
        out.data[d + 2] = Math.round(b / wsum);
      }
    }
  }
  return out;
}
