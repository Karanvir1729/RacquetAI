# 02 — Infra heritage (from the daybot mobile app)

RacquetAI is a new product with new code, but it is not a new *platform*. Its build, config,
theming, and testing infrastructure are lifted from the daybot mobile app — a React Native /
Expo app by the same operator that went from empty folder to **live on the App Store
worldwide** in about a week, through one rejection and a five-lens submission audit.

That app paid for a lot of knowledge in review round-trips and lost evenings. This document
records what we inherited, why, and — just as importantly — **what we deliberately left
behind**.

> **Scope note.** This doc references daybot to document infrastructure lineage only. No
> daybot account identifiers, keys, team/app IDs, demo credentials, domains, or product
> concepts exist anywhere in RacquetAI's app code or assets. Everything account-shaped below
> is a `TODO_OPERATOR_*` placeholder.

---

## 1. Why inherit at all

The failure mode for a fresh Expo app is not "we picked the wrong architecture". It is a
week lost to version skew, a rejection for something invisible in the simulator, or a
credential file quietly committed on day three. All three were already survived once.

Three concrete debts we are *not* paying again:

| Debt daybot paid | What it cost | What we inherit |
|---|---|---|
| Expo/RN/reanimated version skew | Phantom build breakage, repeatedly | The exact pinned SDK 57 matrix (§2) |
| `ios.supportsTablet` left unset | An App Review **guideline 4 rejection** on iPad | `supportsTablet: true` + layout caps from commit #1 (§4) |
| A committed Firebase config file | A credential-class file in git history forever | An aggressive `.gitignore` from commit #1 (§6) |

---

## 2. The pinned Expo SDK 57 dependency matrix

**Rule: every dependency RacquetAI shares with the daybot app is pinned to the identical
version.** Not "compatible with". Identical. This is ADR-001.

The rationale is narrow and specific: that combination is known-good *under App Review, on
physical devices, and through EAS production builds*. A matrix that merely installs cleanly
proves nothing — the failures that matter (Hermes bytecode differences, reanimated worklet
mismatches, native module peer conflicts) only appear in a release build on hardware.

### Inherited verbatim

| Package | Version | Why it is load-bearing |
|---|---|---|
| `expo` | `~57.0.8` | SDK anchor — every `expo-*` version below is chosen by it |
| `react-native` | `0.86.0` | Exact pin; peerOptional constraints downstream key off this |
| `react` / `react-dom` | `19.2.3` | Matches RN 0.86.0's bundled renderer |
| `expo-router` | `~57.0.8` | File-based routing + typed routes |
| `react-native-reanimated` | `4.5.0` | Exact pin — must move in lockstep with worklets |
| `react-native-worklets` | `0.10.0` | Reanimated 4's split-out worklet runtime |
| `react-native-gesture-handler` | `~2.32.0` | Required by expo-router's navigators |
| `react-native-screens` | `~4.26.0` | Native screen containers |
| `react-native-safe-area-context` | `~5.7.0` | Safe-area insets everywhere (non-negotiable on iOS) |
| `react-native-web` | `~0.21.0` | Web target for layout-only checks |
| `@expo/vector-icons` | `^15.1.1` | Icon set used across tabs and rows |
| `zustand` | `^5.0.14` | Client state; no hand-rolled caches |
| `expo-constants`, `expo-font`, `expo-haptics`, `expo-image`, `expo-keep-awake`, `expo-linking`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `expo-dev-client` | SDK-57 matched | Same versions daybot shipped |
| `eslint-config-expo` `~57.0.0`, `typescript` `~6.0.3`, `prettier` `^3.9.6` | as-shipped | Toolchain parity keeps lint output comparable |

### Added for RacquetAI (daybot had no equivalent)

Resolved by `npx expo install`, i.e. chosen by SDK 57 itself rather than by us:

| Package | Version | Purpose |
|---|---|---|
| `expo-camera` | `~57.0.3` | Match video capture (ADR-003) |
| `expo-video` | `~57.0.2` | Playback; its config plugin is auto-added to `app.json` |
| `expo-file-system` | `~57.0.4` | Recordings in the app sandbox |
| `expo-media-library` | `~57.0.4` | Optional export to Photos |

