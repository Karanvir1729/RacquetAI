import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { Wordmark } from "@/components/brand/Mark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ButtonLink } from "@/components/ui/Button";
import { Hairline } from "@/components/ui/Card";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/coach", label: "Coach" },
  { href: "/record", label: "Film a match" },
  { href: "/referee", label: "Referee" },
  { href: "/library", label: "Your matches" },
  { href: "/#how", label: "How it works" },
  { href: "/#readout", label: "What you get" },
  { href: "/#limits", label: "Limits" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#waitlist", label: "Waitlist" },
];

/**
 * Sticky, blurred header — Daybot's shape, RacketIQ's mark.
 *
 * The nav collapses into a disclosure below `md` rather than disappearing:
 * a phone visitor still needs to reach the limits section, and every row in
 * the open menu is a full 44px target.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { session } = useAuth();
  const accountHref = session ? "/account" : "/login";
  const accountLabel = session ? "Account" : "Sign in";

  // Any navigation closes the menu — including same-page anchor jumps.
  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-xl"
      style={{ borderColor: "var(--rq-line)", background: "var(--rq-header)" }}
    >
      {/* First focusable thing on every page: hidden until it is tabbed to.
          It drops BELOW the header rather than sitting inside it — at top-3 it
          landed on the wordmark, and an opaque chip narrower than the word it
          covers leaves the tail ("etIQ") sticking out, which reads as broken
          text rather than as a control. */}
      <a
        href="#main"
        className="sr-only rounded-rq-sm border px-4 focus:not-sr-only focus:absolute focus:left-5 focus:top-full focus:z-50 focus:mt-2 focus:inline-flex focus:min-h-[44px] focus:items-center"
        style={{
          borderColor: "var(--rq-line)",
          background: "var(--rq-card)",
          color: "var(--rq-text)",
        }}
      >
        Skip to content
      </a>

      <div className="mx-auto flex max-w-shell items-center justify-between gap-3 px-5 py-3 sm:px-6 lg:px-8">
        <Link
          to="/"
          aria-label="RacketIQ home"
          className="flex min-h-[44px] shrink-0 items-center"
        >
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rq-label text-rq-dim transition-colors duration-200 hover:text-rq-text focus-visible:text-rq-text"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ButtonLink
            to={accountHref}
            size="sm"
            variant="ghost"
            className="hidden md:inline-flex"
          >
            {accountLabel}
          </ButtonLink>
          <ButtonLink to="/analyze" size="sm" className="hidden sm:inline-flex">
            Analyze a match
          </ButtonLink>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-11 w-11 items-center justify-center rounded-rq-sm border transition-transform duration-200 ease-rq hover:scale-105 md:hidden"
            style={{
              borderColor: "var(--rq-line)",
              background: "var(--rq-card)",
              color: "var(--rq-text)",
            }}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="md:hidden" style={{ background: "var(--rq-panel)" }}>
          <Hairline />
          <nav className="mx-auto flex max-w-shell flex-col px-5 py-2 sm:px-6">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rq-label flex min-h-[48px] items-center"
                style={{ color: "var(--rq-text-dim)" }}
              >
                {item.label}
              </a>
            ))}
            <Link
              to={accountHref}
              className="rq-label flex min-h-[48px] items-center"
              style={{ color: "var(--rq-text-dim)" }}
            >
              {accountLabel}
            </Link>
            <ButtonLink to="/analyze" size="md" className="my-3 w-full">
              Analyze a match
            </ButtonLink>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
