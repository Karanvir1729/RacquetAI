#!/usr/bin/env node
/**
 * RacquetAI brand asset pipeline.
 *
 *   node scripts/generate-assets.mjs           render every PNG, then verify it
 *   node scripts/generate-assets.mjs --check    verify sources only, write nothing
 *
 * Every deliverable in assets/brand/ is rendered from a master SVG in
 * assets/brand/src/. Do not hand-edit the PNGs — they are build output that
 * happens to be committed (EAS builds from the git tree, so the binaries have
 * to be in it).
 *
 * The script is deliberately paranoid, because all three failure modes below
 * have already bitten this repo or ship as silent App Store rejections:
 *
 *  1. SNIFF WINDOW. libvips decides a file is an SVG by looking for "<svg" in
 *     roughly the first 1 KB. A long licence header or design note above the
 *     root element pushes it past that window and the file becomes
 *     "unsupported image format" — with no hint that a comment caused it.
 *     Hence: prose lives INSIDE <svg>, and assertSniffable enforces it.
 *  2. ALPHA IN THE iOS ICON. App Store Connect rejects an icon with an alpha
 *     channel at upload time, i.e. after a full build. assertOpaque checks the
 *     rendered bytes rather than trusting flatten() to have run.
 *  3. GEOMETRY DRIFT. icon/splash/wordmark each embed a copy of the mark's
 *     drawing elements (they can't <use> across files — librsvg won't resolve
 *     cross-document references). checkGeometry compares them to mark.svg and
 *     fails on any divergence, so a mark tweak can't ship to five sizes and
 *     miss one.
 */
import { Buffer } from "node:buffer";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "assets", "brand", "src");
const OUT = path.join(ROOT, "assets", "brand");

/** Court Ink — the flatten colour for every opaque deliverable. Keep in step
 *  with `colors.bg` (dark) in src/theme/tokens.ts and docs/04-branding.md. */
const COURT_INK = "#06130E";

/** libvips scans ~1 KB for the root element; stay well clear of the edge. */
const SNIFF_WINDOW = 1024;

/** mark.svg ink box is 400 tall on a 512 grid. Android's adaptive icon shows
 *  the middle 72 of 108 dp and only guarantees the middle 66, so the ink has to
 *  fit 66/108 of 1024 = 625 px. 561 px leaves a deliberate margin: Android
 *  scales the foreground up inside the mask on some launchers. */
const ADAPTIVE_INK_H = 561;
const ADAPTIVE_CANVAS = 1024;
const ADAPTIVE_RENDER = Math.round((ADAPTIVE_INK_H * 512) / 400);
/** 66 of 108 dp — the region Android guarantees no mask will ever clip. */
const ADAPTIVE_SAFE_ZONE = Math.round((66 / 108) * ADAPTIVE_CANVAS);

const GEOMETRY_SOURCES = ["mark.svg", "mark-mono.svg", "icon.svg", "splash.svg", "wordmark.svg"];
const MARK_REF = "mark.svg";

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");

const problems = [];
const fail = (msg) => problems.push(msg);

/* ------------------------------------------------------------------ sources */

async function readSource(name) {
  return readFile(path.join(SRC, name), "utf8");
}

/** Guard against failure mode 1. */
function assertSniffable(name, text) {
  const at = Buffer.from(text, "utf8").indexOf("<svg");
  if (at < 0) return fail(`${name}: no <svg> element`);
  if (at >= SNIFF_WINDOW) {
    fail(
      `${name}: <svg> starts at byte ${at}, past the ~${SNIFF_WINDOW}-byte sniff window — ` +
        `libvips will report "unsupported image format". Move the comment inside <svg>.`
    );
  }
}

/** End-to-end parse through the same loader the renderer uses. Catches the
 *  things XML validators shrug at and librsvg does not — most often a "--"
 *  inside a comment, which is illegal XML and very easy to type when the
 *  comment is documenting a command-line flag. */
async function assertParses(name) {
  try {
    await sharp(path.join(SRC, name)).metadata();
  } catch (err) {
    fail(`${name}: librsvg cannot parse this file — ${err.message.split("\n")[0]}`);
  }
}

/* --------------------------------------------------------- geometry drift */

const START = "@mark-geometry:start";
const END = "@mark-geometry:end";

function extractBlock(name, text) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < 0) {
    fail(`${name}: missing @mark-geometry markers`);
    return null;
  }
  return text.slice(text.indexOf("-->", a) + 3, text.lastIndexOf("<!--", b));
}

