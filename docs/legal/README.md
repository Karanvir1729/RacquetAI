# docs/legal — publishing the legal pages

Two documents live here, and both must be reachable at a **public URL** before RacquetIQ can be
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
| `TODO_OPERATOR_LEGAL_ENTITY` | The name that sells the app | Must match the seller name in App Store Connect. A sole proprietor's legal name is fine; if you incorporate later, both documents and the ASC seller name change together. |
| `TODO_OPERATOR_POSTAL_ADDRESS` | A postal address | Apple's minimum EULA terms require the developer's name **and address** in the EULA. A registered-business or mailing address; think before publishing a home address. |
| `TODO_OPERATOR_SUPPORT_EMAIL` | A monitored inbox | Reviewers and users both email it. Prefer an address on a domain you control over a personal Gmail — see the note in [../07-app-store-prep.md](../07-app-store-prep.md) §3. |
| `TODO_OPERATOR_JURISDICTION` | Governing law | Ontario/Canada is pre-suggested in the Terms; delete the suggestion once decided. |
| The HTTP/TLS line in the Privacy Policy §3 | Keep it while the analysis server is plain HTTP; delete it the moment the server is behind HTTPS | **Do not delete it while it is still true.** |

Also decide the free-trial sentence in Terms §5: the wording covers a trial *if one is ever offered*
(Apple requires the forfeiture disclosure whenever one exists). Leave it as written — it is harmless
when no trial exists and mandatory when one does.

---

## 1. Publishing — GitHub Pages, zero cost, ~5 minutes

`Karanvir1729/RacquetAI` is already a **public** repo, so GitHub Pages is free and needs no new
account. Pages can serve from the repo root or from `/docs`; `/docs` is what we want.

### 1.1 The internal docs are already kept out of the published site

Serving `/docs` would otherwise publish the architecture notes, the submission runbook, and the
planning board at a URL you are about to hand to an App Store reviewer. Two files already handle
that, so there is nothing to write:

- **`docs/_config.yml`** excludes every `docs/`-root markdown file, `docs/planning/`, and this
  README, leaving only `docs/legal/`. Anything new added at `docs/` root is excluded automatically;
  a new **public** page must go under `docs/legal/` and carry front matter.
- **`docs/legal/index.md`** is the landing page at `/legal/`.

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

**The binary link requirement is not optional.** RacquetIQ has no Settings tab any more, so the
paywall is the only screen that can carry these links; it already reads them from
`src/lib/legalLinks.ts`, so publishing the pages and pasting the two URLs there is the whole job. A
subscription screen without a working Terms and Privacy link is a Guideline 3.1.2 rejection.

---

## 3. Keeping the documents true

These are code-derived documents. Re-read them whenever any of the following changes, and update the
"Last updated" date when they do:

- the analysis server host, its region, or the fact that it is a fallback (`jobContract.ts`,
  `backend.ts`)
- the server moving to HTTPS (deletes a paragraph from Privacy Policy §3)
- server-side retention actually being implemented (rewrites Privacy Policy §3 and §10)
- adding any analytics, crash-reporting SDK, account system, or sharing feature — each one changes
  both this policy **and** the App Privacy questionnaire answers
- the free allowance changing from three analyses (Terms §4)
- subscription prices or the set of products (Terms §5)
