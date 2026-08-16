import { containRect, normalizedToView, tapToNormalized, type Size } from "../letterbox";

/**
 * Two canonical letterbox shapes:
 * - a WIDE 16:9 frame in a tall (portrait phone) box → bars top and bottom
 * - a TALL 9:16 frame in a wide box → bars left and right
 * The numbers are chosen so every expected value is exact in binary-friendly
 * fractions of the 0.1875 scale factor.
 */
const WIDE_IMAGE: Size = { width: 1600, height: 900 };
const TALL_IMAGE: Size = { width: 900, height: 1600 };
const PORTRAIT_BOX: Size = { width: 300, height: 600 };
const LANDSCAPE_BOX: Size = { width: 600, height: 300 };

describe("containRect", () => {
  it("letterboxes a wide image top and bottom in a tall container", () => {
    // scale = min(300/1600, 600/900) = 0.1875 → drawn 300 x 168.75, centred vertically
    expect(containRect(PORTRAIT_BOX, WIDE_IMAGE)).toEqual({
      x: 0,
      y: 215.625,
      width: 300,
      height: 168.75,
    });
  });

  it("letterboxes a tall image left and right in a wide container", () => {
    expect(containRect(LANDSCAPE_BOX, TALL_IMAGE)).toEqual({
      x: 215.625,
      y: 0,
      width: 168.75,
      height: 300,
    });
  });

  it("fills exactly when aspect ratios match", () => {
    expect(containRect({ width: 400, height: 225 }, WIDE_IMAGE)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 225,
    });
  });

  it("returns null for degenerate container or image sizes", () => {
    expect(containRect({ width: 0, height: 600 }, WIDE_IMAGE)).toBeNull();
    expect(containRect(PORTRAIT_BOX, { width: 1600, height: 0 })).toBeNull();
    expect(containRect(PORTRAIT_BOX, { width: -1, height: 900 })).toBeNull();
  });
});

describe("tapToNormalized — wide image, bars top/bottom", () => {
  it("maps the drawn image's corners to normalized 0/1 (edges inclusive)", () => {
    expect(tapToNormalized({ x: 0, y: 215.625 }, PORTRAIT_BOX, WIDE_IMAGE)).toEqual({ x: 0, y: 0 });
    expect(tapToNormalized({ x: 300, y: 384.375 }, PORTRAIT_BOX, WIDE_IMAGE)).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("maps the container centre to the image centre", () => {
    expect(tapToNormalized({ x: 150, y: 300 }, PORTRAIT_BOX, WIDE_IMAGE)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("rejects taps in the top and bottom bars", () => {
    expect(tapToNormalized({ x: 150, y: 100 }, PORTRAIT_BOX, WIDE_IMAGE)).toBeNull();
    expect(tapToNormalized({ x: 150, y: 500 }, PORTRAIT_BOX, WIDE_IMAGE)).toBeNull();
  });
});

describe("tapToNormalized — tall image, bars left/right", () => {
  it("maps the drawn image's corners to normalized 0/1", () => {
    expect(tapToNormalized({ x: 215.625, y: 0 }, LANDSCAPE_BOX, TALL_IMAGE)).toEqual({
      x: 0,
      y: 0,
    });
    expect(tapToNormalized({ x: 384.375, y: 300 }, LANDSCAPE_BOX, TALL_IMAGE)).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("rejects taps in the left and right bars", () => {
    expect(tapToNormalized({ x: 100, y: 150 }, LANDSCAPE_BOX, TALL_IMAGE)).toBeNull();
    expect(tapToNormalized({ x: 500, y: 150 }, LANDSCAPE_BOX, TALL_IMAGE)).toBeNull();
  });

  it("returns null when geometry is degenerate", () => {
    expect(tapToNormalized({ x: 10, y: 10 }, { width: 0, height: 0 }, TALL_IMAGE)).toBeNull();
  });
});

describe("normalizedToView", () => {
  it("is the inverse of tapToNormalized inside the drawn image", () => {
    const tap = { x: 212, y: 250 };
    const normalized = tapToNormalized(tap, PORTRAIT_BOX, WIDE_IMAGE);
    expect(normalized).not.toBeNull();
    const view = normalizedToView(normalized as { x: number; y: number }, PORTRAIT_BOX, WIDE_IMAGE);
    expect(view?.x).toBeCloseTo(tap.x, 10);
    expect(view?.y).toBeCloseTo(tap.y, 10);
  });

  it("places normalized corners on the drawn image's corners", () => {
    expect(normalizedToView({ x: 0, y: 0 }, LANDSCAPE_BOX, TALL_IMAGE)).toEqual({
      x: 215.625,
      y: 0,
    });
    expect(normalizedToView({ x: 1, y: 1 }, LANDSCAPE_BOX, TALL_IMAGE)).toEqual({
      x: 384.375,
      y: 300,
    });
  });
});