const BED_GROUP = /<g clip-path="url\(#racquetai-bed\)"[\s\S]*?<\/g>/;

/** Colour-agnostic so the monochrome variant compares equal to the colour one. */
function normalize(fragment) {
  return (fragment.match(/<(?:path|ellipse|rect|circle)\b[^>]*\/>/g) ?? [])
    .filter((el) => !el.includes('fill="url('))
    .map((el) =>
      el
        .replace(/\s+/g, " ")
        .replace(/(stroke|fill)="(#[0-9A-Fa-f]{3,8}|none)"/g, "$1=<colour>")
        .trim()
    )
    .join("\n");
}

/** Drawing elements minus the string bed (the bed is absent from mark-mono). */
function coreSignature(block) {
  const withoutBed = block.replace(BED_GROUP, "");
  const inner = withoutBed.replace(/^\s*<g\b[^>]*>/, "").replace(/<\/g>\s*$/, "");
  return normalize(inner);
}

/** The string bed on its own; null when the file deliberately omits it. */
function bedSignature(block) {
  const bed = block.match(BED_GROUP);
  return bed ? normalize(bed[0]) : null;
}

function checkGeometry(sources) {
  const ref = sources.get(MARK_REF);
  if (!ref) return;
  for (const [name, block] of sources) {
    if (name === MARK_REF) continue;
    if (coreSignature(block) !== coreSignature(ref)) {
      fail(`${name}: mark geometry has drifted from ${MARK_REF} (head/throat/grip/spark)`);
    }
    const bed = bedSignature(block);
    const refBed = bedSignature(ref);
    if (name === "mark-mono.svg") {
      if (bed !== null) fail(`${name}: monochrome mark must not carry the string bed`);
    } else if (bed === null) {
      fail(`${name}: missing the string bed group`);
    } else if (bed !== refBed) {
      fail(`${name}: string bed has drifted from ${MARK_REF}`);
    }
  }
}

/* ---------------------------------------------------------------- rendering */

/** Rasterise at the target size directly rather than rendering small and
 *  upscaling: density is what librsvg actually uses, resize() alone resamples. */
async function render(name, size) {
  const file = path.join(SRC, name);
  const meta = await sharp(file).metadata();
  const density = Math.min(2400, Math.round((72 * size) / meta.width));
  return sharp(file, { density }).resize(size, size, { fit: "contain" }).png().toBuffer();
}

/** Mark on a transparent canvas, sized for the Android adaptive safe zone. */
async function adaptiveLayer(name) {
  const mark = await render(name, ADAPTIVE_RENDER);
  const inset = Math.round((ADAPTIVE_CANVAS - ADAPTIVE_RENDER) / 2);
  return sharp({
    create: {
      width: ADAPTIVE_CANVAS,
      height: ADAPTIVE_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, top: inset, left: inset }])
    .png()
    .toBuffer();
}

async function opaque(buf) {
  return sharp(buf).flatten({ background: COURT_INK }).png().toBuffer();
}

/* -------------------------------------------------------------- deliverables */

const DELIVERABLES = [
  {
    file: "app-icon.png",
    size: 1024,
    alpha: false,
    note: "iOS/App Store icon — alpha is a hard rejection",
    build: async () => opaque(await render("icon.svg", 1024)),
  },
  {
    file: "android-foreground.png",
    size: 1024,
    alpha: true,
    safeZone: ADAPTIVE_SAFE_ZONE,
    note: "adaptive icon foreground, safe-zone inset",
    build: () => adaptiveLayer("mark.svg"),
  },
  {
    file: "android-monochrome.png",
    size: 1024,
    alpha: true,
    safeZone: ADAPTIVE_SAFE_ZONE,
    whiteOnly: true,
    note: "adaptive icon monochrome layer (themed icons)",
    build: () => adaptiveLayer("mark-mono.svg"),
  },
  {
    file: "splash.png",
    size: 1024,
    alpha: true,
    note: "expo-splash-screen, drawn at imageWidth 180",
    build: () => render("splash.svg", 1024),
  },
  {
    file: "notification-icon.png",
    size: 96,
    alpha: true,
    whiteOnly: true,
    note: "Android notification silhouette, white on transparent",
    build: () => render("mark-mono.svg", 96),
  },
  {
    file: "favicon.png",
    size: 48,
    alpha: false,
    note: "web favicon",
    build: async () => opaque(await render("icon.svg", 48)),
  },
];

