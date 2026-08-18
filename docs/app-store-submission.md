# App Store submission — RacquetIQ 1.0 (subscription release)

**Status: not started.** This is the ordered list of everything still required to submit RacquetIQ
**1.0 as a paid-subscription app**. It assumes the app record already exists
(`ascAppId 6802102279`, bundle `com.racquetai.app`) and that TestFlight has been used, which is true
today.

It is the sequel to [07-app-store-prep.md](07-app-store-prep.md), which covers the *free* v0
submission mechanics (credentials, EAS, the four invisible blockers, guideline landmines). **Read
that one too** — everything in it still applies. This document adds what changes when money is
involved and does not repeat what is already there.

Items marked **[operator]** require a human signed in as the account holder: legal agreements,
banking, tax forms, passwords. They cannot and must not be automated.

---

## 0. Blockers that are not checklist items

These four will stop the release regardless of how complete the paperwork is. Deal with them first,
because two of them need someone else's calendar.

### 0.1 🚨 The bundled demo analysis is CC BY-NC and cannot ship in a paid app

`src/features/analysis/demoAnalysis.ts` is real pipeline output derived from an archive.org club
match released under **CC BY-NC 4.0**. The **NC** is Non-Commercial. A paid subscription app is
commercial use, and the demo analysis is a derivative of that footage — so is any App Store
screenshot of the demo analysis screen. Shipping it in 1.0 is a licence breach, not a grey area.
This does not become safe by removing the credit; it becomes safe only by changing the footage.

**What has to happen:**

1. Get footage you may use commercially. In order of realism:
   - **Film a match yourself** at a club, with the players' **written** permission covering
     commercial use of the derived data. Cheapest and cleanest.
   - **Footage from the UofT coach's shared Drive** — usable only with explicit written permission
     from the rights holder covering commercial use. A verbal "sure, use it" is not enough here.
   - Licensed stock footage whose licence permits commercial use.
2. Meet the pipeline's requirements or the demo will look worse than the product is: **≥5 minutes of
   real rallies, filmed from the back of the court, whole floor and all four floor corners in frame,
   phone static, audio track present, both players visible.**
   *(The Pexels squash clip already in `analysis/samples/` is not a substitute: 7.5 seconds, no audio
   track, 7 detected shots. It would produce an empty-looking demo.)*
3. Re-run `analysis/analyze.py` on the new clip, regenerate `demoAnalysis.ts` from the output, and
   update its `video.source` / `video.license` strings and the header comment.
4. Delete or clearly quarantine the CC BY-NC sample outputs under `analysis/out/` and
   `analysis/samples/` so the old data cannot be regenerated into a shipping build by accident.
5. Re-take every screenshot that shows the demo analysis (§7).

**Blocks:** §7 screenshots, §9 review notes (which tell the reviewer to open the demo), and the
build itself.

### 0.2 [operator] The Paid Applications Agreement is the long pole

The two subscription products exist in App Store Connect but are in **MISSING_METADATA**, and
nothing about them can be finished — let alone sold — until the Paid Applications Agreement is
**Active**. That means banking details, tax forms, and a legal entity Apple accepts. It is a
multi-day to multi-week step and it is entirely human. Start it today; do everything else in
parallel. See §1.

### 0.3 The analysis-server fallback uploads video over plain HTTP

`DEFAULT_SERVER_BASE_URL` is `http://racquetiq-a7682a.eastus.azurecontainer.io:8082`, and `app.json`
sets `NSAppTransportSecurity.NSAllowsArbitraryLoads: true` to allow it. When that fallback runs, a
video of identifiable people crosses the network unencrypted. Separately, that server keeps every
uploaded video indefinitely — there is no cleanup code in `analysis/server.py`.

Two details that make this worse than it reads, both now stated in Privacy Policy §3:

- **It is the full-size original that goes over the wire.** `compressForUpload`
  (`features/analysis/deviceClient.ts`) does the ~960×540 export *through the native analyzer* and
  returns the untouched original URI when that module is unavailable — which is exactly the condition
  that routes the import to the server in the first place. So on the only path that reaches the
  server, there is no compression: full resolution, full length, full audio.
- **The upload carries the video's filename** in `X-Filename` (`importClient.ts`), and the server
  stores it in the job record (`sourceName` in `analysis/server.py`). Camera-roll names are usually
  innocuous; user-renamed files are not always.

