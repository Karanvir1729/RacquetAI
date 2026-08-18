# App Privacy questionnaire — RacquetIQ

The exact selections to make in App Store Connect › App Privacy, derived from
`docs/legal/privacy-policy.md` (last updated 18 August 2026) and checked against the source.

Where the policy and the code disagree, I have **flagged it rather than guessed** — see
[Disagreements](#disagreements-found-between-the-policy-and-the-code) at the end. Two of those
change what you should tick, so read that section before filling the form.

---

## Summary

| Question                                   | Answer                                              |
| ------------------------------------------ | --------------------------------------------------- |
| Do you collect data from this app?         | **Yes**                                             |
| Is any data used to track you?             | **No** — no ATT prompt, no ad SDK, no analytics SDK |
| Is any data linked to the user's identity? | **No** — there are no accounts                      |

Four data types are collected. Everything else is **Not Collected**.

---

## 1. Purchases → Purchase History

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ the RevenueCat SDK sends the App Store transaction/receipt information for a purchase
so the app can tell whether RacquetIQ Pro is active (policy §6). There are no accounts, so it
cannot be linked to a person. Do **not** also tick Analytics — aggregate subscription totals
in the RevenueCat dashboard are a by-product of running the subscription, not a separate
analytics purpose.

## 2. Identifiers → Device ID

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ the RevenueCat SDK collects the device's vendor identifier (IDFV) by default. Policy §6
commits to declaring exactly this: _"it is a device identifier, so we declare it, both here and
in the App Store 'App Privacy' label under Identifiers → Device ID."_ It is not the advertising
identifier and is not used to track.

## 3. Identifiers → User ID

**Collect: Yes** — but this one is a judgment call, see below.

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ policy §6 says the SDK _"generates a random anonymous user identifier and sends it"_.
Apple's "User ID" type covers an assigned account or user ID, and RevenueCat's anonymous app
user ID is exactly that — an identifier assigned to the install and transmitted off device.

_The judgment call:_ the identifier is random, generated on device, tied to no person, and
regenerated on reinstall, so a reasonable person could argue it is not a "User ID" in Apple's
sense. **I recommend declaring it.** Under-declaring is the expensive mistake — Apple rejects
for a missing type, not for a conservative extra one — and the policy already tells users an
identifier is sent. If you disagree, the policy text supports leaving it off; make the call
deliberately rather than by omission.

## 4. User Content → Photos or Videos

**Collect: Yes.** This is the one people get wrong.

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ analysis normally runs on device and uploads nothing. But when the on-device analyser
cannot run, the app falls back to uploading the video to the analysis server (policy §3), and
the server **retains** the video with no automatic expiry. Apple's definition of "collect" is
transmitting off device in a way that makes it accessible beyond the current session — that is
met.

**This is not hypothetical, and I checked:** `DEFAULT_SERVER_BASE_URL` in
`src/features/analysis/jobContract.ts:27` is
`http://racquetiq-a7682a.eastus.azurecontainer.io:8082` — a live host, baked into the binary.
A released build with no config file will use it. `resolveBackend()` in
`src/features/analysis/backend.ts` routes to `"server"` whenever the native module fails to
load. So the path is reachable by any user whose device cannot run the on-device analyser, and
the type **must** be declared.

### 4b. User Content → Audio Data

**Collect: Yes**, same four answers as above.

_Why:_ the uploaded file is the original recording **including its audio track**, and the
server extracts an audio track from it (policy §3). Apple treats recordings the user creates
as Audio Data. There is no speech recognition anywhere — that affects the _purpose_, not
whether it is collected.

### 4c. User Content → Other User Content

**Collect: Yes**, same four answers as above.

_Why:_ alongside the video the app sends the **original filename** in an `X-Filename` header,
which the server keeps, plus the four court-corner points the user tapped (policy §3). The
policy explicitly warns that a filename may contain a name, a date or an opponent's name. That
is user-supplied text retained on a server.

_Alternative:_ "Other Data" is a defensible home for a filename if you prefer. Do not leave it
undeclared.

---

## Everything marked "Not Collected"

Each of these is a deliberate **No**, with the reason:

| Type                                         | Why not                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Contact Info (name, email, phone, address)   | Never asked for — there are no accounts (§ short version)                                                             |
| Health & Fitness                             | Not collected; the app measures a video, not the body                                                                 |
| Financial Info                               | Apple processes payment; card details never reach the app or us (§6)                                                  |
| Location (precise or coarse)                 | No location APIs. See the country caveat below                                                                        |
| Sensitive Info                               | None                                                                                                                  |
| Contacts                                     | Never accessed                                                                                                        |
| Browsing History                             | None                                                                                                                  |
| Search History                               | None                                                                                                                  |
| Usage Data (product interaction, ads, other) | **No analytics or telemetry SDK of any kind** (§7)                                                                    |
| Diagnostics — Crash Data                     | Crashes are written to `Documents/last-fatal-error.json`, shown in an alert, then deleted. **Never transmitted** (§5) |
| Diagnostics — Performance / Other            | No performance monitoring                                                                                             |
| Identifiers — Advertising ID                 | No ad SDK, no IDFA (§7)                                                                                               |

### The one genuinely ambiguous item: country

Policy §6 says RevenueCat receives _"basic device and platform information (device model, OS
version, app version, country)"_. Country is normally derived from the request IP, not from
location services.

