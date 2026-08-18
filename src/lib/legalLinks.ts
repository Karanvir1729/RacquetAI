/**
 * The two legal pages App Review requires a subscription screen to link:
 * the Terms of Use (EULA) and the Privacy Policy. This is the ONE place they
 * are written down — the paywall reads them, and filling them in at launch is
 * a single edit here (docs/07 §3 is the submission gate).
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

// TODO(launch): the pages are drafted in docs/legal/ and, once GitHub Pages is
// switched on for main + /docs, they will serve at:
//   https://karanvir1729.github.io/RacquetAI/legal/terms-of-use/
//   https://karanvir1729.github.io/RacquetAI/legal/privacy-policy/
// They stay null until that is actually true — see docs/legal/README.md, which
// still has TODO_OPERATOR_ placeholders to fill and Pages to enable. Paste the
// URLs in only after opening both in a private window.
export const TERMS_OF_USE: LegalLink = { label: "Terms of Use (EULA)", url: null };
export const PRIVACY_POLICY: LegalLink = { label: "Privacy Policy", url: null };

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