Three defensible outcomes; pick one deliberately before submitting:

- **Put the server behind HTTPS**, drop `NSAllowsArbitraryLoads`, add a retention/cleanup job — then
  delete the corresponding paragraphs from the Privacy Policy.
- **Remove the server fallback from the shipped build** (device-only analysis). This is the option
  that makes the App Privacy answers simplest — see §5 — and removes ATS from the review surface.
- **Ship as-is and disclose it**, which is what the Privacy Policy currently does. Least work, worst
  story if anyone reads carefully.

Note `ITSAppUsesNonExemptEncryption: false` stays correct either way (standard HTTPS/none is exempt),
but leaving `NSAllowsArbitraryLoads` on in a submitted binary occasionally draws a reviewer question.

### 0.4 The paywall must carry things that do not exist in the app yet

Guideline 3.1.2 requires that the purchase screen itself shows: the subscription **title**, its
**length**, its **price per period**, what it unlocks, plus **tappable links to the Terms of Use and
the Privacy Policy**, plus a **Restore Purchases** control. RacquetIQ has no Settings tab any more,
so the paywall is the only place these can live.

`src/features/subscription/paywallCopy.ts` already carries the prices and period labels, and
`src/lib/legalLinks.ts` holds the two legal URLs — **both are `null` today**, which the paywall
renders as a visibly disabled row. Publish the pages (§4), paste the URLs into `legalLinks.ts`, and
verify all six items on the built screen **before** capturing screenshots.

### 0.5 Version number

`app.json` still says `"version": "0.1.0"`. Ship 1.0 as `1.0.0`. EAS owns the build number
(`appVersionSource: "remote"`); confirm what it actually assigned rather than assuming.

---

## 1. [operator] Paid Applications Agreement

- [ ] App Store Connect → **Business** (Agreements, Tax, and Banking).
- [ ] Confirm the **legal entity** on the account is the one that will sell the app, and that it
      matches `TODO_OPERATOR_LEGAL_ENTITY` in the legal documents. Apple has gated this agreement
      behind an entity update before.
- [ ] Accept the **Paid Applications Agreement**.
- [ ] Add **Bank account** details (Payments and Financial Reports).
- [ ] Complete **Tax forms** — for a Canadian seller that is typically a W-8BEN/W-8BEN-E for U.S.
      tax, plus the tax residency and other regional forms Apple requests. Apple asks for a
      different set per territory; complete every one it lists or the agreement stays Pending.
- [ ] Confirm the agreement shows **Active**, not "Pending User Info". Products cannot be sold until
      it does.
- [ ] Set the Financial and Legal **contact roles** — a missing role silently holds the agreement.

## 2. Subscription product metadata (both products are in MISSING_METADATA)

Group **"RacquetIQ Pro"** (id `22316619`) already exists, with:

| Product ID | Plan | Price |
|---|---|---|
| `racquetiq_pro_monthly` | 1 month | US$9.99 |
| `racquetiq_pro_yearly` | 1 year | US$79.99 |

For **each** product, App Store Connect → Monetization → Subscriptions → RacquetIQ Pro:

- [ ] **Reference Name** (internal, ≤64 chars, never shown to users) — e.g. `RacquetIQ Pro Monthly`.
- [ ] **Duration** — 1 Month / 1 Year. Cannot be changed after the product is approved.
- [ ] **🚨 Subscription Prices** — this is the field that keeps them in MISSING_METADATA. Pick
      **US$9.99** and **US$79.99** as the base price; Apple generates every other territory's price
      automatically. Review the generated table before saving, and set the start date.
- [ ] **Localizations (English (U.S.) at minimum)**:
      - **Subscription Display Name** — shown in the purchase sheet and in the user's Subscriptions
        list. Short (~30 chars): `RacquetIQ Pro Monthly` / `RacquetIQ Pro Yearly`.
      - **Description** — ~45 chars, e.g. `Unlimited match analyses. Billed monthly.` /
        `Unlimited match analyses. Best value.`
- [ ] **Review Screenshot** — required per product, and a common cause of "Missing Metadata"
      surviving after pricing is set. Upload a screenshot **of the app's own paywall** showing that
      product. It is not shown to users.
