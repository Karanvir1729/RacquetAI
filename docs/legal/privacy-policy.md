---
title: RacquetIQ Privacy Policy
permalink: /legal/privacy-policy/
---

# RacquetIQ — Privacy Policy

**Last updated:** 17 August 2026
**Applies to:** the RacquetIQ iOS app (bundle identifier `com.racquetai.app`), version 1.0 and later.

RacquetIQ is made by **TODO_OPERATOR_LEGAL_ENTITY** ("we", "us"), TODO_OPERATOR_POSTAL_ADDRESS.
Questions about this policy: **TODO_OPERATOR_SUPPORT_EMAIL**.

This policy describes exactly what the app does with your video, your audio, and your data. It is
written against the app's source code rather than from a template — where a section says "never
leaves your device", that is a statement about how the code is built, not a promise of intent.

---

## The short version

- **There are no accounts.** You never create one, we never issue one, and we hold no profile of you.
- **There is no analytics SDK, no advertising SDK, and no third-party tracking of any kind.** We do
  not track you across apps or websites, so the app never shows an App Tracking Transparency prompt.
- **Your recordings and your analyses are stored on your phone**, inside the app's private storage
  area, and are deleted when you delete them or when you delete the app.
- **Match analysis normally runs entirely on your phone.** In that mode your video and its audio
  never leave the device and no network connection is used.
