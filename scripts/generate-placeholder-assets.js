#!/usr/bin/env node
/**
 * Generates valid solid-colour PNG placeholders for every asset app.json
 * references. Zero dependencies: the PNGs are hand-encoded (IHDR + IDAT + IEND
 * with a real CRC32), so `expo prebuild` / EAS accept them as genuine images.
 *
 * These are throwaways — the feat/branding worktree replaces every file in
 * assets/brand/ with real artwork. Constraints that must survive the swap:
 *   - app-icon.png    1024x1024, NO alpha channel (App Store rejects alpha icons)
 *   - splash-icon.png 512x512 (rendered at imageWidth from app.json)
 *   - android-foreground.png / android-monochrome.png 1024x1024 RGBA
 *   - notification-icon.png 96x96 white-on-transparent (unused until push lands)
 *   - favicon.png     48x48
 *
 * Run: node scripts/generate-placeholder-assets.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

/** Solid-colour PNG. rgba = [r,g,b,a]; alpha=false emits RGB (colour type 2). */
function solidPng(width, height, rgba, alpha) {
  const bpp = alpha ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colour type
  const row = Buffer.alloc(1 + width * bpp); // leading 0 = no filter
  for (let x = 0; x < width; x++) {
    row[1 + x * bpp] = rgba[0];
    row[2 + x * bpp] = rgba[1];
    row[3 + x * bpp] = rgba[2];
    if (alpha) row[4 + x * bpp] = rgba[3];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Provisional palette (see src/theme/tokens.ts): deep court green + optic yellow.
const COURT = [8, 23, 17, 255]; // #081711
const OPTIC = [215, 246, 81, 255]; // #d7f651
const WHITE = [255, 255, 255, 255];

const outDir = path.join(__dirname, "..", "assets", "brand");
fs.mkdirSync(outDir, { recursive: true });

const assets = [
  ["app-icon.png", solidPng(1024, 1024, COURT, false)],
  ["splash-icon.png", solidPng(512, 512, OPTIC, true)],
  ["android-foreground.png", solidPng(1024, 1024, OPTIC, true)],
  ["android-monochrome.png", solidPng(1024, 1024, WHITE, true)],
  ["notification-icon.png", solidPng(96, 96, WHITE, true)],
  ["favicon.png", solidPng(48, 48, COURT, false)],
];

for (const [name, buf] of assets) {
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote assets/brand/${name} (${buf.length} bytes)`);
}
