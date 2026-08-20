# App Review notes — RacquetIQ

Two documents in one file:

1. **[Notes for App Review](#notes-for-app-review)** — paste into the "Notes" box in App Store
   Connect. Written to be read in under a minute.
2. **[Before you submit](#before-you-submit)** — for the operator, not for Apple. Things that
   will get this build rejected if they are still true at submission.

---

## Notes for App Review

```
RacquetIQ analyses a video of a squash match that the user has already filmed, and keeps
score with a correctable, spoken PAR-11 scoreboard (the Referee tab). The app never follows
the ball; every machine-made call is a suggestion a human can beat or correct with one tap.

SIGN-IN IS REQUIRED — DEMO ACCOUNT
The app requires an account (Sign in with Apple, or email + password). Demo account for
review:
  Email:     webtest@racquetiq.dev
  Password:  (filled in App Store Connect — never committed to this repo)
Accounts exist because the free-analysis allowance and the Pro subscription are tied to an
identity across devices and platforms. The account can be deleted in-app: Account tab →
Delete account.

THE REFEREE TAB, AND WHY YOU CANNOT FULLY REPRODUCE IT AT A DESK
The Referee tab is a tap-driven squash scoreboard that announces the score out loud. It can
also watch a match and score rallies itself, two ways:
- "Score a video": pick an analysed match; the app plays the footage, highlights both
  players, and calls each rally as the playhead reaches it. The demo account has analysed
  matches ready for this — open Referee → Score a video and pick the top row.
- "Watch live": the camera watches a real squash court and scores after a visible 4-second
  countdown a tap always beats. This needs a real court; an attached demo video shows the
  full flow (see App Review Attachment).
Automatic scoring is measured at roughly 73% per rally and the app SAYS SO before it scores
anything: a first-run alert, the caption on the switch, and a spoken warning at the start of
every armed session. It is off for any user who declines, every call is correctable in one
tap, and nothing RacquetIQ produces is presented as an official result.

NO FILMING IS NEEDED TO REVIEW THE APP
Open the Library tab and tap "Demo match analysis" (marked "Sample"). It opens a complete
analysis of a real club squash match, bundled in the app: rally counts, per-player shot
placement across the four court quadrants, a court-coverage heatmap, time spent at the T, and
a predictability score. No video, no network and no permissions are required to see it.

WHY THE CAMERA MATTERS
Analysis quality depends entirely on the footage. The app is built for a phone that is
BEHIND the court (a gallery, balcony, or shooting through the back wall), held LANDSCAPE and
STATIONARY, with the whole floor in frame. The user taps the four floor corners once per clip
so the app can build a court model. A camera that moves mid-match, or one placed at the front
wall, breaks that model. This is explained in the 5-page tutorial on first launch, and every
analysis ends with a footnote stating how much of the match the app could actually detect.

PERMISSIONS
Camera and microphone are requested when the user first taps record, or when the Referee
starts watching a court live. Audio matters because the analyser uses the sound of the ball
strike to find shots and rally boundaries; there is no speech recognition anywhere in the
app, and live camera frames are analysed in the moment, never saved. Photo library read
access is used only when the user picks a video to import; write access only on "Save to
Photos".

NETWORK NOTE (ATS)
The app allows plain-HTTP connections for one reason: the optional analysis server can be a
Mac on the user's own local network (http://<local-ip>:8082) or a self-hosted cloud
container. Account, billing, and subscription traffic is HTTPS (Supabase, RevenueCat).

FREE TIER AND SUBSCRIPTION
Recording, the library and the bundled demo analysis are always free, as are the user's first
3 analyses of their own videos. After that, starting a 4th analysis opens the paywall
(RacquetIQ Pro — monthly or annual auto-renewable). Subscribing is optional; nothing already
analysed is ever taken away.

SANDBOX ACCOUNT FOR TESTING THE SUBSCRIPTION
  Apple ID:  TODO_SANDBOX_APPLE_ID
  Password:  TODO_SANDBOX_PASSWORD
Sign in under Settings › Developer › Sandbox Apple Account before purchasing.

HOW TO REACH THE PAYWALL
The paywall opens from Library › "Import & analyze" once the 3 free analyses are used. Only a
completed analysis consumes one of the three — a clip the app cannot analyse costs nothing —
so please use the three sample squash clips supplied with this submission. Import all three,
then tap "Import & analyze" a fourth time and the paywall opens.

CONTACT
prokaranvir@gmail.com
```

### What the demo card does _not_ show

Worth knowing before a reviewer asks, because two of the App Store screenshots show features
the demo card cannot display:

The bundled demo (`src/features/analysis/demoAnalysis.ts`) is a **schemaVersion 1** analysis.
It has no pose `tracks`, no per-shot `type`, and no video file. So opening it shows rally
stats, placement, coverage and predictability — but **not** the match video, **not** the pose
skeleton overlay, and **not** the shot-type breakdown.

Screenshots `01-analysis-pose-overlay.png` and `02-shot-types-placement.png` were captured
from a **schemaVersion 2** analysis produced by the real pipeline and loaded into the app, not
from the demo card. The features are genuine and shipping, but a reviewer who taps the demo
card will not see them.

**Recommended fix before submitting:** upgrade the bundled demo to a schemaVersion 2 analysis
with `tracks`, per-shot `type` and a short bundled clip, so the demo card matches the
screenshots. That is app work, not listing work — flagged here, not done here. If it will not
make this build, the safer alternative is to drop those two screenshots and ship the
placement/coverage/predictability ones only.

---

## Before you submit

These are blockers, in the order they will bite.

### 1. In-app purchases are not configured — the paywall cannot be reviewed

`src/lib/subscription.ts` reads the RevenueCat key from `EXPO_PUBLIC_REVENUECAT_IOS_KEY` or
`extra.revenueCatIosKey`. **Neither is set** — `app.json` `extra` contains only `router` and
`eas`, and the env var appears nowhere in the repo.

With no key the chain is:

`readApiKey()` → `null` → `configure()` → `false` → entitlement `"unknown"` →
`canStartAnalysis()` returns `true` for everyone (the deliberate fail-open) → **the quota gate
never fires and the paywall is never reached.** The paywall itself, if opened, shows
"In-app purchases aren't available in this build yet. Nothing is locked."

A reviewer cannot buy the subscription, so the products stay in "Waiting for Review" and the
build is rejected under Guideline 2.1. **Set the key and verify a sandbox purchase end to end
before submitting.**

### 2. The paywall's Terms and Privacy links are dead

`src/lib/legalLinks.ts` has `TERMS_OF_USE.url = null` and `PRIVACY_POLICY.url = null`. The
paywall renders both rows struck through and inert, with the note "These pages go live before
the App Store release; the links are disabled until then."

Guideline 3.1.2 requires **functional** links to an EULA and a privacy policy on the
subscription screen. Shipping visibly disabled links is a direct rejection. The pages are
drafted in `docs/legal/`; GitHub Pages is not switched on yet.

### 3. Subscription prices are not set in App Store Connect

Known and expected — the Paid Applications Agreement is unsigned, so the pricing API rejects.
Until prices exist, the products cannot be submitted. The description in `store/listing.md`
states $9.99/month and $79.99/year to match `paywallCopy.ts`; **these three places must
agree** or it is a 3.1.2 rejection.

### 4. Library copy contradicts the privacy policy

The "Import & analyze" card reads _"Pick a match video from your library and send it to your
analysis server."_ (`src/features/recording/ImportAnalysisCard.tsx:87`). Analysis actually
runs **on device** by default; the server is a fallback. The privacy policy leads with
"Match analysis normally runs entirely on your phone."

This string is visible in `store/screenshots/04-library.png`. A reviewer comparing the
screenshot to the privacy policy has a fair question. Fixing the copy means recapturing that
one screenshot.

### 5. The reviewer needs sample clips, or they cannot reach the paywall

The paywall only appears after **three completed analyses of the user's own video**, and
`recordFreeAnalysisUsed()` is called only once an analysis is written to disk
(`useDeviceImportFlow.ts:117`) — so a clip the app fails to analyse does not consume the
allowance. A reviewer with no squash footage has no realistic route to the purchase screen.

The App Review notes above therefore promise **three sample squash clips**. You must actually
supply them: attach them in App Store Connect › App Review Information, or host them and put
the link in the notes. `analysis/samples/` has suitable footage, but those files are 37–54 MB
each — trim them to the shortest clip that still yields a full analysis.

If that is impractical, the alternative is a review-only route to the paywall — but that is
app work, and a hidden entry point needs to be explained in the notes or it looks like
concealed functionality.

### 6. Placeholders that must be resolved

| Placeholder                                        | Status                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Legal entity                                       | ✅ **Daybot Solutions Inc.** — set in the legal docs and `store/listing.md`               |
| Support email                                      | ✅ **prokaranvir@gmail.com** — set in the legal docs and the support page                 |
| Support / Privacy / Terms / Marketing URLs         | ✅ Live on Azure SWA — see `store/listing.md` › URLs (verified 2026-08-19)                |
| `TODO_SANDBOX_APPLE_ID` / `TODO_SANDBOX_PASSWORD`  | ⛔ **YOU must create** in App Store Connect › Users and Access › Sandbox, then paste here |
| Operator postal address (custom-EULA requirement)  | ⛔ **YOU must supply** — Daybot Solutions Inc.'s registered address; add to the Terms      |

Two items are genuinely yours and I have not touched them: the sandbox credentials (I do not create
accounts or enter credentials on your behalf) and the postal address (I will not invent an address
into a legal document). Everything else in this table is resolved in the repo.

---

## Screenshot inventory

`store/screenshots/`, all **1320 × 2868** (6.9" iPhone 16 Pro Max native — an accepted App
Store size, uploaded as-is with no scaling).

| File                                     | What it shows                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-analysis-pose-overlay.png`           | Match analysis top: the match video with pose skeletons drawn over both players (Player A green, Player B red), the "Play to see each shot classified as it happens" hint, rally stats (9 rallies · 36.6 avg shots/rally · 59 longest), and Player A's shot-type line — 81 drives · 44 cross-courts · 20 volleys · 7 drops · 3 serves · 1 boast |
| `02-shot-types-placement.png`            | The shot-type breakdown in full, with rally stat tiles above and Player A's four shot-placement quadrants below (11 front-left 7%, 15 front-right 10%, 66 back-left 42%, 64 back-right 41%)                                                                                                                                                     |
| `03-coverage-heatmap-predictability.png` | Player A's placement quadrants, the 12 × 8 court-coverage heatmap with the "Brighter = more time spent there" key, and the Predictability card — 25%, most common pattern "Back right -> Back right"                                                                                                                                            |
| `04-library.png`                         | The Library tab: the "Demo match analysis / Sample" card, the "Import & analyze" card, an imported analysis row, and the two-tab bar (Record, Library)                                                                                                                                                                                          |
| `05-tutorial.png`                        | Page 1 of 5 of the first-run tutorial, "What RacquetIQ does", listing the four things the app measures                                                                                                                                                                                                                                          |

### How these were captured

Honest account, because it affects how much they can be trusted:

- The already-booted simulator was an **iPhone 17**, which renders at 1206 × 2622 — **not** an
  accepted App Store size. I created and booted an **iPhone 16 Pro Max** (iOS 26.2) instead,
  which is natively 1320 × 2868. **No `sips` resizing was used**; every PNG is the simulator's
  own output at native resolution.
- The app is the existing **Debug** build from DerivedData, running against Metro. I attempted
  a Release build so the screenshots would carry no dev tooling, but it **filled the disk and
  failed** (see the disk warning below), so the Debug build was used.
- expo-dev-client draws a floating "Tools" button over every screen. Editing the preferences
  plist directly did nothing, because `cfprefsd` caches the domain; writing it through
  `xcrun simctl spawn <udid> defaults write com.racquetai.app
EXDevMenuShowFloatingActionButton -bool NO` while the app was terminated removed it. **All
  five screenshots are free of it** — verified by cropping the top-right corner of each.
- The status bar was pinned to the Apple-standard 9:41 with full signal and a full battery via
  `xcrun simctl status_bar override`.
- The data is **real pipeline output**, not mocked: `analysis/out/archive_match2_v2/analysis.json`
  (schemaVersion 2, 320 shots with types, pose tracks) and `analysis/samples/archive_match2.mp4`,
  injected into the app container as `imp-20260817-140000-d3m0.analysis.json` / `.video.mp4` /
  `.video.json` per the layout in `src/lib/importedAnalyses.ts` and `src/lib/analysisVideo.ts`.

The simulator was deleted afterwards to reclaim disk. Recapturing means recreating it, so
batch any copy fixes (item 4 above) before redoing screenshots.

> **Disk warning.** This Mac is at 100% — roughly 1.4 GB free of 460 GB after I cleaned up.
> My Release build attempt hit `ENOSPC` and briefly wedged the machine. Free up space before
> attempting an archive build for submission; an iOS archive needs several GB.