**These four are not free at review time.** daybot's readiness audit could write "no camera /
photos / location / contacts — no permission APIs used, so no missing `NS*UsageDescription`
strings" and move on. RacquetAI cannot: camera, microphone, and photo-library access are the
product. Every one needs a purpose string that names *why* in the user's terms, configured
through the config-plugin blocks in `app.json` rather than hand-edited into a plist (ADR-004).
A generic or missing purpose string is a guideline 5.1.1 rejection, and it is the single
largest review surface RacquetAI has that its predecessor did not. Checklist in
[07-app-store-prep.md](07-app-store-prep.md) §1 and §10.

### The one deliberate divergence

`jest-expo` is pinned **exactly** to `57.0.2`, not `^57.0.2`. `57.0.4` raised its
`@react-native/jest-preset` peer to `^0.86.2`, which conflicts with RN `0.86.0`'s peerOptional
pin. `57.0.2` is what daybot's own lockfile actually resolved to — the caret range was a
latent trap that had simply not been re-resolved yet. Recorded in ADR-001.

### Upgrade policy

Bump the matrix **as a matrix**: Expo + RN + React + reanimated + worklets + screens +
gesture-handler together, via `npx expo install --fix`, followed by a physical-device pass.
Never upgrade one package because a `npm audit` line item asked nicely.

---

## 3. expo-router with a `src/` layout

daybot used expo-router with routes at `mobile/app/` and everything else under `mobile/src/`.
RacquetAI collapses that: **routes live at `src/app/`**, so the entire application is one
directory and `@/*` → `src/*` resolves uniformly.

```
src/
  app/          expo-router routes — thin; compose feature components only
  components/   shared primitives (Screen, ScreenHeader, Button, Card, …)
  features/     one folder per feature; no cross-feature imports
  lib/          pure helpers with unit tests
  theme/        tokens.ts + layout.ts
```

Inherited rules, verbatim from daybot's coding principles (which held up across ~57 screens
and an App Review audit):

1. **Routes are thin.** No business logic, no direct API/media calls in route files. daybot's
   web predecessor had a 9,000-line component; the mobile codebase was an explicit reaction
   to it, and understandability was treated as a product requirement.
2. **One folder per feature.** A feature may import from `components`, `lib`, `theme` — never
   from another feature's internals. Shared things get promoted.
3. **Hard size limits.** >~300 lines per file or >~150 lines per component needs a split or a
   comment justifying why splitting would hurt.
4. **Strict TypeScript, no `any`** — `unknown` plus narrowing at boundaries.
5. **Comments state constraints the code cannot** (`// simulator has no camera`), not
   narration.

Also inherited: `experiments.typedRoutes` and `reactCompiler` both on, `scheme` set for deep
links, and `expo-router/entry` as `main`.

---

## 4. The theme system

Two files, both direct descendants of daybot decisions.

### 4.1 `tokens.ts` — DynamicColorIOS pairs (daybot ADR-010)

daybot originally shipped a dark-only palette with `userInterfaceStyle: "dark"` pinned. Field
testing on-device killed that: dark mode had to be *real*, and flipping the phone to light
mode had to actually re-theme the app. The problem was that 57 files consumed tokens from
module-scope `StyleSheet.create` — a hook-based theme context would have had to touch every
one of them, days before a submission build.

The fix, which we inherit as the *starting* architecture rather than a rescue:

```ts
function dyn(dark: string, light: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ dark, light }) : dark;
}
```

Every colour token is a dark/light pair. iOS resolves the palette **natively**, so:

- module-scope `StyleSheet.create` keeps working — no theme provider, no re-render cost;
- a system-setting flip restyles the app live;
- `app.json` sets `userInterfaceStyle: "automatic"`, `StatusBar` uses `style="auto"`.

Android has no `DynamicColorIOS`, so it pins the dark palette until someone does an
`Appearance`-listener pass; `android.userInterfaceStyle: "dark"` matches that honestly.

Two inherited rules that exist because they were learned the hard way:

- **Never hardcode a colour in a component.** This is what lets `feat/branding` swap the whole
  palette in one file. daybot ended up with ~29 stray `rgba()` literals across 19 files that
  stayed dark-tuned and had to be swept opportunistically.
- **Accent-coloured *text* needs its own token.** A bright accent works as a fill in both
  themes but is illegible as text on a light surface — hence `accent` vs `accentText`, plus
  literal `surfaceWhite`/`inkOnWhite` for surfaces (switch thumbs, vendor buttons) that must
  *not* flip with the theme.

