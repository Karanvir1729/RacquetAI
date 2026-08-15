# 07 — App Store prep & submission runbook

**Status: not started.** RacquetAI is pre-1.0 and nothing below has been executed. This is the
plan, written now — while it is cheap — from the daybot mobile app's actual submission
experience: one guideline-4 rejection, a five-lens adversarial audit, and four separate
invisible blockers that the App Store Connect API described only as "not in valid state".

Every account-specific value is a `TODO_OPERATOR_*` placeholder. Items marked **[operator]**
require signing in as the Apple account holder, accepting legal agreements, handling
passwords, or creating accounts — none of which can or should be automated.

Work top to bottom: later sections genuinely depend on earlier ones.

---

## 1. Already handled in code

Verify these are still true before submitting; do not redo them.

- [x] Bundle identifier `com.racquetai.app`, scheme `racquetai://`, portrait-primary
- [x] `ios.supportsTablet: true` with the full `UISupportedInterfaceOrientations~ipad` array
      (ADR-002) — **this makes an iPad screenshot set mandatory, see §6**
- [x] `ITSAppUsesNonExemptEncryption: false` — standard HTTPS only, so **export compliance
      needs no uploaded documentation** and no per-build questionnaire answer
- [x] Permission purpose strings for camera, microphone, and photo-library-add, declared
      through the `expo-camera` / `expo-media-library` config plugins in `app.json`. They
      describe the actual use in plain language; reviewers read them and reject vague ones
- [x] `userInterfaceStyle: "automatic"` with a real light palette — a dark-only app that
      ignores the system setting reads as broken on a reviewer's light-mode device
- [x] No tracking SDKs, no ad SDKs, no analytics SDK in `package.json` (keep it that way, or
      §9 changes)
- [x] No purchase surface of any kind in the binary (see §11 before that changes)

---

## 2. Apple Developer & App Store Connect — setup order

Order matters. Each step below is blocked by the one above it. The dependency chain, so it is
obvious what a skipped step costs:

| # | Step | Blocks |
|---|---|---|
| 1 | Developer Program membership active | everything |
| 2 | Agreements accepted | submission |
| 3 | App ID registered | signing, EAS credentials |
| 4 | App Store Connect app record created | build upload, listing, App Privacy |
| 5 | `eas init` — EAS project linked | any build; anything project-id-gated |
| 6 | Signing credentials | production build |
| 7 | Production build (§4) | screenshots, TestFlight, upload |
| 8 | Screenshots from *that* build (§6) | listing completeness |
| 9 | Listing + the four §7 blockers | the Submit button |

**Do not capture screenshots before step 7** — they must come from a release build.

- [ ] **[operator] Apple Developer Program membership active.** Confirm it is not within a
      renewal window — an expired membership silently breaks signing.
- [ ] **[operator] Accept the Apple Developer Program License Agreement** and the
      **Free Apps Agreement** on the Business tab. daybot's Free Apps Agreement was active for
      a one-year term; a lapsed agreement blocks submission with an unhelpful error.
      *(The Paid Apps Agreement is a separate thing and is not needed for a free app — §11.)*
- [ ] **[operator] Register the App ID** `com.racquetai.app` in the Developer portal. Enable
      only the capabilities the binary actually uses. **v0 needs none of the optional ones** —
      no push, no Sign in with Apple, no App Groups. Enabling a capability you do not use
      produces entitlements that fail validation.
- [ ] **[operator] Create the App Store Connect app record**: name, primary language, bundle
      ID, SKU. Record the resulting `ascAppId` — it goes into `eas.json`'s submit block, or
      stays out of git and gets passed at upload time (§4).
- [ ] **[operator] `eas init`** in the repo root to link a real EAS project. Do this *before*
      anything that needs a project id. On daybot, an unlinked project silently gated off the
      push-token fetch — the code ran, returned nothing, and looked like a bug for a day.
      RacquetAI has no push, but EAS Updates and any future push have the same dependency.
      `eas init` writes `extra.eas.projectId` into `app.json`; decide deliberately whether that
      commit is acceptable (§6 of [02-daybot-infra-heritage.md](02-daybot-infra-heritage.md)).