/** Superseded by splash.png; removed so nothing can reference a stale file. */
const RETIRED = ["splash-icon.png"];

/** PNG colour type, straight out of the IHDR: 0 grey, 2 RGB, 4 grey+A, 6 RGBA. */
function pngColourType(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return buf[25];
}

async function verify(file, expected) {
  const buf = await readFile(path.join(OUT, file));
  const m = await sharp(buf).metadata();
  const ok = [];
  if (m.width !== expected.size || m.height !== expected.size) {
    fail(`${file}: expected ${expected.size}x${expected.size}, got ${m.width}x${m.height}`);
  }
  // Read the colour type out of the IHDR rather than asking sharp: the claim
  // being made is about the bytes App Store Connect will parse, and metadata
  // would describe a palette PNG (type 3) as alpha-free too — which it is, but
  // it also dithers the icon's gradient. 2 = RGB, 6 = RGBA, and nothing else
  // is acceptable here.
  const colourType = pngColourType(buf);
  if (colourType === null) {
    fail(`${file}: not a PNG`);
  } else if (expected.alpha === false && colourType !== 2) {
    fail(`${file}: PNG colour type ${colourType}, expected 2 (RGB, no alpha)`);
  } else if (expected.alpha === true && colourType !== 6) {
    fail(`${file}: PNG colour type ${colourType}, expected 6 (RGBA)`);
  }
  // A blank render is still a valid PNG; make sure something was actually drawn.
  const { info } = await sharp(buf).trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
  if (info.width < 2 || info.height < 2) fail(`${file}: rendered empty`);

  // Android masks the outer sixth of an adaptive icon and only guarantees the
  // middle 66/108. Assert the ink lands inside that, rather than trusting the
  // inset arithmetic upstream.
  if (expected.safeZone) {
    const margin = (expected.size - expected.safeZone) / 2;
    const left = -info.trimOffsetLeft;
    const top = -info.trimOffsetTop;
    const out = [
      left < margin && `left ${left}`,
      top < margin && `top ${top}`,
      left + info.width > expected.size - margin && `right ${expected.size - left - info.width}`,
      top + info.height > expected.size - margin && `bottom ${expected.size - top - info.height}`,
    ].filter(Boolean);
    if (out.length) {
      fail(`${file}: ink escapes the ${expected.safeZone}px adaptive safe zone (${out.join(", ")} < ${margin})`);
    }
  }

  // Android throws away the colour of a monochrome/notification layer and tints
  // the silhouette. Anything chromatic in there is a bug you only see on device.
  if (expected.whiteOnly) {
    const { data, info: raw } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let chromatic = 0;
    let dim = 0;
    for (let i = 0; i < data.length; i += raw.channels) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 0) continue;
      if (r !== g || g !== b) chromatic++;
      else if (a === 255 && r !== 255) dim++;
    }
    if (chromatic) fail(`${file}: ${chromatic} chromatic pixels; the silhouette must be pure white`);
    if (dim) fail(`${file}: ${dim} opaque pixels darker than white`);
  }

  ok.push(`${m.width}x${m.height}`, m.hasAlpha ? "RGBA" : "RGB", `${(buf.length / 1024).toFixed(1)} KB`);
  return ok.join("  ");
}

/* --------------------------------------------------------------------- main */

const sources = new Map();
for (const name of GEOMETRY_SOURCES) {
  const text = await readSource(name);
  assertSniffable(name, text);
  await assertParses(name);
  const block = extractBlock(name, text);
  if (block) sources.set(name, block);
}
checkGeometry(sources);

if (problems.length) {
  console.error("Source checks failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`sources ok  (${GEOMETRY_SOURCES.length} masters, geometry in sync)`);

if (CHECK_ONLY) {
  console.log("--check: no files written");
  process.exit(0);
}

for (const d of DELIVERABLES) {
  await writeFile(path.join(OUT, d.file), await d.build());
  const summary = await verify(d.file, d);
  console.log(`  ${d.file.padEnd(24)} ${summary.padEnd(28)} ${d.note}`);
}

for (const stale of RETIRED) {
  await unlink(path.join(OUT, stale)).catch(() => {});
}

if (problems.length) {
  console.error("Output verification failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("all deliverables verified");