- [ ] **Review Notes** (per product, optional) — one line: "Reached from Library → Import & analyze
      after three free analyses."
- [ ] **Availability** — territories. Match the app's availability (§8).
- [ ] **Tax Category** — leave the default App Store software category unless advised otherwise.
- [ ] **Family Sharing** — decide deliberately. Off is the simplest default; turning it on later is
      easy, turning it off later disrupts existing subscribers.
- [ ] **Subscription group level / ranking** — put **Yearly above Monthly** in the group so moving
      monthly → yearly is treated as an upgrade (immediate) rather than a crossgrade.
- [ ] **Group localization** — the group's own display name ("RacquetIQ Pro") and, if you use one,
      the group's app-name-override. Users see this in Settings → Subscriptions.
- [ ] Both products reach **Ready to Submit**.

### 2b. RevenueCat wiring (needs App Store Connect access)

- [ ] Create the RevenueCat account and project; add the iOS app with bundle id `com.racquetai.app`.
- [ ] Generate an **In-App Purchase Key** (.p8) in App Store Connect → Users and Access → Integrations
      → In-App Purchase, and upload it to RevenueCat. (RevenueCat also accepts the app-specific
      shared secret; the IAP key is the current path.)
- [ ] Point App Store Connect's **App Store Server Notifications V2** URL at the RevenueCat endpoint
      shown in the RevenueCat dashboard — this is how renewals and cancellations reach the app.
- [ ] Create entitlement **`pro`**, attach both products to it, and create an Offering containing
      both packages.
- [ ] Put the RevenueCat **public iOS SDK key** into the app config
      (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `expo-constants` extra) and rebuild. Until it is set the
      app runs unconfigured and — by design — does not paywall anyone.
- [ ] **[operator] Sandbox test account**: Users and Access → Sandbox → Test Accounts. Test buy,
      cancel, restore, and expiry on a real device. Sandbox renewals are accelerated (1 month ≈ 5
      minutes, 1 year ≈ 1 hour), so an expiry cycle is testable in an afternoon.

## 3. Attach the subscriptions to the version

- [ ] In the **1.0 version page**, under *In-App Purchases and Subscriptions*, **select both
      products**. First-time subscription products must be submitted **together with** the app
      version; leaving them unselected ships an app whose paywall shows nothing.
- [ ] Never declare a product with no StoreKit code in the binary, or ship purchase code with no
      declared product. Both directions are rejections.

## 4. Legal and support URLs live

- [ ] Publish the Privacy Policy and Terms of Use — see **[legal/README.md](legal/README.md)** for
      the GitHub Pages route, the exact ASC fields, and the placeholder list.
- [ ] Paste the Terms text into **App Information → License Agreement** (custom EULA) — the custom
      EULA in `docs/legal/terms-of-use.md` already contains Apple's required minimum terms
      (Apple not a party, scope of licence, maintenance/support, warranty and Apple's refund
      obligation, product claims, IP claims, legal compliance, third-party beneficiary).
- [ ] **Support URL** resolving publicly, and an inbox someone reads.
- [ ] Open every URL in a private window before entering it in App Store Connect.

## 5. App Privacy questionnaire

Defaults to unanswered, and unanswered blocks submission. The answers below follow directly from
`docs/legal/privacy-policy.md`; if you change one, change the other.

**Answer "Yes, we collect data", then declare:**

| Category → Data type | Collected | Linked to identity | Used for tracking | Purpose | Why |
|---|---|---|---|---|---|
| Purchases → **Purchase History** | Yes | **No** | No | App Functionality | RevenueCat receives the App Store transaction to decide entitlement — Privacy Policy §6 |
| Identifiers → **User ID** | Yes | **No** | No | App Functionality | RevenueCat's randomly generated anonymous app user id — Privacy Policy §6 |
| Identifiers → **Device ID** | Yes | **No** | No | App Functionality | The RevenueCat SDK collects the vendor identifier (IDFV) by default — **disclosed in Privacy Policy §6**; the two documents agree, keep them that way |
| User Content → **Photos or Videos** | **Yes** (the fallback is in this binary) | No | No | App Functionality | The fallback uploads the match video — the *full-size original*, see §0.3 — to our server |
| User Content → **Audio Data** | **Yes** (the fallback is in this binary) | No | No | App Functionality | The uploaded video carries its audio track, which the analysis uses |

