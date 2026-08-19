/**
 * The two legal pages App Review requires a subscription screen to link:
 * the Terms of Use (EULA) and the Privacy Policy. This is the ONE place they
 * are written down — nothing else in the app hard-codes a legal URL, and
 * LegalFooter.tsx renders LEGAL_LINKS as it finds it. Replacing the two `null`s
 * below with published https URLs is the WHOLE change: each row turns from
 * struck-through-and-inert into a live tappable link, and the "not published
 * yet" note removes itself (isPublished / hasUnpublishedLegalLink drive both).
 * Guideline 3.1.2 requires FUNCTIONAL links here, so tap both rows on the built
 * paywall before capturing screenshots — docs/legal/README.md §2.1.
 *
 * `url: null` means "not published yet" — the same convention the old Settings
 * LINKS rows used. The row still renders, visibly disabled, with a note, because
 * a link that silently goes nowhere is worse than no link at all: reviewers open
 * both of these, and daybot's listing URL landing on a login wall is exactly the
 * failure this convention exists to prevent.
 */

export interface LegalLink {
  /** Row label — also the wording App Review looks for. */
  label: string;
  /** Publicly reachable https URL, or null while the page is unpublished. */
  url: string | null;
}

// Published 2026-08-19 from docs/legal/ to the product's Static Web App
// (web/public/legal/, deployed by web/deploy-azure.sh — the same app that
// serves the marketing site's Azure copy). The azurestaticapps host rather
// than racquetiq.app because that domain currently fronts a separate Vercel
// deployment; move these when the domains are consolidated, and verify both
// in a private window after any change. No trailing slash — the CDN 308s the
// slash form.
export const TERMS_OF_USE: LegalLink = {
  label: "Terms of Use (EULA)",
  url: "https://kind-sea-0e4afca0f.7.azurestaticapps.net/legal/terms-of-use",
};
export const PRIVACY_POLICY: LegalLink = {
  label: "Privacy Policy",
  url: "https://kind-sea-0e4afca0f.7.azurestaticapps.net/legal/privacy-policy",
};

/** Both links, in the order the paywall shows them. */
export const LEGAL_LINKS: readonly LegalLink[] = [TERMS_OF_USE, PRIVACY_POLICY];

/**
 * True only for an absolute http(s) URL. Anything else — null, a relative path,
 * a half-pasted value — is treated as unpublished so the UI disables it rather
 * than handing a dead string to `Linking.openURL`. Never throws.
 */
export function isPublished(link: LegalLink): boolean {
  return typeof link.url === "string" && /^https?:\/\/\S+$/.test(link.url);
}

/** True while any legal page is still unpublished — drives the visible note. */
export function hasUnpublishedLegalLink(links: readonly LegalLink[] = LEGAL_LINKS): boolean {
  return links.some((link) => !isPublished(link));
}
