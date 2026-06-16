// Generates placeholder Loupe icons (a gold eye on the dark brand background) as
// PNGs, with a tiny hand-rolled encoder so no image dependency is needed. Swap
// in a designed icon later; WXT auto-discovers public/icon/{size}.png.
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

function iconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const iris = size * 0.4;
  const pupil = size * 0.15;
  const bg = [20, 23, 31];
  const gold = [246, 207, 110];
  const pupilColor = [20, 23, 31];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let col = bg;
      if (d <= pupil) col = pupilColor;
      else if (d <= iris) col = gold;
      const p = (y * size + x) * 4;
      rgba[p] = col[0];
      rgba[p + 1] = col[1];
      rgba[p + 2] = col[2];
      rgba[p + 3] = 255;
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