### 4.2 `layout.ts` — iPad column caps, and the rejection that bought them

daybot's 1.0 build 6 was **rejected under App Review guideline 4**: `ios.supportsTablet` was
never set, so it defaulted false, shipped effectively iPhone-only, and iPadOS drew it scaled —
tab bar labels clipped, a hero paragraph cut off. "Crowded, laid out, or displayed in a way
that made it difficult to use."

That is a rejection you cannot see in an iPhone simulator, and it costs a full review
round-trip at the worst possible moment.

RacquetAI's ADR-002 answers it before it can happen: `supportsTablet: true` and the full
`UISupportedInterfaceOrientations~ipad` array are in `app.json` from the first commit, and
`src/theme/layout.ts` ships two caps:

```ts
export const CONTENT_MAX_WIDTH = 760;  // tabs and lists
export const FORM_MAX_WIDTH    = 560;  // narrow centred forms
export const column = (maxWidth = CONTENT_MAX_WIDTH) =>
  ({ width: "100%", maxWidth, alignSelf: "center" }) as const;
```

Content sits in a centred readable column and the canvas breathes either side. On any phone
the window is narrower than both caps, so **every cap is a no-op and the iPhone layout is
unchanged**. Two widths only, so switching tabs never shifts the column.

The price of `supportsTablet: true` is real and is paid in §6 of
[07-app-store-prep.md](07-app-store-prep.md): it makes an iPad 13" screenshot set
**mandatory**, and an 11" set is not an accepted substitute.

---

## 5. EAS: the three-profile structure

`eas.json` is structurally daybot's, with every account-specific value removed:

```jsonc
{
  "cli":   { "appVersionSource": "remote" },   // build numbers live on EAS, not in git
  "build": {
    "development": { "developmentClient": true, "distribution": "internal",
                     "ios": { "simulator": true } },
    "preview":     { "distribution": "internal" },
    "production":  { "autoIncrement": true }
  },
  "submit": {
    "production": { "ios": { "ascAppId":    "TODO_OPERATOR_ASC_APP_ID",
                             "appleTeamId": "TODO_OPERATOR_APPLE_TEAM_ID" } }
  }
}
```

What each profile is actually for:

- **development** — a dev client that runs on the **simulator** and connects to Metro. This is
  the daily driver for layout work. For camera work it is useless (§7) and you want a device
  dev build instead.
- **preview** — internal distribution, release-configured JS. This is what you hand to a
  friend, and what shakes out release-only failures (Hermes bytecode, entitlements, `__DEV__`
  gates) *before* a submission build.
- **production** — `autoIncrement` with `appVersionSource: "remote"`, so build numbers cannot
  collide or regress no matter which machine builds.

### Divergences from daybot's eas.json

1. **No `ios.credentialsSource: "local"`.** daybot's production profile pointed at a
   `credentials.json` holding a `.p12` password. RacquetAI has no such file and must not
   acquire one in-repo; use EAS-managed credentials, or keep a local credentials file outside
   the repo and wire it at build time (see §6).
2. **No Android submit block.** daybot's referenced a Play service-account key path. It comes
   back when Android ships, pointing at a path outside the repo.
3. **`ascAppId` / `appleTeamId` are placeholders.** Filling them is an operator step. Note
   that putting real account IDs in `eas.json` puts them in git — daybot avoided this at
   submission time by uploading with `xcrun altool` and an API key held outside the repo
   instead of `eas submit`. Both paths are documented in
   [07-app-store-prep.md](07-app-store-prep.md).

---

## 6. Secrets hygiene — the part we changed on purpose

**This is the one place where we did not copy daybot; we corrected it.**

Verified against the daybot repo (read-only):

- `mobile/google-services.json` is **tracked in git**. That is a Firebase Android
  configuration — credential-class material — and once committed it is in history forever.
- `mobile/credentials.json` (holding the distribution `.p12` password), `mobile/.env`, and
  `mobile/.expo-token` were correctly gitignored — but the ignore rules were added
  *reactively*, appended over time as each new secret appeared.

RacquetAI's `.gitignore` therefore ships these from commit #1, before any such file can exist:

