import { useEffect } from "react";

const BASE_TITLE = "RacketIQ — See what your squash match actually did";

/**
 * Per-route document title. Pass nothing to restore the site title.
 * Routes added later (upload, corner marking, results) should call this so the
 * browser tab tracks where the visitor actually is.
 */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · RacketIQ` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [title]);
}
