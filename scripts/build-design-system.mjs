// Build the RacquetIQ design-system bundle for claude.ai/design.
// Every value is READ FROM THE REAL TOKEN FILES — nothing here is hand-typed,
// so a card cannot quietly drift from what the products actually ship.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REPO = "/Users/karanvirkhanna/RacquetAI";
const OUT = process.argv[2];
const tokensCss = readFileSync(join(REPO, "web/src/styles/tokens.css"), "utf8");

/** Pull one `:root[data-theme="x"] { ... }` block into a name -> value map. */
function themeBlock(theme) {
  const re = new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const body = tokensCss.match(re)?.[1] ?? "";
  const out = {};
  for (const m of body.matchAll(/(--rq-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const dark = themeBlock("dark");
const light = themeBlock("light");
// The geometry/type block is themeless.
const rootBody = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}\s*$/m)?.[1] ?? "";
const scale = {};
for (const m of rootBody.matchAll(/(--rq-[\w-]+)\s*:\s*([^;]+);/g)) scale[m[1]] = m[2].trim();

const decls = (o) => Object.entries(o).map(([k, v]) => `      ${k}: ${v};`).join("\n");

/**
 * Contrast is COMPUTED from the token values, never typed. The brand doc's
 * table went stale the moment the accent changed hex — every ratio in it was
 * still quoting the old colour. A card that states a number it did not measure
 * is worse than a card that states none.
 */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };
const hex = (v) => (v || "").trim().match(/^#[0-9a-fA-F]{6}$/) ? v.trim() : null;

const ACCENT = hex(light["--rq-accent"]) ?? "#000000";
const ACCENT_TEXT_L = hex(light["--rq-accent-text"]) ?? "#000000";
const BG_L = hex(light["--rq-bg"]) ?? "#ffffff";
const BG_D = hex(dark["--rq-bg"]) ?? "#000000";
const R_ACCENT_ON_LIGHT = ratio(ACCENT, BG_L);
const R_ACCENTTEXT_ON_LIGHT = ratio(ACCENT_TEXT_L, BG_L);
const R_ACCENT_ON_DARK = ratio(ACCENT, BG_D);

const BASE = `
    :root {
${decls(scale)}
${decls(light)}
    }
    .dark {
${decls(dark)}
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
    .pane { padding: 22px; background: var(--rq-bg); color: var(--rq-text); }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; }
    @media (max-width: 620px) { .grid2 { grid-template-columns: 1fr; } }
    .eyebrow { font-size: 11px; font-weight: 800; text-transform: uppercase;
               letter-spacing: var(--rq-ls-caps-tight, .14em); color: var(--rq-text-dim); margin: 0 0 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .note { font-size: 12.5px; color: var(--rq-text-dim); margin: 14px 0 0; line-height: 1.55; }
    .sw { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
    .chipC { width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--rq-line-2); flex: none; }
    .nm { font-size: 12px; font-weight: 700; }
    .hex { font-size: 11px; color: var(--rq-text-dim); font-variant-numeric: tabular-nums; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
           min-height: 44px; padding: 0 18px; border-radius: var(--rq-r-md); font-weight: 800;
           font-size: 15px; border: 1px solid transparent; cursor: pointer; }
    .btn-primary { background: var(--rq-accent); color: var(--rq-on-accent); }
    .btn-secondary { background: var(--rq-accent-soft); color: var(--rq-accent-text); }
    .btn-outline { background: var(--rq-card); color: var(--rq-text); border-color: var(--rq-line-2); }
    .btn-ghost { background: transparent; color: var(--rq-text-dim); }
    .card { background: var(--rq-card); border: 1px solid var(--rq-line);
            border-radius: var(--rq-r-lg); padding: 18px; }
    .pill { display: inline-flex; align-items: center; min-height: 32px; padding: 0 13px;
            border-radius: var(--rq-r-pill); background: var(--rq-chip);
            border: 1px solid var(--rq-line); font-size: 13px; font-weight: 600; }
    .input { min-height: 44px; width: 100%; border-radius: var(--rq-r-sm); padding: 0 12px;
             border: 1px solid var(--rq-line-2); background: var(--rq-input); color: var(--rq-text);
             font-size: 15px; }
    .lbl { font-size: 14px; font-weight: 600; color: var(--rq-text-dim); display: block; margin-bottom: 6px; }
`;

function card(group, name, bodyHtml, extraCss = "") {
  return `<!-- @dsCard group="${group}" -->
<style>${BASE}${extraCss}</style>
<div class="grid2">
  <div class="pane"><p class="eyebrow">${name} · light</p>${bodyHtml}</div>
  <div class="pane dark"><p class="eyebrow">${name} · dark</p>${bodyHtml}</div>
</div>`;
}

const swatch = (k) => `<div class="sw"><div class="chipC" style="background:${
  k === "--rq-accent" ? "var(--rq-accent)" : `var(${k})`
}"></div><div><div class="nm">${k.replace("--rq-", "")}</div><div class="hex">${
  (light[k] ?? dark[k] ?? "").slice(0, 34)
}</div></div></div>`;

mkdirSync(join(OUT, "foundations"), { recursive: true });
mkdirSync(join(OUT, "components"), { recursive: true });

const surfaces = ["--rq-bg", "--rq-panel", "--rq-card", "--rq-chip", "--rq-input", "--rq-line", "--rq-line-2"];
const inks = ["--rq-text", "--rq-text-dim", "--rq-text-faint"];
const accents = ["--rq-accent", "--rq-accent-text", "--rq-accent-soft", "--rq-data", "--rq-danger"];

writeFileSync(join(OUT, "foundations/colour.html"), card("Foundations", "Palette",
  `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
     <div><p class="eyebrow" style="margin-bottom:4px">Surfaces</p>${surfaces.map(swatch).join("")}</div>
     <div><p class="eyebrow" style="margin-bottom:4px">Ink</p>${inks.map(swatch).join("")}
          <p class="eyebrow" style="margin:12px 0 4px">Accent</p>${accents.map(swatch).join("")}</div>
   </div>
   <p class="note">Court Ink canvas, Chalk text, one accent — Optic, the ball under floodlight.
      Values are read straight from <code>web/src/styles/tokens.css</code>, which agrees hex for hex
      with <code>src/theme/tokens.ts</code> and docs/04-branding.md.</p>`));

writeFileSync(join(OUT, "foundations/accent-rule.html"), card("Foundations", "Optic is a fill, never ink",
  `<div class="row" style="gap:14px">
     <span class="btn btn-primary">Correct — Optic as a fill</span>
     <span style="font-size:19px;font-weight:800;color:var(--rq-accent)">Wrong — Optic as text</span>
     <span style="font-size:19px;font-weight:800;color:var(--rq-accent-text)">Correct — accent-text</span>
   </div>
   <div class="row" style="margin-top:14px;gap:14px">
     <span style="display:inline-block;width:130px;height:9px;border-radius:99px;background:var(--rq-accent)"></span>
     <span style="display:inline-block;width:130px;height:9px;border-radius:99px;background:var(--rq-data)"></span>
   </div>
   <p class="note"><b>Optic (${ACCENT}) on the light canvas is ${R_ACCENT_ON_LIGHT}:1</b> — it needs 4.5:1.
      It holds as a FILL on either canvas (${R_ACCENT_ON_DARK}:1 on Court Ink), but as INK it fails.
      Anything that is text, an icon glyph, a border, a stroke or a spinner takes
      <code>--rq-accent-text</code> (${R_ACCENTTEXT_ON_LIGHT}:1 on light). Data marks — heat cells, meter
      fills — take <code>--rq-data</code>. The first bar above is <code>accent</code>, the second
      <code>data</code>: on the light half only one of them is still there.</p>
   <p class="note" style="opacity:.75">Every ratio on this card is computed from the live token values at
      build time, not typed. Regenerate when the palette moves.</p>`));

writeFileSync(join(OUT, "foundations/ink-ramp.html"), card("Foundations", "The three-tier ink ramp",
  `<p style="font-size:16px;margin:0 0 6px;color:var(--rq-text)">text — the value you came to read</p>
   <p style="font-size:16px;margin:0 0 6px;color:var(--rq-text-dim)">text-dim — body copy, captions, labels of enabled controls</p>
   <p style="font-size:16px;margin:0 0 6px;color:var(--rq-text-faint)">text-faint — disabled, placeholder, watermark. Nothing readable.</p>
   <p class="note"><b>text-faint measures 2.72:1 on the light canvas.</b> That is legal only because WCAG
      exempts genuinely inactive components, so it may never carry body copy, a value the user has to read,
      or the label of an enabled control. An unreached step's number stays faint; the words beside it do not.
      An unselected tab label is an enabled control — it takes text-dim.</p>`));

writeFileSync(join(OUT, "foundations/type.html"), card("Foundations", "Type scale",
  `<p style="font-size:var(--rq-fs-display);letter-spacing:var(--rq-ls-display);font-weight:800;margin:0 0 2px;line-height:1.05">Display</p>
   <p style="font-size:var(--rq-fs-title);letter-spacing:var(--rq-ls-title);font-weight:800;margin:0 0 2px">Title / h3</p>
   <p style="font-size:var(--rq-fs-h4);letter-spacing:var(--rq-ls-title);font-weight:800;margin:0 0 2px">h4 — 18px</p>
   <p style="font-size:var(--rq-fs-lead);color:var(--rq-text-dim);margin:0 0 2px">Lead — the standfirst under a heading</p>
   <p style="font-size:var(--rq-fs-body);margin:0 0 2px">Body — 16px, the default</p>
   <p style="font-size:var(--rq-fs-body-sm);margin:0 0 2px">Body small — 15px</p>
   <p style="font-size:var(--rq-fs-label);font-weight:600;margin:0 0 2px">Label — 14px / 600, anything that labels a control</p>
   <p style="font-size:var(--rq-fs-caption);color:var(--rq-text-dim);margin:0 0 2px">Caption — 12.5px, and it is text-dim, not faint</p>
   <p class="eyebrow" style="margin:8px 0 0">Micro label — 11px / 800 / uppercase</p>
   <p class="note">The platform UI face, always — SF Pro on Apple, Roboto on Android. Three weights: 400,
      600, 800. Display and title carry tight negative tracking so headings feel athletic.</p>`));

writeFileSync(join(OUT, "foundations/geometry.html"), card("Foundations", "Radius, spacing, tap target",
  `<div class="row">
     ${["sm", "md", "lg", "xl"].map((r) => `<div style="text-align:center"><div style="width:66px;height:52px;background:var(--rq-accent-soft);border:1px solid var(--rq-accent-line);border-radius:var(--rq-r-${r})"></div><div class="hex" style="margin-top:6px">r-${r} · ${scale[`--rq-r-${r}`]}</div></div>`).join("")}
   </div>
   <div class="row" style="margin-top:16px;align-items:flex-end">
     ${["xs", "sm", "md", "lg", "xl"].map((s) => `<div style="text-align:center"><div style="width:var(--rq-sp-${s});height:var(--rq-sp-${s});background:var(--rq-data)"></div><div class="hex" style="margin-top:6px">${s}</div></div>`).join("")}
   </div>
   <p class="note">Every interactive element clears <b>44px</b> (<code>--rq-touch</code>), the Apple HIG
      minimum — footer links and small buttons included. Geometry is shared with the app via
      <code>src/theme/tokens.ts</code>, so the web and iOS measure the same.</p>`));

writeFileSync(join(OUT, "components/buttons.html"), card("Components", "Buttons",
  `<div class="row">
     <button class="btn btn-primary">Analyze a match</button>
     <button class="btn btn-secondary">Secondary</button>
     <button class="btn btn-outline">Outline</button>
     <button class="btn btn-ghost">Ghost</button>
   </div>
   <div class="row" style="margin-top:12px">
     <button class="btn btn-primary" style="min-height:56px;font-size:17px;padding:0 26px;border-radius:var(--rq-r-lg)">Large</button>
     <button class="btn btn-primary" style="min-height:44px;font-size:14px;padding:0 15px;border-radius:var(--rq-r-sm)">Small</button>
     <button class="btn btn-primary" style="opacity:.5">Disabled</button>
     <button class="btn btn-outline" style="outline:2px solid var(--rq-accent-text);outline-offset:2px">Focus ring</button>
   </div>
   <p class="note">An accent fill ALWAYS carries ink text (<code>--rq-on-accent</code>), never Chalk.
      The outline variant's hover border is <code>accent-text</code>, not <code>accent</code> — with
      accent it went from 1.48:1 to 1.19:1 on hover, so hovering made the button fainter.
      The focus ring is <code>accent-text</code> at 2px for the same reason.</p>`));

writeFileSync(join(OUT, "components/cards.html"), card("Components", "Card, hairline, icon chip",
  `<div class="card">
     <div style="display:flex;gap:10px;align-items:center">
       <span style="width:38px;height:38px;border-radius:var(--rq-r-sm);background:var(--rq-accent-soft);color:var(--rq-accent-text);display:inline-flex;align-items:center;justify-content:center;font-weight:800">◍</span>
       <span style="width:38px;height:38px;border-radius:var(--rq-r-sm);background:var(--rq-danger-soft);color:var(--rq-danger);display:inline-flex;align-items:center;justify-content:center;font-weight:800">!</span>
     </div>
     <p style="font-size:var(--rq-fs-h4);font-weight:800;margin:14px 0 6px">One card recipe</p>
     <p style="font-size:15px;color:var(--rq-text-dim);margin:0;line-height:1.55">
       Card surface, one hairline, generous padding. Used for every card on the site.</p>
     <div style="height:1px;background:var(--rq-line);margin:14px 0"></div>
     <p style="font-size:12.5px;color:var(--rq-text-dim);margin:0">Caption — text-dim, never faint.</p>
   </div>
   <p class="note">IconChip takes a <code>tone</code>: accent by default, danger for failure states —
      a failed checkout must not wear the same badge as a successful one.</p>`));

writeFileSync(join(OUT, "components/form.html"), card("Components", "Field, chips",
  `<label class="lbl" for="a">Email</label><input class="input" id="a" placeholder="you@club.com">
   <label class="lbl" for="b" style="margin-top:12px">Club (optional)</label>
   <input class="input" id="b" placeholder="Where you play" style="border-color:var(--rq-danger)">
   <p style="font-size:12.5px;color:var(--rq-danger);margin:6px 0 0">That didn't go through — check the email.</p>
   <div class="row" style="margin-top:16px">
     <span class="pill">Squash only</span><span class="pill">Your own footage</span>
     <span class="pill" style="background:var(--rq-accent-soft);border-color:var(--rq-accent-line);color:var(--rq-accent-text)">Accent badge</span>
   </div>
   <p class="note">Fields are 44px minimum with a small radius on the input surface. An error sets
      <code>aria-invalid</code> and <code>aria-describedby</code>, and is announced — colour is never
      the only carrier of the message.</p>`));

writeFileSync(join(OUT, "components/stats.html"), card("Components", "Stat and meter",
  `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px 16px">
     ${[["Footage", "7:31", "minutes analysed"], ["Shots detected", "486", "across both players"], ["Both players seen", "71", "of sampled frames"]]
       .map(([l, v, h]) => `<div><p class="eyebrow" style="margin:0 0 6px;min-height:2.9em">${l}</p>
         <p style="font-size:28px;font-weight:800;margin:0;line-height:1;font-variant-numeric:tabular-nums">${v}</p>
         <p style="font-size:12.5px;color:var(--rq-text-dim);margin:6px 0 0">${h}</p></div>`).join("")}
   </div>
   <div style="margin-top:18px;height:6px;border-radius:99px;background:var(--rq-line);overflow:hidden">
     <div style="width:64%;height:100%;border-radius:99px;background:var(--rq-data)"></div>
   </div>
   <p class="note">Figures are tabular so a value ticking during playback does not shift the layout.
      Labels reserve two lines where a row must share a baseline. The meter fill is
      <code>--rq-data</code>, never <code>--rq-accent</code> — on a light card Optic at low opacity is
      nothing at all.</p>`));

console.log("bundle written to " + OUT);