- [ ] **[operator] Create an App Store Connect API key** (Issuer ID + Key ID + `.p8`). Store
      it in a mode-`0600` directory in `$HOME`, **never in the repo**. An API key means the
      whole pipeline runs without an Apple ID password anywhere.

---

## 3. Legal & support URLs — must resolve publicly

`src/app/settings.tsx` ships `Website`, `Privacy policy`, and `Contact support` rows with
`url: null`, rendering as "coming soon" so the app can never ship a dead link. Filling them is
a submission gate.

- [ ] **Privacy Policy URL** — a real, publicly reachable page. daybot's listing pointed at a
      URL that did not exist, and the site redirected every unmatched path to a **login wall**,
      so the reviewer would have hit a sign-in screen instead of a policy. **Open the URL in a
      private window before entering it anywhere.**
- [ ] **Terms of Use page** if the app links to one (required if any subscription ever lands).
- [ ] **Support URL and a monitored support inbox.** Reviewers email it. Use a domain and an
      inbox the operator controls and actually reads — daybot shipped with a support address on
      a *different* domain from the product, which is a credibility problem at best.
- [ ] Fill the three `LINKS` entries in `src/app/settings.tsx` with the live URLs and re-run
      the checks. A "coming soon" row is fine during development and a smell at submission.
- [ ] **Licenses / acknowledgements screen** — the Settings placeholder needs real third-party
      license text before 1.0.

---

## 4. Credentials, build, and upload

- [ ] **[operator] Distribution certificate + provisioning profile.** Either let EAS manage
      them (simplest) or generate locally and keep every artifact outside the repo. Note the
      certificate's expiry somewhere you will actually see it.
- [ ] **Build:** `eas build --platform ios --profile production`.
- [ ] **Shake out release-only failures with the `preview` profile first.** `__DEV__`-gated
      code, entitlements, and Hermes bytecode all behave differently from a dev client.
- [ ] **Verify the IPA before uploading.** Unpack it and confirm the entitlements are what you
      expect and `get-task-allow: false`. Entitlement mistakes fail *silently in release only*.
      Also confirm nothing you believe was removed is still in the bundle — the JS bundle is
      **Hermes bytecode, so `grep` finds nothing; use `strings -a`**. On daybot this caught
      dead purchase code that the review notes claimed was absent.
- [ ] **Upload.** `eas submit` is easiest but wants the ASC app ID and team ID in `eas.json`,
      i.e. in git. `xcrun altool --upload-app -f <ipa> -t ios --apiKey <KEY_ID> --apiIssuer
      <ISSUER_ID>` keeps every identifier out of the repo. Pick one and note the choice.
- [ ] Confirm the build reaches **VALID** in App Store Connect (processing takes minutes;
      an invalid build reports by email).

---

## 5. TestFlight

- [ ] Create an **internal** beta group and add the operator's Apple ID(s). Internal groups
      need **no Beta App Review**, so this is the fastest path to the app on a real device.
- [ ] Testers show as `NOT_INVITED` until they open TestFlight signed in with that Apple ID —
      normal, not a fault.
- [ ] Export compliance is pre-answered by `ITSAppUsesNonExemptEncryption: false`.
- [ ] Fill **"What to Test"**. Empty is harmless internally and required before any external
      group.
- [ ] **Run the full physical checklist from [05-testing.md](05-testing.md) on the TestFlight
      build**, especially recording, since the simulator cannot exercise the camera at all.

---

## 6. Screenshots — from a Release build only

- [ ] Capture from an `eas build --profile production` (or `preview`) **release** build.
      A development client paints a floating dev-menu bubble over the UI; those captures are
      internal references only and shipping them is a 2.3.3 rejection. The dev menu's Tools
      toggle needs a *slide*, not a tap.
- [ ] **iPhone 6.9"** — 1290×2796 or 1320×2868 portrait. Apple scales these down to every
      other iPhone size, so this is the only iPhone set required. Upload 5–10.
