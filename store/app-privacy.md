# App Privacy questionnaire — RacketIQ

The exact selections to make in App Store Connect › App Privacy, matching
`docs/legal/privacy-policy.md` (updated 19 August 2026) and the shipped code: the app
requires an account (Supabase — Sign in with Apple or email+password), keeps a first-party
usage-event stream keyed to the account id (`app_events`), checks billing status with the
account token, and uses RevenueCat for subscriptions.

---

## Summary

| Question                                   | Answer                                                        |
| ------------------------------------------ | ------------------------------------------------------------- |
| Do you collect data from this app?         | **Yes**                                                       |
| Is any data used to track you?             | **No** — no ATT prompt, no ad SDK, no cross-app tracking      |
| Is any data linked to the user's identity? | **Yes** — accounts exist; see each type below                 |

Six data types are collected. Everything else is **Not Collected** — in particular no
location, no contacts, no browsing history, no health data, and the user's videos and
analyses never leave the device except the explicit analysis-server upload the policy
describes (user-initiated, not "collection" of a new data type beyond User Content below).

---

## 1. Contact Info → Email Address

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **Yes**               |
| Purposes                      | **App Functionality** |

_Why:_ the account is created with an email address (or Apple's private relay address).
Used to sign in and to answer support mail — nothing else.

## 2. Identifiers → User ID

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **Yes**               |
| Purposes                      | **App Functionality** |

_Why:_ the Supabase account id keys the profile, the usage events, and billing status.

## 3. Identifiers → Device ID

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ the RevenueCat SDK collects the vendor identifier (IDFV) by default. RevenueCat runs
under an app-generated identifier, not the account id, so the IDFV is not joined to the
user's identity by us.

## 4. Purchases → Purchase History

**Collect: Yes.**

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **Yes**               |
| Purposes                      | **App Functionality** |

_Why:_ App Store receipt data via RevenueCat decides whether Pro is active, and the server's
`purchases` table records the subscription against the account so it follows the user across
devices and platforms.

## 5. Usage Data → Product Interaction

**Collect: Yes.**

| Field                         | Answer                        |
| ----------------------------- | ----------------------------- |
| Used for tracking             | No                            |
| Linked to the user's identity | **Yes**                       |
| Purposes                      | **Analytics** (first-party)   |

_Why:_ `app_events` records first-party events (app opened, signed in, analysis finished…)
with a timestamp and the account id, in our own database. No third-party analytics SDK.
Deleting the account severs the link (user_id set null).

## 6. User Content → Photos or Videos

**Collect: Yes** — with the honest caveat below.

| Field                         | Answer                |
| ----------------------------- | --------------------- |
| Used for tracking             | No                    |
| Linked to the user's identity | **No**                |
| Purposes                      | **App Functionality** |

_Why:_ ordinarily the user's videos never leave the phone. When the user chooses server
analysis (or on-device analysis is impossible), the full video is uploaded to our analysis
server, processed, and used for nothing else; the upload carries no account identifier.
Declaring it keeps the label truthful for that path.

---

## App Tracking Transparency

**Not needed.** Nothing is used for cross-app or cross-site tracking and there is no IDFA
anywhere in the binary. Do not add an ATT prompt.
