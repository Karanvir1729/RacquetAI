# docs/legal — publishing the legal pages

Two documents live here, and both must be reachable at a **public URL** before RacketIQ can be
submitted as a subscription app:

| File | What it is | Where Apple wants it |
|---|---|---|
| [privacy-policy.md](privacy-policy.md) | Privacy Policy | App Store Connect **App Privacy → Privacy Policy URL** (a URL) |
| [terms-of-use.md](terms-of-use.md) | Terms of Use / EULA | App Store Connect **App Information → License Agreement** (pasted text) **and** a URL linked from the paywall and the description |

> **These are drafts written from the source code, not legal advice.** They are accurate about what
> the app does — that part was checked against the code. Whether they are *sufficient* for your
> jurisdiction, your legal entity, and your risk appetite is a question for a lawyer, and one worth
> paying for once before a paid launch.

---

## 0. Fill the placeholders first

Search both files for `TODO_OPERATOR_` and replace every hit. Nothing publishes until these are real:

| Placeholder | What it needs | Notes |
|---|---|---|
| `Daybot Solutions Inc.` | The name that sells the app | Must match the seller name in App Store Connect. A sole proprietor's legal name is fine; if you incorporate later, both documents and the ASC seller name change together. |
| `TODO_OPERATOR_POSTAL_ADDRESS` | A postal address | Apple's minimum EULA terms require the developer's name **and address** in the EULA. A registered-business or mailing address; think before publishing a home address. |
| `prokaranvir@gmail.com` | A monitored inbox | Reviewers and users both email it. Prefer an address on a domain you control over a personal Gmail — see the note in [../07-app-store-prep.md](../07-app-store-prep.md) §3. |
| `TODO_OPERATOR_JURISDICTION` | Governing law | Ontario/Canada is pre-suggested in the Terms; delete the suggestion once decided. |
| The HTTP/TLS line in the Privacy Policy §3 | Keep it while the analysis server is plain HTTP; delete it the moment the server is behind HTTPS | **Do not delete it while it is still true.** |

Also decide the free-trial sentence in Terms §5: the wording covers a trial *if one is ever offered*
(Apple requires the forfeiture disclosure whenever one exists). Leave it as written — it is harmless
when no trial exists and mandatory when one does.

---

## 1. Publishing — GitHub Pages, zero cost, ~5 minutes

`Karanvir1729/RacquetAI` is already a **public** repo, so GitHub Pages is free and needs no new
account. Pages can serve from the repo root or from `/docs`; `/docs` is what we want.

### 1.1 The internal docs are kept out of the published site

Serving `/docs` would otherwise publish the architecture notes, the submission runbook, and the
planning board at a URL you are about to hand to an App Store reviewer. Two files handle that:

- **`docs/_config.yml`** excludes the internal `docs/`-root markdown files **by name**,
  `docs/planning/`, and this README — leaving `docs/legal/` as the whole published site.
- **`docs/legal/index.md`** is the landing page at `/legal/`.

> **Why by name, and not `"*.md"`.** Jekyll matches `exclude` patterns with Ruby's `File.fnmatch`
> *without* `FNM_PATHNAME`, so `*` crosses `/`: `File.fnmatch?("*.md", "legal/privacy-policy.md")`
> is **true**. An earlier `_config.yml` excluded `"*.md"` on the assumption that it matched the
> `docs/` root only, which quietly unpublished both legal pages — the site would have built fine and
> served 404s at exactly the two URLs the paywall links to. Never reintroduce a `*` here. When you
> add a new internal doc at `docs/` root, add its filename to `exclude`; when you add a new public
> page, put it under `docs/legal/` with front matter and change nothing.

After the first Pages build, confirm **both** halves of that rule in a private window: the two legal
URLs must render, and `…/RacquetAI/app-store-submission.md` (or any other internal doc path) must
**404**.

The two legal files already carry the YAML front matter (`title` + `permalink`) that makes Jekyll
render them as HTML — **without front matter GitHub Pages serves raw Markdown**, which browsers
download instead of displaying. Do not remove those blocks.

### 1.2 Turn Pages on

1. GitHub → the repo → **Settings → Pages**.
2. **Source:** *Deploy from a branch*. **Branch:** `main`, **Folder:** `/docs`. Save.
3. Wait for the Pages build (Actions tab shows `pages build and deployment`), then confirm the URLs:

```
https://karanvir1729.github.io/RacquetAI/legal/privacy-policy/
https://karanvir1729.github.io/RacquetAI/legal/terms-of-use/
```

4. **Open both in a private/incognito window, signed out of GitHub.** A privacy-policy URL that
   lands on a login wall or a 404 is a real, previously-observed rejection cause.

### 1.3 Support URL

App Store Connect requires a **Support URL** (a real URL, not a `mailto:`). Cheapest option: add
`docs/legal/support.md` with front matter `permalink: /support/`, containing the support email, a
"how to get a good analysis" summary, and a link back to both legal pages. That gives you
`https://karanvir1729.github.io/RacquetAI/support/` at no extra cost.

### Alternatives, if you would rather not publish from this repo

- **A separate public repo** (e.g. `racquetiq-legal`) with the same two files and Pages on. Cleanest
  separation, one more repo to remember.
- **A custom domain** on the same Pages site (Settings → Pages → Custom domain) once you own one —
  `racquetiq.app/privacy` reads far better in a store listing than a `github.io` path, and the switch
  later means updating the URL in App Store Connect and in the app's paywall links.
