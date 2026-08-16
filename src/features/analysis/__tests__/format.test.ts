import { cellLabel, formatCount, formatPercent, heatOpacity, prettyPattern } from "../format";

describe("formatPercent", () => {
  it("renders a fraction as a whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.62)).toBe("62%");
    expect(formatPercent(0.874)).toBe("87%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("clamps garbage into 0–100%", () => {
    expect(formatPercent(-0.2)).toBe("0%");
    expect(formatPercent(1.4)).toBe("100%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("formatCount", () => {
  it("groups thousands with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(41)).toBe("41");
    expect(formatCount(5520)).toBe("5,520");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("rounds fractions and clamps garbage to zero", () => {
    expect(formatCount(5519.6)).toBe("5,520");
    expect(formatCount(-3)).toBe("0");
    expect(formatCount(Number.NaN)).toBe("0");
  });
});

describe("cellLabel", () => {
  it("labels every court quadrant", () => {
    expect(cellLabel("frontLeft")).toBe("Front left");
    expect(cellLabel("frontRight")).toBe("Front right");
    expect(cellLabel("backLeft")).toBe("Back left");
    expect(cellLabel("backRight")).toBe("Back right");
  });
});

describe("prettyPattern", () => {
  it("prettifies the pipeline's machine cell names in place", () => {
    expect(prettyPattern("backLeft -> frontRight (41%)")).toBe("Back left -> Front right (41%)");
    expect(prettyPattern("backRight -> backLeft (33%)")).toBe("Back right -> Back left (33%)");
  });

  it("passes unknown text through untouched", () => {
    expect(prettyPattern("midCourt -> nowhere (9%)")).toBe("midCourt -> nowhere (9%)");
    expect(prettyPattern("")).toBe("");
  });
});

describe("heatOpacity", () => {
  it("maps 0..1 coverage onto the visible opacity ramp", () => {
    expect(heatOpacity(0)).toBeCloseTo(0.05);
    expect(heatOpacity(0.5)).toBeCloseTo(0.15 + 0.85 * Math.sqrt(0.5));
    expect(heatOpacity(1)).toBeCloseTo(1);
  });

  it("clamps garbage to the floor and ceiling", () => {
    expect(heatOpacity(-1)).toBeCloseTo(0.05);
    expect(heatOpacity(2)).toBeCloseTo(1);
    expect(heatOpacity(Number.NaN)).toBeCloseTo(0.05);
  });
});
