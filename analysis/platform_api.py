#!/usr/bin/env python3
"""RacquetIQ platform endpoints: Stripe billing + admin metrics.

Mounted as a Flask blueprint by server.py. Talks to:
  - Supabase Auth  (verify user access tokens, list users — service role)
  - Supabase REST  (purchases + app_events tables — service role)
  - Stripe         (Checkout Sessions, Subscriptions — secret key)

Config comes from environment variables, with analysis/.env as an optional
local override file (KEY=VALUE lines; never committed — see .gitignore):

  SUPABASE_URL                e.g. https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   service role JWT (server-only secret)
  STRIPE_SECRET_KEY           sk_test_... / sk_live_...
  STRIPE_WEBHOOK_SECRET       optional; webhook endpoint is disabled without it
  STRIPE_PRICE_MONTHLY        price id for RacquetIQ Pro monthly
  STRIPE_PRICE_YEARLY         price id for RacquetIQ Pro yearly
  WEB_ORIGINS                 comma-separated allowlist of web-app origins for
                              checkout redirects; first entry is the default
                              (legacy WEB_ORIGIN honoured when unset)
  ADMIN_USERNAME / ADMIN_PASSWORD   admin metrics basic auth (default admin/admin)
"""
import collections
import datetime
import hmac
import json
import os
from urllib.parse import quote

import requests
import stripe
from flask import Blueprint, jsonify, redirect, request

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv(path=os.path.join(ANALYSIS_DIR, ".env")):
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    except OSError:
        pass


_load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
# Comma-separated allowlist of web-app origins checkout may return to. The
# first entry is the default when a request carries no (allowlisted) Origin.
_RAW_ORIGINS = (os.environ.get("WEB_ORIGINS")
                or os.environ.get("WEB_ORIGIN")  # pre-allowlist deployments
                or "http://localhost:5183")
WEB_ORIGINS = [o.strip().rstrip("/") for o in _RAW_ORIGINS.split(",") if o.strip()]
ADMIN_USER = os.environ.get("ADMIN_USERNAME", "admin")
# NO DEFAULT PASSWORD, and "admin" is refused outright.
#
# This shipped as `os.environ.get("ADMIN_PASSWORD", "admin")` with
# ADMIN_PASSWORD=admin in the deployed .env, which meant /admin/metrics —
# every user's email address, their signup provider, and the Stripe customer
# and subscription ids, all read with the Supabase SERVICE ROLE key — was
# readable from the open internet by anyone who tried admin/admin.
#
# An unset or obviously-default password now disables the endpoint instead of
# weakly protecting it: a 503 is a bug report, a leak is not.
ADMIN_PASS = os.environ.get("ADMIN_PASSWORD", "")
_WEAK_ADMIN_PASSWORDS = {"", "admin", "password", "changeme", "racquetiq", "racketiq"}
ADMIN_ENABLED = ADMIN_PASS.lower() not in _WEAK_ADMIN_PASSWORDS
PRICES = {
    "monthly": os.environ.get("STRIPE_PRICE_MONTHLY", ""),
    "yearly": os.environ.get("STRIPE_PRICE_YEARLY", ""),
}

platform_bp = Blueprint("platform", __name__)


def _configured():
    return bool(SUPABASE_URL and SERVICE_KEY and stripe.api_key)


def _web_origin(candidate=None):
    """An allowlisted web origin: the candidate (or the request's Origin
    header) when allowlisted, else the first configured origin. Everything
    that builds a redirect goes through here so a tampered `origin` query
    param can never turn /billing/success into an open redirect."""
    value = (candidate if candidate is not None
             else request.headers.get("Origin", "")).rstrip("/")
    return value if value in WEB_ORIGINS else WEB_ORIGINS[0]


# ---------------------------------------------------------------- supabase
def _sb_headers(auth_bearer=None):
    return {"apikey": SERVICE_KEY,
            "Authorization": f"Bearer {auth_bearer or SERVICE_KEY}"}


