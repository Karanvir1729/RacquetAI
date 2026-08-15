import { formatBytes, formatClock } from "../format";

describe("formatClock", () => {
  it("renders sub-minute durations", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7)).toBe("0:07");
  });

  it("renders minutes without hour padding", () => {
    expect(formatClock(754)).toBe("12:34");
  });

  it("pads minutes once an hour is present", () => {
    expect(formatClock(3723)).toBe("1:02:03");
  });

  it("floors fractional seconds and clamps garbage to 0:00", () => {
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});

describe("formatBytes", () => {
  it("keeps sub-KB values in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("uses one decimal from KB up", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(3.4 * 1024 ** 3)).toBe("3.4 GB");
  });

  it("clamps garbage to zero", () => {
    expect(formatBytes(-100)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