- Any static host (Netlify/Cloudflare Pages drag-and-drop). No advantage over Pages here.

---

## 2. Exactly which App Store Connect fields need these

Fill these once the URLs resolve publicly.

| Where in App Store Connect | Field | Value |
|---|---|---|
| **App Privacy** (left sidebar) | Privacy Policy URL | the published privacy-policy URL |
| **App Information → Localizable Information** | Privacy Policy URL, if your ASC build still shows it here | same URL (fill both if both exist) |
| **App Information → License Agreement** | Custom License Agreement | **paste the full text** of `terms-of-use.md`, rendered as plain text. This field takes text, not a link. If you leave it on Apple's Standard EULA instead, your paywall must link Apple's standard EULA URL rather than ours — pick one and be consistent. |
| **Version → Promotional Text / Description** | Description | must contain the subscription's title, length, and price plus **functional links to both the Terms of Use and the Privacy Policy** — this is a hard requirement for auto-renewable subscriptions |
| **Version → General Information** | Support URL | the `/support/` page (or another live page) |
| **Version → General Information** | Marketing URL | optional |
| **Version → App Review Information** | Notes | see [../app-store-submission.md](../app-store-submission.md) §8 |
| **In the binary** (not ASC) | `src/lib/legalLinks.ts` | paste the two published URLs into `TERMS_OF_USE.url` and `PRIVACY_POLICY.url` — they are `null` today, which the paywall renders as a visibly disabled row |

**The binary link requirement is not optional.** RacketIQ has no Settings tab any more, so the
paywall is the only screen that can carry these links; it already reads them from
`src/lib/legalLinks.ts`, so publishing the pages and pasting the two URLs there is the whole job. A
subscription screen without a working Terms and Privacy link is a Guideline 3.1.2 rejection.

### 2.1 Turning the paywall links on — one file, two lines

`src/lib/legalLinks.ts` is the **single** place these URLs exist in the app. Nothing else in the
codebase hard-codes a legal URL; the paywall footer imports `LEGAL_LINKS` from it and renders
whatever it finds.

```ts
// src/lib/legalLinks.ts — before
export const TERMS_OF_USE: LegalLink = { label: "Terms of Use (EULA)", url: null };
export const PRIVACY_POLICY: LegalLink = { label: "Privacy Policy", url: null };

// after (paste your two published URLs; keep the labels)
export const TERMS_OF_USE: LegalLink = {
  label: "Terms of Use (EULA)",
  url: "https://karanvir1729.github.io/RacquetAI/legal/terms-of-use/",
};
export const PRIVACY_POLICY: LegalLink = {
  label: "Privacy Policy",
  url: "https://karanvir1729.github.io/RacquetAI/legal/privacy-policy/",
};
```

Editing those two lines is the entire change. On the next build the paywall automatically:

1. renders each row as a live, tappable, underlined link instead of a struck-through disabled one
   (`isPublished` accepts only an absolute `http(s)` URL, so a half-pasted value stays disabled
   rather than opening nothing); and
2. **drops the "these pages go live before the App Store release" note**, which
   `hasUnpublishedLegalLink()` shows only while a URL is still missing.

No other file changes, and no rebuild step beyond the normal one. Then, on the built screen: tap both
rows and confirm each opens the right public page — that is the Guideline 3.1.2 check, and it is the
last thing to do before capturing paywall screenshots.

---

## 3. Keeping the documents true

These are code-derived documents. Re-read them whenever any of the following changes, and update the
"Last updated" date when they do:

- the analysis server host, its region, or the fact that it is a fallback (`jobContract.ts`,
  `backend.ts`)
- **what is actually uploaded** (`compressForUpload` in `features/analysis/deviceClient.ts`). Today it
  returns the *original* URI whenever the native analyzer is unavailable — which is precisely the
  condition that selects the server fallback — so the fallback normally uploads the **full-size
  original**. Privacy Policy §3 says so in those words. If compression is ever moved out of the
  native analyzer, or made to run on the fallback path, that bullet becomes wrong and must change.
- **what is sent alongside the video** (`uploadFileName` / the `X-Filename` header in
  `features/analysis/importClient.ts`, retained by `analysis/server.py` as the job's `sourceName`).
  Removing or adding a header changes Privacy Policy §3.
- the microphone purpose string in `app.json`. It must keep describing the *real* use — the analyser
  detecting ball strikes from audio (`modules/racquet-analyzer/ios/Audio.swift`) — and match Privacy
  Policy §2. A purpose string is shown to the user at the permission prompt, so an inaccurate one is
  a misrepresentation, not a copy nit.
- a **RevenueCat key shipping** (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `extra.revenueCatIosKey`). With no
  key the SDK is never configured and makes no network call; with one it calls out at launch and
  collects the IDFV. Privacy Policy §6 and the App Privacy **Device ID** row are written for the
  key-present case, which is the paid release.
- the server moving to HTTPS (deletes a paragraph from Privacy Policy §3)
- server-side retention actually being implemented (rewrites Privacy Policy §3 and §10)
- adding any analytics, crash-reporting SDK, account system, or sharing feature — each one changes
  both this policy **and** the App Privacy questionnaire answers
- the free allowance changing from three analyses (Terms §4)
- subscription prices or the set of products (Terms §5)
