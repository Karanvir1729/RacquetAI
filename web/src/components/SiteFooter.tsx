import { Link } from "react-router-dom";

import { Mark } from "@/components/brand/Mark";

const FOOTER_LINK = "rq-label flex min-h-[44px] items-center";

export function SiteFooter() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--rq-line)" }}>
      <div className="mx-auto flex max-w-shell flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <Mark size={22} />
          <span className="rq-label" style={{ color: "var(--rq-text)" }}>
            Racquet<span style={{ color: "var(--rq-accent-text)" }}>IQ</span>
          </span>
          <span className="rq-caption">· squash match analysis</span>
        </div>

        {/* Every link is a 44px target, footers included — this is the one
            place where small text usually stops being tappable. */}
        <nav className="flex flex-wrap items-center gap-x-6">
          <Link to="/demo" className={FOOTER_LINK} style={{ color: "var(--rq-text-dim)" }}>
            Sample analysis
          </Link>
          <a href="/#limits" className={FOOTER_LINK} style={{ color: "var(--rq-text-dim)" }}>
            What it can't do
          </a>
          <a href="/#faq" className={FOOTER_LINK} style={{ color: "var(--rq-text-dim)" }}>
            FAQ
          </a>
          <a href="/#waitlist" className={FOOTER_LINK} style={{ color: "var(--rq-text-dim)" }}>
            Join the waitlist
          </a>
        </nav>
      </div>
      <div className="mx-auto max-w-shell px-5 pb-8 sm:px-6 lg:px-8">
        <p className="rq-caption max-w-3xl">
          Sample footage is used under CC BY-NC 4.0 from archive.org. RacketIQ measures squash
          footage you supply; it is not affiliated with any tour, federation or club.
        </p>
      </div>
    </footer>
  );
}