def _auth_user():
    """Resolve the caller's Supabase user from the Authorization header."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[len("Bearer "):].strip()
    if not token:
        return None
    r = requests.get(f"{SUPABASE_URL}/auth/v1/user",
                     headers=_sb_headers(token), timeout=10)
    if r.status_code != 200:
        return None
    user = r.json()
    return user if user.get("id") else None


def _sb_select(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}",
                     headers=_sb_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def _sb_upsert(table, row, on_conflict):
    headers = _sb_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}",
                      headers=headers, json=row, timeout=15)
    r.raise_for_status()
    return r.json()


def _as_dict(obj):
    """Stripe v15 objects are not plain dicts (.get raises); normalize once."""
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict_recursive"):
        return obj.to_dict_recursive()
    return json.loads(str(obj))


def _record_event(user_id, event, platform, props=None):
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/app_events", headers=_sb_headers(),
                      json={"user_id": user_id, "event": event,
                            "platform": platform, "props": props or {}},
                      timeout=10)
    except requests.RequestException:
        pass  # metrics are best effort, never fail the payment path


def _record_purchase(session, platform):
    """Upsert a purchases row from a paid Stripe Checkout Session."""
    sub = session.get("subscription")
    if isinstance(sub, str):
        sub = _as_dict(stripe.Subscription.retrieve(sub))
    item = (sub.get("items", {}).get("data") or [{}])[0] if sub else {}
    price = item.get("price") or {}
    plan = next((name for name, pid in PRICES.items() if pid == price.get("id")),
                price.get("lookup_key") or "unknown")
    row = {
        "user_id": session.get("client_reference_id"),
        "stripe_customer_id": session.get("customer"),
        "stripe_session_id": session.get("id"),
        "stripe_subscription_id": sub.get("id") if sub else None,
        "price_id": price.get("id"),
        "plan": plan,
        "amount_total": session.get("amount_total"),
        "currency": session.get("currency"),
        "status": (sub.get("status") if sub else session.get("payment_status")),
        "platform": platform,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    existing = _sb_select("purchases", {
        "stripe_session_id": f"eq.{row['stripe_session_id']}", "select": "id",
    })
    _sb_upsert("purchases", row, on_conflict="stripe_session_id")
    # The upsert is idempotent; the metrics event must be too, or every extra
    # /billing/confirm for the same session inflates purchase counts.
    if not existing:
        _record_event(row["user_id"], "purchase_completed", platform,
                      {"plan": plan, "amountCents": row["amount_total"]})
    return row


def _refresh_purchase_status(row):
    """Re-check a stored purchase against Stripe — a row written at purchase
    time says "active" forever otherwise, surviving cancellations. Falls back
    to the stored status when Stripe is unreachable."""
    sub_id = row.get("stripe_subscription_id")
    if not sub_id:
        return row
    try:
        live = _as_dict(stripe.Subscription.retrieve(sub_id)).get("status")
    except stripe.StripeError:
        return row
    if live and live != row.get("status"):
        row = dict(row, status=live,
                   updated_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        _sb_upsert("purchases", {k: row[k] for k in
                                 ("stripe_session_id", "status", "updated_at")},
                   on_conflict="stripe_session_id")
    return row


def _active_purchase(user_id):
    """The user's newest still-active purchase, live-verified, or None."""
    rows = _sb_select("purchases", {
        "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": "10",
    })
    active = None
    for i, row in enumerate(rows):
        if active is None and row.get("status") in ("active", "trialing", "paid"):
            rows[i] = row = _refresh_purchase_status(row)
            if row.get("status") in ("active", "trialing", "paid"):
                active = row
    return active, rows


def _trial_ends_at(user_id):
    """The launch trial: profiles.pro_trial_ends_at, stamped by the signup
    trigger for accounts created during the offer. Returns the ISO timestamp
    while it is still in the future, else None. Deliberately NOT part of
    _active_purchase(): the checkout duplicate-guard must keep letting a
    trial user subscribe."""
    try:
        rows = _sb_select("profiles", {
            "id": f"eq.{user_id}", "select": "pro_trial_ends_at",
        })
    except requests.RequestException:
        return None  # a missing column or a blip must not break /billing/status
    ends = (rows[0].get("pro_trial_ends_at") if rows else None) or None
    if not isinstance(ends, str):
        return None
    try:
        when = datetime.datetime.fromisoformat(ends.replace("Z", "+00:00"))
    except ValueError:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    return ends if when > now else None


# ---------------------------------------------------------------- billing
@platform_bp.route("/billing/<path:_sub>", methods=["OPTIONS"])
@platform_bp.route("/admin/<path:_sub>", methods=["OPTIONS"])
def _platform_preflight(_sub=None):
    return "", 204


