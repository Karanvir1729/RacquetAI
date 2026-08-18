/**
 * The legal links App Review opens. The rule this file protects: a link is
 * either a real absolute URL or it is visibly disabled — the paywall must never
 * hand `Linking.openURL` a half-filled placeholder.
 */
import {
  hasUnpublishedLegalLink,
  isPublished,
  LEGAL_LINKS,
  PRIVACY_POLICY,
  TERMS_OF_USE,
  type LegalLink,
} from "../legalLinks";

const live = (url: string): LegalLink => ({ label: "x", url });

describe("isPublished", () => {
  it("accepts an absolute http(s) URL", () => {
    expect(isPublished(live("https://racquetiq.app/terms"))).toBe(true);
    expect(isPublished(live("http://racquetiq.app/privacy"))).toBe(true);
  });

  it("rejects an unfilled or half-filled placeholder", () => {
    expect(isPublished({ label: "x", url: null })).toBe(false);
    expect(isPublished(live(""))).toBe(false);
    expect(isPublished(live("   "))).toBe(false);
    expect(isPublished(live("racquetiq.app/terms"))).toBe(false);
    expect(isPublished(live("/terms"))).toBe(false);
    expect(isPublished(live("TODO"))).toBe(false);
  });
});

describe("hasUnpublishedLegalLink", () => {
  it("is true while any page is still missing", () => {
    expect(hasUnpublishedLegalLink([live("https://a.test"), { label: "b", url: null }])).toBe(true);
  });

  it("is false once both are live — the note disappears on its own", () => {
    expect(hasUnpublishedLegalLink([live("https://a.test"), live("https://b.test")])).toBe(false);
  });
});

describe("LEGAL_LINKS", () => {
  it("ships both links Apple requires on a subscription screen", () => {
    expect(LEGAL_LINKS).toEqual([TERMS_OF_USE, PRIVACY_POLICY]);
    expect(TERMS_OF_USE.label).toMatch(/terms of use/i);
    expect(TERMS_OF_USE.label).toMatch(/eula/i);
    expect(PRIVACY_POLICY.label).toMatch(/privacy policy/i);
  });
});
