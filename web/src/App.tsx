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
import Demo from "@/pages/Demo";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import Upgrade from "@/pages/Upgrade";

/**
 * App shell + routes.
 *
 * `/analyze` is the whole journey — upload, corner marking, progress, read-out
 * — against an analysis server the visitor points it at. `/demo` is the same
 * read-out fed by the bundled sample, so the site is worth visiting with no
 * server running at all. `/login`, `/account`, `/upgrade` and
 * `/checkout/success` are the account + subscription surface (Supabase +
 * Stripe); `/admin` is the operator metrics dashboard.
 */

function ScrollToTarget() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
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