@platform_bp.route("/billing/checkout", methods=["POST"])
def billing_checkout():
    if not _configured():
        return jsonify({"error": "billing not configured on this server"}), 503
    user = _auth_user()
    if user is None:
        return jsonify({"error": "sign in required"}), 401
    data = request.get_json(silent=True) or {}
    plan = data.get("plan")
    if plan not in PRICES or not PRICES[plan]:
        return jsonify({"error": 'plan must be "monthly" or "yearly"'}), 400
    platform = data.get("platform") if data.get("platform") in ("web", "ios") else "web"
    active, _ = _active_purchase(user["id"])
    if active is not None:
        return jsonify({"error": "You already have an active subscription."}), 409
    # Success bounces through THIS server first (/billing/success) so the
    # purchase is recorded even when the browser that pays holds no Supabase
    # session. The caller's origin rides along (validated on both ends), so
    # local dev returns to localhost and the live site returns to itself.
    server_base = request.host_url.rstrip("/")
    origin = _web_origin()
    success = (f"{server_base}/billing/success"
               f"?session_id={{CHECKOUT_SESSION_ID}}&origin={quote(origin, safe='')}")
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": PRICES[plan], "quantity": 1}],
            client_reference_id=user["id"],
            customer_email=user.get("email"),
            success_url=success,
            cancel_url=f"{origin}/upgrade?canceled=1",
            metadata={"platform": platform, "plan": plan},
        )
    except stripe.StripeError as e:
        return jsonify({"error": f"stripe: {e.user_message or str(e)}"}), 502
    _record_event(user["id"], "checkout_started", platform, {"plan": plan})
    return jsonify({"url": session.url, "sessionId": session.id})


@platform_bp.route("/billing/success")
def billing_success():
    """Stripe's success redirect. Verifies the named session against Stripe
    (the id is unguessable and Stripe is the authority on whether it's paid),
    records it, then hands the browser to the web success page."""
    if not _configured():
        return jsonify({"error": "billing not configured on this server"}), 503
    session_id = request.args.get("session_id", "")
    recorded = False
    if session_id:
        try:
            session = _as_dict(stripe.checkout.Session.retrieve(session_id))
            if session.get("payment_status") == "paid":
                _record_purchase(session,
                                 (session.get("metadata") or {}).get("platform", "web"))
                recorded = True
        except stripe.StripeError:
            pass
    origin = _web_origin(request.args.get("origin", ""))
    suffix = f"?session_id={session_id}&recorded={'1' if recorded else '0'}"
    return redirect(f"{origin}/checkout/success{suffix}", code=302)


@platform_bp.route("/billing/confirm", methods=["POST"])
def billing_confirm():
    """Success-redirect fallback for sandbox use where no webhook can reach us:
    the client posts the session id back and we verify it against Stripe —
    Stripe remains the source of truth, the client only names the session."""
    if not _configured():
        return jsonify({"error": "billing not configured on this server"}), 503
    user = _auth_user()
    if user is None:
        return jsonify({"error": "sign in required"}), 401
    session_id = (request.get_json(silent=True) or {}).get("sessionId", "")
    if not session_id:
        return jsonify({"error": "sessionId required"}), 400
    try:
        session = _as_dict(stripe.checkout.Session.retrieve(session_id))
    except stripe.StripeError:
        return jsonify({"error": "unknown checkout session"}), 404
    if session.get("client_reference_id") != user["id"]:
        return jsonify({"error": "session belongs to a different user"}), 403
    if session.get("payment_status") != "paid":
        return jsonify({"active": False, "status": session.get("payment_status")})
    row = _record_purchase(session, session.get("metadata", {}).get("platform", "web"))
    return jsonify({"active": row["status"] in ("active", "trialing", "paid"),
                    "plan": row["plan"], "status": row["status"]})


@platform_bp.route("/billing/status")
def billing_status():
    if not _configured():
        return jsonify({"error": "billing not configured on this server"}), 503
    user = _auth_user()
    if user is None:
        return jsonify({"error": "sign in required"}), 401
    active, rows = _active_purchase(user["id"])
    # A paid subscription outranks the launch trial; clients get the trial
    # timestamp only when it is what carries their Pro.
    trial = _trial_ends_at(user["id"]) if active is None else None
    return jsonify({"active": active is not None,
                    "plan": active.get("plan") if active else None,
                    "trialEndsAt": trial,
                    "purchases": rows})