**Declare nothing else.** Specifically:

- **Diagnostics / Crash Data — not collected.** `src/lib/crashGuard.ts` writes the crash message to a
  file inside the app sandbox and shows it to the user on next launch. It is never transmitted, and
  data that never leaves the device is not "collected" under Apple's definition.
- **Contact Info, Health, Location, Contacts, Search History, Browsing History, Sensitive Info —
  none.** The app has no accounts and asks for none of it.
- **Recordings and analyses that stay on the device are not collected**, which is why the User
  Content rows exist only because of the server fallback (§0.3). The fallback **is compiled into the
  binary you are submitting** and fires without asking the user, so those rows are **Yes** today.
  **If you remove the fallback, remove those two rows and the app collects only purchase data.**
- **The upload also carries the video's filename** (`X-Filename`, retained server-side as the job's
  `sourceName`). Apple has no data type for it; it is disclosed in Privacy Policy §3, which is where
  it belongs. Do not let it fall out of the policy if the header ever changes.
- [ ] **Tracking: No.** No ad SDK, no cross-app identifier, no data shared with data brokers →
      **no ATT prompt is required**, and adding one would itself be a problem.
- [ ] Verify the current RevenueCat App Privacy guidance before filing — their SDK's collected fields
      change between major versions and their docs publish the exact rows to declare.
- [ ] Re-file the questionnaire whenever analytics, accounts, sharing, or push land.

## 6. Age rating

- [ ] Re-open the questionnaire and answer **every** question, even if it was answered before — Apple
      adds questions (a previously-passing app was blocked by newly added social/UGC questions).
- [ ] Expected result: **4+**, everything No. RacquetIQ has no UGC sharing, no web view, no contests,
      no gambling, no user communication.
- [ ] If sharing features are ever added, this answer changes and Guideline 1.2 applies.

## 7. Screenshots — from a release build only

Rules unchanged from [07-app-store-prep.md](07-app-store-prep.md) §6; what changes for 1.0:

- [ ] **iPhone 6.9"** — 1290×2796 or 1320×2868, 5–10 shots. Required.
- [ ] **iPad 13"** — 2064×2752. **Mandatory** because `ios.supportsTablet` is true. An 11" set is not
      an accepted substitute.
- [ ] Capture from an `eas build --profile production` (or `preview`) build. A dev client paints a
      floating menu bubble over the UI and shipping that is a 2.3.3 rejection.
- [ ] **Every analysis screenshot must come from the replacement demo footage (§0.1)**, not the
      CC BY-NC match.
- [ ] Suggested set: (1) Record screen framed on a court; (2) Library with real recordings; (3) the
      corner-tap step of an import; (4) analysis — placement + coverage; (5) analysis —
      predictability + shot types; (6) the paywall, if you screenshot it, exactly as it appears.
- [ ] Do not screenshot anything a first-launch user cannot reach.

## 8. Listing text

| Field | Limit | Notes |
|---|---|---|
| App Name | 30 | `RacquetIQ` |
| Subtitle | 30 | e.g. `Squash match analysis` |
| Keywords | 100 total | comma-separated, **no spaces after commas** (they consume characters); do not repeat words already in the name/subtitle |
| Promotional Text | 170 | editable without a new build |
| Description | 4000 | **must include** the subscription title, length, and price, plus working links to the Terms of Use and Privacy Policy |
| What's New | 4000 | required for updates |
| Copyright | — | `2026 TODO_OPERATOR_LEGAL_ENTITY` — required, empty by default, and blocks submission with an unhelpful error |
| Primary category | — | Sports (Health & Fitness as secondary is defensible) |
| App Availability | — | a separate, easily missed setup step — set territories explicitly |

Description must be honest about accuracy: analysis quality depends on camera placement. Overclaiming
here is what turns an ordinary review into a 2.3.1 "app does not perform as advertised".

## 9. App Review Information

- [ ] **Sign-in required: No.** Say it explicitly.
- [ ] Contact first/last name, phone, monitored email.
- [ ] Notes: **hard limit 4000 characters** — count before pasting.

Draft notes (2,054 characters as written — recount after editing; the limit is 4,000):