Apple has no "device model / OS version" data type, so those need no declaration. **Country is
the arguable one.** My reading: RevenueCat derives it from the store account and IP, and it is
used to price and account for the subscription — it is part of the purchase record already
covered by **Purchases → Purchase History**, not a separate Coarse Location declaration. The
app requests no location permission and calls no location API.

I have **not** ticked Coarse Location. If you want to be maximally conservative you could,
but declaring location data for an app with no location permission tends to raise more
questions than it answers.

---

## App Tracking Transparency

**No ATT prompt.** Nothing in the app tracks as Apple defines it: no data is shared with a
data broker, and no identifier is used to link the user to third-party data (§7). The correct
answer to "used to track you" is **No** for every type above.

---

## Disagreements found between the policy and the code

I read the current privacy policy against the source rather than assuming it was right. The
policy is in unusually good shape — §3 in particular is accurate, including the plain-HTTP
admission. These are what did not line up.

### A. The microphone purpose string does not say what the policy says it says — _fix before submit_

Policy §2 states the microphone is used because _"the analyser uses it to detect ball
strikes"_ and that _"the microphone prompt states this same reason."_

The actual string in `ios/RacquetIQ/Info.plist` is:

> "RacquetAI records match audio along with the video so playback includes the sound of the rally."

It mentions **playback only** — not analysis. So either the policy sentence is wrong, or the
purpose string is incomplete. Guideline 5.1.1 requires purpose strings to explain the actual
use, and "we analyse your audio" is a materially different disclosure from "you'll hear the
rally". **Update the string to mention shot detection**, which also makes the policy true.

### B. Purpose strings are branded "RacquetAI", the app is "RacquetIQ"

Camera, microphone and photo-library strings all say **RacquetAI**. Users read these in the
system permission dialog. Not a privacy answer, but it is the old name leaking into the most
visible copy in the app.

### C. The camera string promises a feature that does not exist

> "…so you can review them and, later, have them scored automatically."

Automatic scoring is not in this build. A purpose string is not the place to trail a roadmap.

### D. `NSPhotoLibraryUsageDescription` is unedited boilerplate

> "Allow $(PRODUCT_NAME) to access your photos"

Policy §2 says photo access is **add-only** and that the app "cannot read your library". A
generic full-access string contradicts that and is a stock 5.1.1 rejection trigger. The
add-only string (`NSPhotoLibraryAddUsageDescription`) is written properly; this one should
either be removed if nothing needs read access, or written to match reality.

### E. Blanket ATS exception

`NSAppTransportSecurity → NSAllowsArbitraryLoads = true` disables App Transport Security for
**every** host, not just the analysis server. It is there because the server is plain HTTP
(policy §3 admits the upload is unencrypted). A blanket exception invites a reviewer question
and weakens every other connection the app makes. Narrow it to
`NSExceptionDomains` for `racquetiq-a7682a.eastus.azurecontainer.io` — or, better, put the
server behind HTTPS and delete the exception, which would also let §3's editorial note be
removed.

### F. Stale comment: `serverConfig.ts` names the wrong default

`src/features/analysis/serverConfig.ts` says _"Default is http://localhost:8082"_ and refers to
"Settings → Analysis server". Both are wrong: the real default is the Azure host in
`jobContract.ts:27`, and there is no Settings screen. The policy is right and the comment is
stale. Cosmetic, but it is the comment someone will read when they next reason about where
video goes.

### G. Minor: the policy's file table mentions "sport"

Policy §1 lists the per-recording metadata file as "(date, duration, sport)". Multi-sport was
removed. Harmless, but it hints at a capability the app no longer has.

---

## Sources

- `docs/legal/privacy-policy.md` — §1–§7 in particular
- `src/lib/subscription.ts`, `src/lib/purchases.ts` — RevenueCat boundary
- `src/features/analysis/jobContract.ts:27` — the baked-in server URL
- `src/features/analysis/backend.ts` — `resolveBackend()` fallback rule
- `app.json` → `expo.ios.infoPlist`, `ios/RacquetIQ/Info.plist` — ATS and purpose strings