@platform_bp.route("/billing/webhook", methods=["POST"])
def billing_webhook():
    if not WEBHOOK_SECRET:
        return jsonify({"error": "webhook not configured"}), 501
    try:
        event = stripe.Webhook.construct_event(
            request.get_data(), request.headers.get("Stripe-Signature", ""),
            WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        return jsonify({"error": "invalid signature"}), 400
    if event["type"] == "checkout.session.completed":
        session = _as_dict(event["data"]["object"])
        if session.get("payment_status") == "paid":
            _record_purchase(session,
                             (session.get("metadata") or {}).get("platform", "web"))
    return jsonify({"received": True})


# ---------------------------------------------------------------- admin
def _admin_authed():
    # Fail closed: with no ADMIN_PASSWORD set, or a default-ish one, there is no
    # credential worth checking and the endpoint is off.
    if not ADMIN_ENABLED:
        return False
    auth = request.authorization
    return (auth is not None and auth.type == "basic"
            and hmac.compare_digest(auth.username or "", ADMIN_USER)
            and hmac.compare_digest(auth.password or "", ADMIN_PASS))


def _mask_email(email):
    """`karanvir@example.com` -> `k••••••r@example.com`. None stays None."""
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        return f"{local[:1]}•@{domain}"
    return f"{local[0]}{'•' * (len(local) - 2)}{local[-1]}@{domain}"


def _day(ts):
    return (ts or "")[:10]


def _daily_series(rows, days=30):
    today = datetime.date.today()
    counts = collections.Counter(_day(r.get("created_at")) for r in rows)
    series = []
    for i in range(days - 1, -1, -1):
        day = (today - datetime.timedelta(days=i)).isoformat()
        series.append({"day": day, "count": counts.get(day, 0)})
    return series


@platform_bp.route("/admin/metrics")
def admin_metrics():
    # Distinguish "off" from "wrong password" for the operator, without telling
    # an anonymous prober anything they can use.
    if not ADMIN_ENABLED:
        return jsonify({
            "error": "Admin metrics are disabled: set ADMIN_PASSWORD to a strong, "
                     "non-default value and redeploy."
        }), 503
    if not _admin_authed():
        return (jsonify({"error": "unauthorized"}), 401,
                {"WWW-Authenticate": 'Basic realm="racketiq-admin"'})
    if not _configured():
        return jsonify({"error": "platform not configured on this server"}), 503

    since = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(days=30)).isoformat()
    r = requests.get(f"{SUPABASE_URL}/auth/v1/admin/users",
                     headers=_sb_headers(), params={"per_page": 1000}, timeout=15)
    r.raise_for_status()
    users = r.json().get("users", [])
    events = _sb_select("app_events", {
        "select": "event,platform,user_id,props,created_at",
        "created_at": f"gte.{since}",
        "order": "created_at.desc", "limit": "5000",
    })
    purchases = _sb_select("purchases", {"order": "created_at.desc", "limit": "500"})
    # Live-verify the rows that claim to be active (bounded — this is a
    # dashboard, not a sync job) so cancelled subscriptions stop counting.
    purchases = [
        _refresh_purchase_status(p)
        if i < 20 and p.get("status") in ("active", "trialing", "paid") else p
        for i, p in enumerate(purchases)
    ]

    active = [p for p in purchases if p.get("status") in ("active", "trialing", "paid")]
    by_type = collections.Counter(e["event"] for e in events)
    by_platform = collections.Counter(e.get("platform") or "web" for e in events)
    return jsonify({
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "totals": {
            "users": len(users),
            "events30d": len(events),
            "purchases": len(purchases),
            "activeSubscriptions": len(active),
            "revenueCents": sum(p.get("amount_total") or 0 for p in purchases
                                if p.get("status") in ("active", "trialing", "paid")),
        },
        "signupsByDay": _daily_series([{"created_at": u.get("created_at")}
                                       for u in users]),
        "eventsByDay": _daily_series(events),
        "eventsByType": [{"event": k, "count": v}
                         for k, v in by_type.most_common(20)],
        "eventsByPlatform": [{"platform": k, "count": v}
                             for k, v in by_platform.most_common()],
        "recentEvents": events[:50],
        # Emails are MASKED. A signup dashboard needs to show that an account
        # exists and roughly who it is, not to hand the full address list to
        # anything that reaches this endpoint. Full addresses live in Supabase,
        # behind the service-role key, for the one operator who needs them.
        "recentUsers": [{"id": u.get("id"), "email": _mask_email(u.get("email")),
                         "createdAt": u.get("created_at"),
                         "provider": ((u.get("app_metadata") or {})
                                      .get("provider"))}
                        for u in users[:50]],
        "purchases": purchases[:50],
    })