> RacquetIQ analyses squash match video and reports shot placement, court coverage, time at the T,
> shot types and a predictability score.
>
> NO ACCOUNT. There is no sign-in anywhere in the app; nothing to log into.
>
> HOW TO EVALUATE THE ANALYSIS — PLEASE READ. Analysis quality depends almost entirely on how the
> match was filmed: the camera must be at the back of the court, static, landscape, with the whole
> floor and all four floor corners in frame, and several minutes of real rallies. A clip filmed by
> hand, from the side, or a few seconds long will produce a poor or empty analysis. That is the
> nature of the measurement, not a defect.
>
> To see the feature working as intended, open the app and tap "Demo match analysis" on the Library
> tab. It is a full analysis of a real club match and is available immediately, with no purchase and
> no import.
>
> TO TEST THE IMPORT FLOW: Library → "Import & analyze" → pick a video → tap the four floor corners
> when asked → the analysis runs ON DEVICE (no network needed) and takes a couple of minutes for a
> six-minute match. Your first three analyses are free, so this can be tested without purchasing.
>
> SUBSCRIPTION: after three free analyses, further analyses of your own videos require RacquetIQ Pro
> (US$9.99/month or US$79.99/year, auto-renewable). Recording, the library, existing analyses and
> the demo analysis all stay free. The paywall shows price, duration, Restore Purchases, and links
> to our Terms of Use and Privacy Policy.
>
> PERMISSIONS: camera and microphone are the core function — please grant both when prompted, or the
> Record tab shows only an explanatory permission state. Audio is used to detect ball strikes.
> Photo-library access is add-only and used only when the user taps "Save to Photos". Video picking
> uses the system picker and needs no library permission.
>
> HARDWARE: recording cannot be exercised in the simulator — the camera preview is black there. That
> is the platform, not a bug. Please test on a device.
>
> PRIVACY: recordings and analyses stay in the app sandbox. Analysis runs on device.

- [ ] If the server fallback ships (§0.3), add one honest sentence: analysis falls back to uploading
      the clip to our server when the on-device analyser is unavailable, as described in the privacy
      policy.
- [ ] Attach a demo video of the flow if the reviewer is unlikely to have squash footage — an
      "App Review Attachment" is allowed and often shortcuts a rejection.

## 10. Build and upload

- [ ] `app.json` version → `1.0.0` (§0.5).
- [ ] RevenueCat key present in the build config; entitlement `pro` live in the dashboard.
- [ ] `eas build --platform ios --profile production`.
- [ ] Verify the IPA before uploading: entitlements as expected, `get-task-allow: false`. Remember
      the JS bundle is Hermes bytecode — `grep` finds nothing, use `strings -a`.
- [ ] `eas submit` (ascAppId `6802102279` is already in `eas.json`) or
      `xcrun altool --upload-app` with an ASC API key.
- [ ] Build reaches **VALID**.
- [ ] Run the release build on a real device: buy in sandbox, restore, and confirm the free-analysis
      counter behaves — including the unconfigured-RevenueCat path, which must never paywall anyone.

## 11. Pre-submit final pass

- [ ] `npx tsc --noEmit`, `npx jest`, `npx eslint .` all clean on a fresh checkout.
- [ ] §0.1 demo footage replaced, and no CC BY-NC-derived data or screenshot anywhere in the
      submission.
- [ ] Paid Applications Agreement **Active**; both products **Ready to Submit** and attached to the
      version (§3).
- [ ] App Privacy filed (§5); Age rating fully answered (§6); App Availability set (§8);
      Copyright field filled (§8) — these four are the classic invisible blockers.
- [ ] Privacy Policy, Terms, and Support URLs all open in a signed-out private window.
- [ ] Paywall shows title, length, price, Restore Purchases, and both legal links (§0.4).
- [ ] Physical pass on iPhone **and** iPad, light and dark mode: permission grant *and denial*,
      record, playback, export to Photos, import + analyse, the free-limit boundary (3rd → 4th
      analysis), purchase, restore.
- [ ] Review notes under 4000 characters.
- [ ] Verify remote state by reading it back from App Store Connect, never from a local dry run.

## 12. After submitting

Unchanged from [07-app-store-prep.md](07-app-store-prep.md) §13–14: watch Resolution Center, reply
the same day, read the cited guideline itself, and treat any citation as a lower bound. One addition
for a paid app: **do not change subscription prices or product availability while the version is in
review** — a product that moves state mid-review can invalidate the submission.
