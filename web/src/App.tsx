import { useEffect } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/theme/ThemeProvider";
import Account from "@/pages/Account";
import Admin from "@/pages/Admin";
import Analyze from "@/pages/Analyze";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import ClipDetail from "@/pages/ClipDetail";
import Demo from "@/pages/Demo";
import Landing from "@/pages/Landing";
import Library from "@/pages/Library";
import Login from "@/pages/Login";
import Coach from "@/pages/Coach";
import NotFound from "@/pages/NotFound";
import PlayerPage from "@/pages/PlayerPage";
import Players from "@/pages/Players";
import Profile from "@/pages/Profile";
import Record from "@/pages/Record";
import Referee from "@/pages/Referee";
import SharedPlayer from "@/pages/SharedPlayer";
import Upgrade from "@/pages/Upgrade";

/**
 * App shell + routes.
 *
 * `/analyze` is the whole journey — upload, corner marking, progress, read-out
 * — against an analysis server the visitor points it at. `/demo` is the same
 * read-out fed by the bundled sample, so the site is worth visiting with no
 * server running at all. `/library` is this browser's own history of finished
 * analyses, and `/record` films one from a camera on the machine.
 * `/coach` and `/profile` are the coaching surface: a player profile, and a
 * conversation that reads it alongside the most recent analysed match.
 * `/players` is the roster of people IN the footage — each `/players/:id`
 * pools every clip that name was tagged on into one scouting profile, and
 * `/players/sample` shows one on public footage; `/p/:token` is a profile its
 * owner chose to share — read-only, no sign-in, live only while the token
 * stands. Under each of those three, `…/clips/:clipId` is one recording's
 * full read-out from the analysis stored against it (the footage never
 * travels; a poster frame stands in). `/login`, `/account`, `/upgrade` and
 * `/checkout/success` are the account + subscription surface (Supabase +
 * Stripe); `/admin` is the operator metrics dashboard.
 */

function ScrollToTarget() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // querySelector THROWS on anything that is not a valid selector, and this
      // effect sits outside the ErrorBoundary (which wraps only the route), so
      // a throw here unmounts the whole React root and the site goes blank.
      //
      // That is not hypothetical: Supabase returns an OAuth session in the
      // fragment — `#access_token=eyJ...&expires_in=3600` — so EVERY Google
      // sign-in landed on a blank page. A numeric anchor like `#2024` does it
      // too. Anchors are scrolled to on a best-effort basis; nothing here is
      // worth taking the page down for.
      try {
        const target = document.querySelector(hash);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      } catch {
        // Not an anchor — an auth fragment, or a malformed one. Fall through
        // and let supabase-js consume it.
      }
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);

  return null;
}

function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTarget />
      <SiteHeader />
      <main id="main" className="flex-1">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/analyze" element={<Analyze />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/library" element={<Library />} />
              <Route path="/record" element={<Record />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/players" element={<Players />} />
              {/* The sample's routes come before the parameterised ones so
                  "sample" is never read as a roster id. */}
              {/* No static "/players/sample" route: React Router v6 ranks static
                  segments above ":id", so "/players/sample" reaches PlayerPage
                  through "/players/:id" (id === "sample") and a static route here
                  would instead match with NO param and blank the sample. The
                  clip route stays explicit because it carries its own source. */}
              <Route path="/players/sample/clips/:clipId" element={<ClipDetail source="sample" />} />
              <Route path="/players/:id/clips/:clipId" element={<ClipDetail source="owned" />} />
              <Route path="/players/:id" element={<PlayerPage />} />
              <Route path="/p/:token/clips/:clipId" element={<ClipDetail source="shared" />} />
              <Route path="/p/:token" element={<SharedPlayer />} />

              <Route path="/referee" element={<Referee />} />
              <Route path="/login" element={<Login />} />
              <Route path="/account" element={<Account />} />
              <Route path="/upgrade" element={<Upgrade />} />
              <Route path="/checkout/success" element={<CheckoutSuccess />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
