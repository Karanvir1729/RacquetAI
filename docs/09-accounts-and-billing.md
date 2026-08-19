# 09 — Accounts, payments, metrics (Supabase + Stripe sandbox)

Added 2026-08-18. Accounts and payments exist on both clients; everything is
sandbox/test-mode until the keys are rotated and the remaining Apple Developer
steps are done.

## Shape

```
web (Vite SPA) ─┐                      ┌─ Supabase (auth, profiles,
                ├─ analysis/server.py ─┤   app_events, purchases, waitlist)
iOS app ────────┘   + platform_api.py  └─ Stripe (products, checkout, subs)
                    /billing/* /admin/*
```

- **Supabase** (project `olljogfjesovpfjxraxf`, org Daybot) is auth + the
  metrics/purchases store. Clients talk to it directly with the publishable
  key (RLS is the gate); the platform server uses the service-role key.
- **Stripe** stays server-side only. The platform server creates Checkout
  Sessions and verifies them; clients never see the secret key.
- **platform_api.py** is a blueprint mounted by `analysis/server.py` — one
  server process serves analysis jobs, billing, and admin metrics on :8082.

## What's configured where

| Thing | State |
|---|---|
| Supabase schema | `supabase/schema.sql`, applied 2026-08-18 (all 4 tables + RLS + signup trigger) |
| Apple provider | Enabled, client id `com.racquetai.app` (native iOS flow works) |
| Confirm email | OFF (autoconfirm on) so email signup works with no SMTP — revisit before launch |
| Auth URLs | Site URL + redirect `http://localhost:5183/**` |
| Stripe sandbox | Product `prod_V68exGQrVSknL3`; prices `racquetiq_pro_monthly` $9.99/mo, `racquetiq_pro_yearly` $79.99/yr (ids in `analysis/.env`) |
| Server secrets | `analysis/.env` (gitignored; template in `analysis/env.example`) |
| Admin dashboard | `/admin` on the web app → `GET /admin/metrics`, basic auth, default `admin`/`admin` via `ADMIN_USERNAME`/`ADMIN_PASSWORD` |

## Endpoints (platform_api.py)

- `POST /billing/checkout` `{plan: monthly|yearly, platform: web|ios}` + Supabase
  bearer token → `{url}` (Stripe Checkout, test card `4242 4242 4242 4242`).
- `POST /billing/confirm` `{sessionId}` + token — success-redirect fallback;
  the server re-reads the session from Stripe before recording anything.
- `GET /billing/status` + token → `{active, plan, purchases}`.
- `POST /billing/webhook` — signature-verified; answers 501 until
  `STRIPE_WEBHOOK_SECRET` is set. `/billing/confirm` covers sandbox use.
- `GET /admin/metrics` — basic auth; users/signups/events/purchases/revenue.

## Clients

- **Web**: `/login` (Apple + email), `/account`, `/upgrade`, `/checkout/success`,
  `/admin`. Supabase client in `web/src/lib/supabase.ts`, events in
  `lib/events.ts`, billing in `lib/billing.ts` (rides the analysis-server base
  URL, so the Vite `/api` proxy covers dev).
- **iOS**: Account tab (`src/features/account/`), native Sign in with Apple via
  `src/lib/appleAuth.ts` (require-in-try/catch boundary), Supabase session in a
  documents-sandbox sidecar (`src/lib/supabaseClient.ts`), checkout opens
  Stripe in the browser and the screen re-reads `/billing/status` on focus.
  `app.json` gained `usesAppleSignIn` + the `expo-apple-authentication` plugin
  (native rebuild required).
- **Metrics**: both clients insert `app_events` rows (`app_open`, `login`,
  `signup`, `page_view`, `checkout_started`, `analysis_uploaded`, …); the
  server adds `purchase_completed`.

## Still open (deliberately)

1. **Apple sign-in on the WEB** needs an Apple Developer Services ID +
   `.p8`-derived secret pasted into Supabase → Auth → Apple ("Secret Key"),
   and the callback `https://olljogfjesovpfjxraxf.supabase.co/auth/v1/callback`
   registered in the Services ID. Until then the web Apple button errors at
   Apple's end; native iOS sign-in works today.
2. **Sign in with Apple on device** needs the entitlement in the provisioning
   profile — EAS regenerates it on the next `eas build`; simulator builds
   don't need it signed.
3. Keys: the user plans to rotate the pasted Supabase/Stripe keys later;
   `analysis/.env` + client fallbacks must be updated together.
4. Stripe vs App Store: real iOS releases selling digital unlocks must use IAP
   (RevenueCat scaffolding already exists) — browser-Stripe on iOS is a
   sandbox/dev convenience, not a shippable purchase path.
5. Azure: the live ACI predates billing; redeploy with
   `bash analysis/deploy-azure.sh` (now ships `analysis/.env` as secure env
   vars and copies `platform_api.py` into the image) — and note the ACI is
   plain HTTP, so real secrets/tokens should not ride it for long. TLS in
   front of the server (or moving to Container Apps) should come before any
   real user sends a Supabase token or admin credentials over it.
6. Entitlement is display-only today: a Stripe Pro subscription does not yet
   gate anything, because the iOS quota gate reads only RevenueCat (which is
   unconfigured and fails open) and `/jobs` on the analysis server is
   unauthenticated. Server-side enforcement — `/jobs` requiring a token and
   consulting `purchases` — is the natural next step once accounts are real.
