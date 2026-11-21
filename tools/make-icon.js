// Draws the app icon (a red page with a folded corner and the letters PDF)
// and writes app/pdf-editor.ico. No dependencies: the pixels are computed
// here and encoded as PNG entries inside the ICO container.
//   node tools/make-icon.js
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4; // supersampling per axis, for smooth edges

// 5x7 pixel letters
const FONT = {
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
};
const TEXT = "PDF";

const PAGE = [229, 72, 77];
const FOLD = [255, 138, 142];
const WHITE = [255, 255, 255];

// Returns [r, g, b] or null (transparent) for a point in the unit square.
function sample(u, v, withText) {
  const x0 = 0.12, x1 = 0.88, y0 = 0.04, y1 = 0.96, r = 0.08, fold = 0.26;
  if (u < x0 || u > x1 || v < y0 || v > y1) return null;
  // rounded corners
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;
  // folded top-right corner
  const fx = u - (x1 - fold);
  const fy = y0 + fold - v;
  if (fx > 0 && fy > 0) return fx + fy > fold ? null : FOLD;
  if (withText) {
    const cols = TEXT.length * 6 - 1;
    const cell = 0.56 / cols;
    const tx = (u - (0.5 - (cols * cell) / 2)) / cell;
    const ty = (v - (0.67 - (7 * cell) / 2)) / cell;
    if (tx >= 0 && tx < cols && ty >= 0 && ty < 7) {
      const col = Math.floor(tx);
      const glyph = FONT[TEXT[Math.floor(col / 6)]];
      if (col % 6 < 5 && glyph[Math.floor(ty)][col % 6] === "1") return WHITE;
    }
  }
  return PAGE;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const withText = size >= 32;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, withText);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (y * size + x) * 4;
      if (a) { rgba[i] = r / a; rgba[i + 1] = g / a; rgba[i + 2] = b / a; }
      rgba[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 per row
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const images = SIZES.map(size => ({ size, data: png(size, render(size)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);               // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size === 256 ? 0 : size;         // 0 means 256
  e[1] = size === 256 ? 0 : size;
  e.writeUInt16LE(1, 4);                  // planes
  e.writeUInt16LE(32, 6);                 // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
const out = path.join(__dirname, "..", "app", "pdf-editor.ico");
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images.map(i => i.data)]));
console.log(`Wrote ${out} (${SIZES.join(", ")} px)`);
