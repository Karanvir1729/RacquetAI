# App Store listing — RacquetIQ

Copy-paste source for App Store Connect. Character limits are Apple's; the count after each
field is the actual length of the text below it (verified with `store/check-lengths.py`).

Everything here is written to be **true of the shipping app**: squash only, fixed camera,
after-the-fact analysis of a clip you already filmed. Nothing claims live tracking, ball
tracking, coaching advice, scoring, or any sport other than squash.

---

## App Name — 30 max

```
RacquetIQ: Squash Analysis
```

`26 characters.` Putting "Squash" in the name is worth more for search than keeping the name
bare. If you prefer clean branding, `RacquetIQ` (9) also works — then move `squash` into the
keyword field, which currently omits it because the name already covers it.

## Subtitle — 30 max

```
See how you actually played
```

`27 characters.`

## Promotional text — 170 max

Editable without a new build, so use it for whatever is currently true.

```
Film a squash match from the back of the court, import the clip, and see every shot placed, every metre covered, and how readable your patterns are.
```

`148 characters.`

## Keywords — 100 max, comma-separated, no spaces

```
racquet,court,coach,rally,drills,training,footwork,video,heatmap,drive,drop,boast,volley,tactics
```

`96 characters.`

Deliberate choices:

- **No `squash`, no `analysis`** — both already appear in the App Name, and Apple indexes the
  name. Repeating them wastes characters.
- **No spaces after commas** — a space costs a character and Apple does not need it.
- **Singular forms** where Apple stems anyway (`drill` vs `drills` — kept plural where the
  plural is the natural search term).
- **No competitor names and no `tennis`/`padel`/`badminton`.** The other sports were removed
  from this app on purpose; keywording them would draw installs the app cannot serve and is a
  metadata-rejection risk.

## Description — 4000 max

`2404 characters.`

```
RacquetIQ turns a video of your squash match into a clear picture of how you actually played.

Prop your phone up at the back of the court, film a match, then import the clip. RacquetIQ finds the rallies, counts the shots, works out where each one landed, tracks how much of the court each player covered, and measures how predictable their shot patterns were.

WHAT YOU GET

• Shot placement — every shot sorted into front left, front right, back left and back right, with counts and percentages
• Shot types — drives, cross-courts, drops, boasts, volleys and serves, counted for each player
• Court coverage — a heatmap of where each player spent their time, plus how often they got back to the T
• Predictability — a score, the shot-choice entropy behind it, and the single most repeated pattern
• Rally stats — number of rallies, average shots per rally, longest rally
• Video playback with a pose skeleton drawn over each player, and each shot named as it happens

HOW IT WORKS

Film from behind the court — the gallery, a balcony, or through the back wall. Landscape, propped on something solid, with the whole floor in frame. Import the clip and tap the four floor corners once so the app knows the court's geometry.

The analysis then runs on your phone. You do not need a signal at the club.

A REFEREE THAT CALLS THE SCORE

The Referee tab keeps a proper PAR-11 squash score and announces it out loud in the marker's convention. Tap who won each rally — or let it watch: live through the camera, or over a video you have analysed, where it plays the match, highlights both players, and calls each rally as the footage reaches it. Every call it makes is a suggestion you can beat or correct with one tap.

WHAT RACQUETIQ IS NOT

It is not a coach and it does not follow the ball. The analysis reports what it measured; the Referee keeps a PAR-11 score you can always correct — when it scores a rally itself it says so, tells you up front it gets roughly one rally in four wrong, and every call is one tap to fix. Nothing RacquetIQ produces is an official result. It is built for squash and nothing else.

THE FOOTAGE DECIDES THE QUALITY

The numbers are only as good as the camera. A phone that moves mid-match, or a view from the front of the court, breaks the court model. Every analysis tells you how much of the match the app could actually see, so you know how far to trust it.

FREE AND PRO

Recording, your library, the built-in demo analysis and your first three analyses are free.

RacquetIQ Pro removes the analysis limit:

• Monthly — $9.99 per month
• Annual — $79.99 per year

Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically at the same price and duration unless you cancel at least 24 hours before the end of the current period. Manage or cancel it any time in Settings › your name › Subscriptions.

Terms of Use (EULA): https://kind-sea-0e4afca0f.7.azurestaticapps.net/legal/terms-of-use
Privacy Policy: https://kind-sea-0e4afca0f.7.azurestaticapps.net/legal/privacy-policy
```

> **The two prices above are not yet set in App Store Connect.** They match
> `src/features/subscription/paywallCopy.ts` (`MONTHLY_PLAN` / `YEARLY_PLAN`), which is what
> the in-app paywall falls back to. Guideline 3.1.2 requires the description, the paywall and
> the App Store Connect product to agree. **Do not submit until the prices in App Store
> Connect match these two lines** — a mismatch is a straightforward rejection.

## What's New — 4000 max

For the first public version there is no "what's new" in the update sense; this is the
release-notes field for 1.0.

```
First public release.

Film a squash match from the back of the court, import the clip, and RacquetIQ measures it on your phone: shot placement, shot types, court coverage, time at the T, rally stats and how predictable your patterns are — with the match video played back under a pose skeleton.

Your first three analyses are free.
```

`332 characters.`

## URLs

| Field                             | Value                                                                   | Status                      |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| Support URL (**required**)        | `https://kind-sea-0e4afca0f.7.azurestaticapps.net/support`              | Live (verified 2026-08-19)  |
| Marketing URL (optional)          | `https://kind-sea-0e4afca0f.7.azurestaticapps.net/`                     | Live                        |
| Privacy Policy URL (**required**) | `https://kind-sea-0e4afca0f.7.azurestaticapps.net/legal/privacy-policy` | Live (verified 2026-08-19)  |

The legal pages ship as static HTML under `web/public/legal/` and the support page under
`web/public/support/`, published on Azure Static Web Apps (the same host as the marketing site).
The Terms live at `.../legal/terms-of-use`. `src/lib/legalLinks.ts` points the in-app links at the
same host. **Redeploy the web app after any legal-copy change** (`web/deploy-azure.sh`) so the live
URLs match the repo — the Privacy Policy URL above is the one Apple review opens.

## Other App Store Connect fields

| Field              | Suggested value                                                                       |
| ------------------ | ------------------------------------------------------------------------------------- |
| Primary category   | Sports                                                                                |
| Secondary category | Health & Fitness                                                                      |
| Age rating         | 4+ (no objectionable content; the app has no chat, no user-generated sharing, no ads) |
| Copyright          | `2026 Daybot Solutions Inc.`                                                          |
| Price tier         | Free (the app is free; Pro is an auto-renewable subscription)                         |

The legal entity is **Daybot Solutions Inc.**, matching `docs/legal/privacy-policy.md` and
`docs/legal/terms-of-use.md`.

## Screenshots

`store/screenshots/` — five PNGs, all 1320 × 2868 (6.9", iPhone 16 Pro Max native). See the
inventory in `store/review-notes.md`.