```gitignore
.env*
credentials.json
google-services.json
play-service-account.json
*.p8
*.keystore
*.jks
*.p12
*.pem
*.mobileprovision
*.key
```

Standing rules, inherited from daybot's release constraints and tightened:

1. **Credential material never enters the repo**, ignored or not. Keys live in a
   mode-`0600` directory in `$HOME`, outside any repo. daybot kept ASC `.p8`, the distribution
   `.p12`, and the provisioning profile that way and it worked; the mistake was letting
   `google-services.json` and a `credentials.json` sit inside `mobile/` at all.
2. **`app.json` carries no account identity.** No `owner`, no `extra.eas.projectId`, no
   `googleServicesFile`. `eas init` writes the project id when the operator links a real EAS
   project — that is a local, operator-time change, and it is the moment to decide whether it
   gets committed.
3. **Nothing that passed through a chat transcript stays valid.** daybot ended up with a
   standing rotation list (an LLM API key, a Sign-in-with-Apple `.p8`, demo-account passwords)
   because material was pasted into transcripts during debugging. Treat any key you have read
   aloud as burned.
4. **Scan every commit for key material before pushing.** A grep for `-----BEGIN`, `sk-`,
   `AuthKey_`, and `.p12` across the diff costs two seconds.
5. **Creating accounts and handling passwords is out of scope for automation.** Demo accounts,
   Apple sign-ins, and agreement acceptance are human steps, always.

---

## 7. Testing culture

Inherited wholesale, because it is the reason daybot shipped at all.

### Layer 1 — unit tests (`jest-expo`)

```jsonc
"jest": {
  "preset": "jest-expo",
  "testMatch": ["**/__tests__/**/*.test.ts"],
  "testPathIgnorePatterns": ["/node_modules/", "/.worktrees/"]
}
```

Same preset, same `testMatch`. daybot concentrated its unit tests on the code that encoded a
contract (its API client, SSE parser, JWT check, money formatting) and tested UI on a device
instead — snapshot tests of styled RN trees cost more than they catch. RacquetAI's equivalent
"contract" code is `src/lib` formatting and, when it lands, the scoring rule model.

`testPathIgnorePatterns` gains `/.worktrees/` because this repo's parallel worktrees live
inside the repo directory; without it jest would collect every branch's tests at once.
`tsconfig` `exclude` and the eslint ignores carry the same entry.

### Layer 2 — the three checks

`npm run typecheck` · `npm run lint` · `npm test`, all green before anything lands. Same
three commands locally and in CI, on a clean checkout.

### Layer 3 — physical testing, and the log

daybot's hardest-won rule, adopted verbatim:

> **Nothing is "done" on the strength of passing tests alone. Physically verify.**

Every feature phase ended with a scripted manual pass on a real device or simulator, recorded
in a testing log with date, commit, device/OS, checklist results, screenshots for UI changes,
and defects found. The log is what caught the things no test suite would have: a chat that
silently vanished on a button press, white bubbles that read wrong in dark mode, a crash on
opening a URL. All three shipped as fixes because a human used the app.

**RacquetAI's divergence, and it is a big one: the iOS simulator has no camera.**
`expo-camera` renders a black preview and cannot record. daybot's entire physical protocol ran
on the iPhone simulator; ours cannot. See [05-testing.md](05-testing.md) — anything touching
capture requires a plugged-in iPhone or a device dev build, full stop.

### Simulator-rig gotchas worth knowing before you lose an hour

From daybot's handoff notes, still applicable to any Expo dev-client workflow:

- A native dev-client build launches from its **embedded** bundle. Point it at Metro with a
  `<scheme>://expo-development-client/?url=...` deep link, or your edits silently do not
  appear.
- **Turn off the dev-client "Tools" bubble before any screenshot** (dev menu → toggle; it needs
  a slide, not a tap), or a floating control sits over every frame. Submission screenshots
  must come from a release build anyway — see 07 §6.
- Automated text injection pastes rather than types, so it will not catch per-character input
  bugs.
- The release JS bundle is **Hermes bytecode** — `grep` finds nothing in it. Use `strings -a`
  when verifying that dead code really is absent from a build.

---

## 8. What we deliberately did **not** copy

daybot's mobile app is a merchant client for a dropshipping platform. Most of it is domain
code and has no business here. Listing the omissions explicitly so nobody "restores" one by
reflex:

