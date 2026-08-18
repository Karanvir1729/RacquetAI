import { useEffect } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeProvider } from "@/theme/ThemeProvider";
import Analyze from "@/pages/Analyze";
import Demo from "@/pages/Demo";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

/**
 * App shell + routes.
 *
 * `/analyze` is the whole journey — upload, corner marking, progress, read-out
 * — against an analysis server the visitor points it at. `/demo` is the same
 * read-out fed by the bundled sample, so the site is worth visiting with no
 * server running at all.
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
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
