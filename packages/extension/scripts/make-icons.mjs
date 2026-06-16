// Generates the Loupe extension icons: a gold magnifying glass on the dark brand
// background, drawn with a tiny hand-rolled PNG encoder so no image dependency is
// needed. Edges are anti-aliased by 4x supersampling. WXT auto-discovers
// public/icon/{size}.png.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // no filter
    for (let x = 0; x < size; x += 1) {
      const o = y * stride + 1 + x * 4;
      const p = (y * size + x) * 4;
      raw[o] = rgba[p];
      raw[o + 1] = rgba[p + 1];
      raw[o + 2] = rgba[p + 2];
      raw[o + 3] = rgba[p + 3];
    }
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const BG = [20, 23, 31];
const GOLD = [246, 207, 110];

// Signed distance to a rounded box centered at (cx,cy) with half-size (hx,hy).
function sdRoundBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Signed distance to the segment a->b.
function sdSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Color (straight RGBA, 0-255) at a normalized point in the unit square. The
// loupe: a rounded dark tile, a gold lens ring with a faint glass tint, and a
// gold handle running to the lower-right.
function sample(nx, ny) {
  const lcx = 0.42;
  const lcy = 0.42;
  const R = 0.26; // lens outer radius
  const T = 0.075; // ring thickness
  const hw = 0.055; // half handle width
  // handle from just outside the ring at 45 degrees to the lower-right corner
  const ax = lcx + (R - 0.005) * Math.SQRT1_2;
  const ay = lcy + (R - 0.005) * Math.SQRT1_2;

  let col = null;
  let a = 0;
  if (sdRoundBox(nx, ny, 0.5, 0.5, 0.5, 0.5, 0.22) < 0) {
    col = BG;
    a = 255;
  } else {
    return [0, 0, 0, 0];
  }

  const d = Math.hypot(nx - lcx, ny - lcy);
  if (d < R - T) col = blend(col, GOLD, 0.16); // glass tint
  if (d <= R && d >= R - T) col = GOLD; // ring
  if (sdSegment(nx, ny, ax, ay, 0.8, 0.8) <= hw) col = GOLD; // handle

  return [col[0], col[1], col[2], a];
}

function blend(base, top, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + top[0] * alpha),
    Math.round(base[1] * (1 - alpha) + top[1] * alpha),
    Math.round(base[2] * (1 - alpha) + top[2] * alpha),
  ];
}

function iconRgba(size) {
  const SS = 4; // supersampling factor for anti-aliasing
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          const [r, g, b, a] = sample(nx, ny);
          // premultiplied accumulation, so transparent edges stay clean
          sr += r * a;
          sg += g * a;
          sb += b * a;
          sa += a;
        }
      }
      const p = (y * size + x) * 4;
      const aAvg = sa / (SS * SS);
      rgba[p] = sa > 0 ? Math.round(sr / sa) : 0;
      rgba[p + 1] = sa > 0 ? Math.round(sg / sa) : 0;
      rgba[p + 2] = sa > 0 ? Math.round(sb / sa) : 0;
      rgba[p + 3] = Math.round(aAvg);
    }
  }
  return rgba;
}

const dir = new URL("../public/icon/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  writeFileSync(new URL(`${size}.png`, dir), png(size, iconRgba(size)));
}
console.log("wrote public/icon/{16,32,48,96,128}.png");