| Not copied | Why |
|---|---|
| **The whole store/dropshipping domain** — catalog, orders, payouts, storefronts, suppliers, AI store generation | Different product. Nothing from it appears in RacquetAI's code, copy, or assets. |
| **Branding: mascot, palette, icon, splash, name** | RacquetAI has its own identity (`feat/branding`). The *token architecture* is inherited; the *values* are not. |
| **The auth stack** — email/password, Google OAuth, Sign in with Apple, SecureStore JWT, session store, dev auto-login | v0 has no accounts. Recording happens on-device with nothing to log into. Adding auth later means re-deriving guideline 4.8 (offer Sign in with Apple if you offer another third-party login) and 5.1.1(v) (account deletion must actually delete) — both are pre-loaded in [07-app-store-prep.md](07-app-store-prep.md). |
| **Push notifications** (`expo-notifications`, device-token registration, APNs credentials) | Nothing to notify about yet. It also drags in an APNs key, a backend endpoint, an App Privacy "Device ID" declaration, and a permission prompt — all cost, no v0 benefit. A `notification-icon.png` placeholder exists but is deliberately unreferenced in `app.json`. |
| **The SSE-over-POST streaming client** and its hand-rolled parser | Exists solely to stream a server-side AI build. No RacquetAI surface streams. If AI scoring ever runs server-side and streams progress, that parser is a good reference — but write it against our own contract. |
| **TanStack Query** | Server-state library with no server. `zustand` covers on-device state; Query arrives with the first backend, not before. |
| **AsyncStorage draft persistence** | daybot needed it because a stateless intake conversation lived only in memory and a stray "+" destroyed it. Our recordings are files on disk — the persistence problem is different in kind. |
| **`expo-secure-store`, `expo-apple-authentication`, `expo-web-browser`, `expo-clipboard`, `expo-device`** | Each is a dependency in service of a feature we do not have. Fewer native modules = fewer prebuild surprises. |
| **In-app purchase / subscription surfaces** | daybot's 1.0 had to have an external Stripe checkout *removed* to survive guideline 3.1.1 (paying for in-app digital features outside StoreKit). If RacquetAI ever monetizes AI scoring, it is StoreKit or nothing — see 07 §11. |
| **Admin-only surfaces** | Platform-operator tooling for a marketplace. Not a concept here. |
| **`expo-build-properties`** | daybot carried it for exactly one line — an Android `minSdkVersion` bump. We have no native build override to make, and an unused config plugin is one more thing that can break a prebuild. It comes back the day we genuinely need a native flag. |
| **The backend itself** — FastAPI, D1, its API client | RacquetAI v0 is entirely on-device. |
| **A committed `google-services.json`** | See §6. This one is an anti-pattern, not an omission. |

### One correction to flag

`docs/06-decisions.md` ADR-004's *context* paragraph states the predecessor app committed its
generated `ios/` directory. Verified against the source repo: it did not — `mobile/.gitignore`
lists `/ios` and `/android` under "generated native folders" and `git ls-files mobile/ios`
returns zero entries. **ADR-004's decision (CNG, native folders gitignored) is correct and
unaffected**; only that one context sentence needs a fix from the file's owner. Noted here
rather than edited because `06-decisions.md` belongs to the baseline lane.

---

## 9. Summary: the inheritance in one table

| Layer | Inherited | Changed |
|---|---|---|
| Dependency matrix | Pinned SDK 57 versions, verbatim | + camera/video/file-system/media-library; `jest-expo` exact-pinned |
| Project layout | expo-router, thin routes, feature folders, size limits, strict TS | Routes moved under `src/app/` |
| Theme | `DynamicColorIOS` token pairs, tokens-only rule, accent-text rule | RacquetAI palette (provisional until `feat/branding`) |
| iPad | `supportsTablet` + column caps | Set from commit #1 instead of after a rejection |
| EAS | 3 build profiles, remote version source | No local credentials source, no Android submit, placeholder IDs |
| Secrets | Keys outside the repo, rotate anything transcribed | Full ignore list from commit #1; no config file with account identity |
| Testing | 3 checks + physical-verification rule + a written log | Camera work is **device-only**; no simulator path |
| App Store | The entire runbook in [07-app-store-prep.md](07-app-store-prep.md) | Genericized; no account identifiers |