- **There is one exception:** if the on-device analyser cannot run on your device, the app falls back
  to uploading a shrunken copy of the video to our analysis server so the analysis can be produced
  there. [What that means in detail is set out below.](#3-when-video-does-leave-your-phone-the-analysis-server-fallback)
- **Subscription purchases** are processed by Apple. We use RevenueCat to tell the app whether your
  subscription is active; RevenueCat receives an anonymous identifier and your purchase information,
  not your name or your videos.

---

## 1. What the app stores on your phone

Everything in this section stays inside the app's private sandbox on your device. It is not visible
to other apps, it is not sent to us, and it is included in an encrypted iCloud/iTunes device backup
only if you have those backups switched on.

| What | Where | When it is removed |
|---|---|---|
| Match videos you record in the app | `Documents/recordings/<id>.mov` | When you delete the recording in the app, or delete the app |
| A small metadata file per recording (date, duration, sport) | `Documents/recordings/<id>.json` | Same as above |
| Analyses (shot counts, court placement, coverage heatmap, predictability, rally timings) | `Documents/recordings/<id>.analysis.json` | When you delete that analysis, or delete the app |
| A copy of the video an analysis was produced from, so the analysis screen can play it back | `Documents/recordings/<id>.video.*` | When you delete that analysis, or delete the app |
| App preferences (whether you have seen the tutorial, which analysis engine to use, the analysis server address) | Small JSON files in `Documents/` | When you delete the app |
| Crash diagnostics from a previous run — see [section 5](#5-crash-diagnostics) | `Documents/last-fatal-error.json` | Automatically, the next time you open the app |

We do not have access to any of it.

## 2. Camera, microphone, and photo library

- **Camera and microphone.** Used only while you are recording a match in the app. Audio is recorded
  as part of the video because the analyser listens for the sound of ball strikes to find shots and
  rally boundaries. The app asks for these permissions at the moment you first try to record, and
  explains why in the system prompt.
- **Choosing a video to analyse.** The app opens Apple's system video picker. On iOS this hands the
  app only the single file you choose — the app is not granted access to browse your photo library.
- **Saving a recording to Photos.** Only when you tap "Save to Photos". The app requests *add-only*
  access, which lets it add that one video and nothing else. It cannot read your library.

## 3. When video *does* leave your phone: the analysis server fallback

RacquetIQ has two analysis engines:

**On-device (the default and normal path).** A native analyser bundled inside the app decodes the
video, runs Apple's on-device Vision pose detection, and measures the audio track locally. Nothing is
uploaded, nothing is transmitted, and analysis works with the phone in airplane mode.

**Analysis server (a fallback).** If the on-device analyser cannot be loaded or run on your device,
the app instead uploads the video so the analysis can be produced on our server. This is a fallback
for capability, not a choice you are asked to make each time, so it is important that you know what
it involves:

- **What is sent:** a shrunken copy of the video (the app re-encodes it to roughly 960×540 before
  uploading where it can), **including its audio track**; the four court-corner points you tap; and
  nothing else. No name, no email, no account identifier, no device identifier, and no advertising
  identifier is attached. The job is identified by a random string generated on the server.
- **Where it goes:** a server we operate at `racquetiq-a7682a.eastus.azurecontainer.io`, hosted on
  Microsoft Azure in the East US region. **Your video is therefore processed in the United States.**
- **How it is protected in transit:** the app currently connects to that server over plain HTTP,
  which means **the upload is not encrypted in transit**.
  *(Editorial note for the operator, delete this parenthesis before publishing: this bullet is
  accurate today and must stay until the analysis server is served over HTTPS — see
  [README.md](README.md) §0.)*
- **What the server keeps:** the uploaded video, a downscaled copy of it, an extracted audio track, a
  single reference frame image, and the resulting analysis file. These are kept in a per-job folder.
  **There is no automatic expiry today** — they remain until we delete them.
- **Who can see it:** only us, as the operator of that server. We do not sell it, share it, use it to
  train anything, or give it to anyone else. We access it only to fix a failed analysis or a bug.
- **How to have it deleted:** email TODO_OPERATOR_SUPPORT_EMAIL with the approximate date, time, and
  length of the clip and we will find and delete it. There is no in-app control for server-side
  deletion.

If you would rather no video ever left your phone, the practical answer today is to use a device on
which the on-device analyser works — which is every supported iPhone in a normal App Store install —
and to contact us if you see an analysis reported as running on the server.

## 4. Other people in your videos

A squash video normally shows at least one other person. RacquetIQ does not identify anyone: it
detects human body poses to measure movement, and it does not perform face recognition, does not
build a profile of any player, and cannot tell one match's players from another's. You are
nonetheless responsible for having the right to film the people in your footage — see the
[Terms of Use](terms-of-use.md).

## 5. Crash diagnostics

If the app crashes, it writes the error message and the first part of the technical stack trace to a
single file inside its own sandbox (`Documents/last-fatal-error.json`). The next time you open the
app, it shows you that message in an alert and then deletes the file.

**That diagnostic is never transmitted anywhere.** There is no crash-reporting service in the app.
Nothing reaches us unless you choose to screenshot the alert and send it to us yourself, which is
entirely your decision. The file contains a programming error message, not your content.

## 6. Subscriptions and payments

RacquetIQ Pro is an auto-renewable subscription sold through the App Store.

- **Apple processes the payment.** We never see and never receive your card details, your Apple
  Account credentials, or your billing address. Apple's handling of that data is governed by
  [Apple's Privacy Policy](https://www.apple.com/legal/privacy/).
- **We use [RevenueCat](https://www.revenuecat.com/privacy/)** to check whether your subscription is
  active. The RevenueCat SDK inside the app generates a **random anonymous user identifier** and
  sends it, together with the App Store transaction/receipt information for your purchase and basic
  device and platform information (device model, OS version, app version, country), to RevenueCat's
  servers. RevenueCat is a data processor acting on our instructions.
- **That identifier is not linked to you.** We do not ask for your name or email, so we cannot
  connect a purchase to a person. If you reinstall the app, a new anonymous identifier is generated
  and your purchase is re-associated with it when you restore purchases.
- **Your videos and analyses are never sent to RevenueCat or to Apple.**
- We use this data only to decide whether to unlock unlimited analyses, to support you if a purchase
  goes wrong, and to see aggregate subscription totals.

## 7. What we do *not* do

- No advertising, no ad networks, no ad identifiers.
- No analytics or product-usage telemetry.
- No tracking as Apple defines it, so no App Tracking Transparency prompt.
- No sale or sharing of personal information (as those terms are used in the CCPA/CPRA). We have
  nothing to sell.
- No use of your videos or analyses to train machine-learning models.
- No profiling and no automated decision-making that has a legal effect on you.

## 8. Legal bases, and your rights

Because the app has no accounts, almost all of your data exists only on your own device, and you
exercise your rights directly:

- **Access and portability** — your analyses are plain files on your device; recordings can be
  exported to Photos from the player screen.
- **Erasure** — delete an individual recording or analysis in the app, or delete the app to remove
  everything at once. For anything held on the analysis server, email us (see section 3).
- **Objection / restriction / complaint** — write to TODO_OPERATOR_SUPPORT_EMAIL. Users in the EEA
  or UK may also complain to their local data protection authority.

Where the GDPR applies, our legal basis for the very limited processing we do is **performance of a
contract** (producing the analysis you asked for, and delivering the subscription you bought) and our
**legitimate interest** in keeping the app working and preventing fraud. Where the analysis server
fallback applies, that processing happens in the United States; we rely on the fact that you have
asked us to perform the analysis for you.

## 9. Children

RacquetIQ is not directed at children under 13 and we do not knowingly collect personal information
from them. The app collects no personal information from any user in the ordinary on-device path.

## 10. Retention

- On your device: until you delete it.
- On the analysis server (fallback path only): until we delete it; no automatic expiry is in place.
  We will delete on request.
- Purchase records at RevenueCat and Apple: for as long as needed to run and account for the
  subscription, per their own policies.

## 11. Changes to this policy

If we change how the app handles data — in particular if we ever add analytics, accounts, or sharing
— we will update this page and change the "Last updated" date above. Material changes will also be
called out in the app's release notes.

## 12. Contact

**TODO_OPERATOR_LEGAL_ENTITY**
TODO_OPERATOR_POSTAL_ADDRESS
TODO_OPERATOR_SUPPORT_EMAIL