- [ ] **iPad 13"** — 2064×2752. **Mandatory because `supportsTablet` is true (ADR-002).**
      **An 11" iPad set is NOT an accepted substitute** — daybot learned this while fixing the
      iPad rejection, and it is the kind of thing that fails an upload at the last minute.
      Note that App Store Connect's device key for this slot still carries a legacy 12.9" name;
      the display size Apple actually wants is 13". Match the pixel dimensions, not the label.
- [ ] Screenshots must match what the app actually does on first launch. A shot of a state the
      reviewer cannot reach is its own 2.3.3 rejection.
- [ ] Suggested set for v0: (1) the record screen framed on a court; (2) mid-recording with the
      timer running; (3) the Library with several real recordings; (4) playback; (5) whatever
      Score AI honestly shows — **if scoring is not shipped in 1.0, do not screenshot it.**
      Showing unshipped functionality is a rejection, not marketing.

---

## 7. The four invisible submission blockers

daybot's 1.0 was code-complete, had a VALID build, a full listing, and screenshots — and could
not be submitted. The API returned only **"not in valid state"** for all of it. Four separate
required things were missing, none of them surfaced by the error, and only the App Store
Connect **web UI** revealed the last one. Do all four *before* you try to submit.

- [ ] **1. App Privacy questionnaire.** Defaults to unanswered, and the default is not
      "Data Not Collected" — you must file the answers explicitly. See §9.
- [ ] **2. Age rating questionnaire — all of it.** Apple periodically adds questions (daybot
      was blocked by newly-added social-media/UGC questions on an app that had previously
      passed the questionnaire). Re-open it and answer every question even if you answered the
      form months earlier. RacquetAI v0: expect a clean **4+** with everything answered *No* —
      **unless** sharing/social features land, which changes the answers and triggers §10.
- [ ] **3. App Availability.** The territory list is a distinct setup step that is easy to
      never notice. Set it explicitly (all territories, or a deliberate subset).
- [ ] **4. The `copyright` field.** Required, easy to miss, and empty by default. Format:
      `2026 TODO_OPERATOR_LEGAL_ENTITY`. daybot's submission was blocked on nothing else at the
      end and the API never named the field.

**Verify by reading remote state back, never by a dry run.** daybot's tooling had a `--show`
mode that queried Apple and a dry-run mode that merely echoed the current invocation's flags —
the dry run reported "no demo account configured" for an account Apple already had. Ask Apple
what it thinks; do not ask your own script what it intended.

---

## 8. App Review Information

- [ ] **Sign-in required: NO** for v0 — RacquetAI has no accounts. Say so explicitly in the
      notes so a reviewer does not go looking for a login.
- [ ] **When accounts do land**, pre-provision **at least two or three interchangeable demo
      accounts**. Reviewers test account deletion, and if deletion works properly it destroys
      the credentials you gave them; a second review pass with dead credentials is an automatic
      2.1 rejection. Seed each account so no tab shows an empty state — daybot's reviewer would
      otherwise have hit "nothing here yet" on three of five tabs.
      **[operator] creates these; automation must not create accounts or handle passwords.**
- [ ] Contact first/last name, phone, and a **monitored** email address.
- [ ] **Review notes — hard limit 4000 characters.** daybot's crept to 4269 and the upload
      simply failed. Count them before pasting.
- [ ] Notes should cover, for RacquetAI:
      - **What the app is**, in one paragraph: record a racquet-sport match on your phone,
        review the footage, keep it on-device.
      - **Camera and microphone are the core function.** Ask the reviewer to grant both when
        prompted; without camera access the primary screen is a permission prompt and nothing
        else. Say what happens if they decline (a clear explanatory state, not a dead end).
      - **Hardware note:** recording cannot be exercised in a simulator. If they test on a
        simulator the preview is black — that is the platform, not a bug.
      - **Where recordings go:** the app sandbox, optionally exported to Photos with the user's
        permission. Nothing is uploaded. No account, no server.
      - **Photo library permission** is add-only and used solely for that export.
      - **AI scoring status** — describe exactly what ships. If it is not in the binary, do not
        mention it as a feature; if it is, say where the processing happens (on-device vs
        server) because that determines the privacy answers.
      - **No purchases** in the binary, no external purchase links (until §11 changes this).

---

## 9. App Privacy

- [ ] File the questionnaire explicitly (blocker #1 in §7).
- [ ] **Data that never leaves the device is not "collected"** under Apple's definition. For a
      v0 with no accounts, no backend, no analytics and no crash SDK, **"Data Not Collected"
      is likely accurate** — but assert it only after checking the dependency list and every
      network call in the codebase. daybot's default answer was factually wrong and had to be
      replaced with seven declared types; the audit that caught it read the code, not the docs.
- [ ] **Used for Tracking: No.** True only while there is no ad SDK and no cross-app
      identifier. No ATT prompt is needed in that state.
- [ ] **Re-file the moment any of these land**, each of which changes the answers:
      - a backend or accounts → Contact Info (Email, Name), Identifiers (User ID)
      - crash reporting or analytics → Diagnostics / Usage Data
      - push notifications → Identifiers (Device ID)
      - **server-side AI scoring → User Content**, because the match video leaves the device.
        This is the single most consequential future change to this section: it converts a
        "collects nothing" app into one that uploads video of identifiable people.
- [ ] Whatever is declared here must match the privacy policy text (§3) word for intent.

---

## 10. Guideline landmines, mapped to RacquetAI

Each of these cost daybot real time. They are listed as *future* triggers because v0 mostly
sidesteps them — which is exactly why they are easy to walk into later.

- [ ] **Guideline 4 — iPad layout.** Already answered by ADR-002 and `layout.ts`. Keep every
      new screen on `Screen` / `column()`, and give each UI change an iPad simulator pass.
      This is the one that actually rejected daybot.
- [ ] **Guideline 5.1.1 — permissions.** This is RacquetAI's largest review surface and the one
      with no inherited experience behind it: daybot used no permission APIs at all, so nothing
      in its history covers this. Four rules:
      - **Purpose strings describe the real use, in the user's terms.** Generic phrasing
        ("This app needs camera access") is a rejection. Ours are set through the config-plugin
        blocks in `app.json` — never by hand-editing a plist, because `ios/` is regenerated
        (ADR-004) and a hand edit vanishes at the next prebuild.
      - **Ask in context**, at the moment the user taps record — not at cold launch.
      - **Denial is a real state.** A clear explanation plus a route to Settings, never a frozen
        or blank screen. A reviewer who denies the prompt and hits a dead end files a 2.1.
      - **Keep photo-library access add-only.** Do not request read access unless a feature
        genuinely reads the library; add-only is a weaker prompt *and* a weaker privacy answer.
        Requesting a permission the app does not visibly need is itself a rejection.
- [ ] **Guideline 5.1.1(v) — account deletion.** *Only when accounts exist:* the app must offer
      in-app deletion that genuinely deletes. daybot's "deletion" left the account restorable
      via OAuth, left public content live, and orphaned device tokens. If Sign in with Apple is
      ever offered, deletion must also **revoke the Apple token server-side** — which requires
      capturing the authorization code at sign-in, so the client has to be built for it from
      the start.
- [ ] **Guideline 4.8 — Sign in with Apple.** *Only when a third-party login is offered:* if
      you add Google (or similar) sign-in, an equivalent privacy-preserving login becomes
      mandatory on iOS. Plan them as one piece of work, never sequentially.
- [ ] **Guideline 1.2 — user-generated content.** *Only if sharing lands:* match videos are
      recordings of identifiable people. Public sharing pulls in a content filter, a report
      mechanism, a block mechanism, and published contact info — plus it changes the age-rating
      answers (§7 blocker #2). daybot had to add a "Report a problem" affordance for exactly
      this reason.
- [ ] **Guideline 2.1 — completeness.** No placeholder screens, no "coming soon" rows, no dead
      links in a submitted build. The Settings pending rows and the licenses placeholder are
      the known offenders (§3).
- [ ] **Guideline 3.1.1 — purchases.** See §11. The short version: **any payment for in-app
      digital functionality must go through StoreKit.** An external checkout link is a
      rejection, and it is the guideline daybot got burned by. Note that "a reviewer did not
      flag it last time" does not mean it is cleared — reviewers stop at the first blocker.

---

## 11. If and when RacquetAI monetizes (IAP sequencing)

Do not start any of this until the product decision is real. When it is, **this order is
forced** — daybot's 1.1 stalled for weeks by discovering it out of order.

1. **[operator] Update the legal entity in App Store Connect if Apple asks.** Apple gated the
   Paid Apps Agreement behind it, and no amount of engineering moves that.
2. **[operator] Sign the Paid Apps Agreement** — banking and tax details. This is a
   multi-day-to-weeks legal/finance step, not a form. **Nothing IAP-shaped can exist until it
   is Active**, including the products themselves.
3. **Create the subscription / product records in App Store Connect.** They must exist before
   StoreKit can fetch them; a client paywall built against nonexistent products shows an empty
   list and looks broken.
4. **Build the client paywall behind a kill switch**, flag-off by default, so an unfinished
   purchase surface can never reach a submitted binary. daybot deliberately shipped 1.0 with no
   paywall in the binary at all and kept the backend bridge deployed flag-off.
5. **Never declare an IAP record with no StoreKit code in the binary** — a declared purchase
   with nothing behind it is its own rejection, and so is the reverse.
6. Decide **StoreKit 2 direct vs. a wrapper (RevenueCat)** before writing the paywall, and
   write it up as an ADR. If purchases are ever verified server-side, verify the signed
   transaction against Apple's pinned root and tie each purchase to an app account token so
   entitlements cannot be replayed across users.

---

## 12. Pre-submit final pass

- [ ] All three checks green on a clean checkout: `npm run typecheck`, `npm run lint`,
      `npm test`.
- [ ] Full physical pass on a real iPhone, logged: cold start, permission grant **and denial**
      paths, record, stop, playback, export to Photos, background/foreground mid-recording,
      low-storage behaviour.
- [ ] iPad pass on the same build — layout, both orientations, Split View.
- [ ] Light mode and dark mode on both devices.
- [ ] Every URL in Settings opens a live page from a device that has never signed in anywhere.
- [ ] Screenshots match the submitted build (§6).
- [ ] Review notes under 4000 characters (§8).
- [ ] All four §7 blockers cleared, verified by reading remote state back.
- [ ] Version and build number are what you think they are (`appVersionSource: "remote"` means
      EAS owns the build number — check what it actually assigned).
- [ ] Release type chosen deliberately: automatic on approval, or manual.

---

## 13. After submitting

- [ ] Watch the Resolution Center and answer fast — a reply within hours can save a full review
      cycle.
- [ ] Keep anything the reviewer touches stable during review. If a backend ever exists, freeze
      deploys until the verdict lands.
- [ ] Expect App Store **search** to lag release by 24–48h; the direct product URL works
      immediately. Do not debug a "missing" app during that window.
- [ ] **Rotate anything that passed through a terminal, a transcript, or a chat** while getting
      here: demo-account passwords, API keys, signing keys. Assume exposure; rotation is cheap.
- [ ] Delete any throwaway accounts created during debugging.
- [ ] Write the retro into [06-decisions.md](06-decisions.md) as an ADR if anything here turned
      out to be wrong — that is exactly how this document came to exist.

---

## 14. If it gets rejected

It happened to daybot on its first submission and it is a normal cost, not a catastrophe. What
matters is not burning a second cycle.

- [ ] **Read the cited guideline itself**, not the summary in the notification. The number is
      the only precise part of the message.
- [ ] **Assume the citation is a lower bound.** Reviewers stop at the first blocker, so a
      one-line rejection can be hiding several violations. daybot's second attempt bundled a
      full guideline audit alongside the actual fix and turned up unrelated problems that would
      have caused a third round-trip — including a promo-code surface that unlocked a paid tier
      without StoreKit.
- [ ] **"The last reviewer did not flag it" is not a clearance.** Nothing is grandfathered.
- [ ] Reproduce the reviewer's exact conditions before believing you have fixed it — the right
      device class, a clean install, permissions in their initial state, no developer tooling
      attached.
- [ ] Fix in the binary, then **update the review notes** to say what changed and where to look.
- [ ] Reply in Resolution Center the same day. Review turnaround is the scarce resource here,
      not engineering time.
