import {
  analysisUrl,
  cornersBody,
  cornersUrl,
  frameUrl,
  jobsUrl,
  jobUrl,
  normalizeBaseUrl,
  parseJobCreated,
  parseJobStatus,
  videoMimeType,
  type CourtCorners,
} from "../jobContract";

describe("normalizeBaseUrl", () => {
  it("keeps a clean URL as-is", () => {
    expect(normalizeBaseUrl("http://localhost:8082")).toBe("http://localhost:8082");
    expect(normalizeBaseUrl("https://analysis.example.com")).toBe("https://analysis.example.com");
  });

  it("trims whitespace and strips trailing slashes", () => {
    expect(normalizeBaseUrl("  http://localhost:8082/  ")).toBe("http://localhost:8082");
    expect(normalizeBaseUrl("http://192.168.1.20:8082///")).toBe("http://192.168.1.20:8082");
  });

  it("defaults a missing scheme to http:// (LAN IP entry)", () => {
    expect(normalizeBaseUrl("192.168.1.20:8082")).toBe("http://192.168.1.20:8082");
  });

  it("allows a path prefix for proxied servers", () => {
    expect(normalizeBaseUrl("https://example.com/racquet/")).toBe("https://example.com/racquet");
  });

  it("rejects empty and degenerate input", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl("http://")).toBeNull();
    expect(normalizeBaseUrl("not a url")).toBeNull();
    expect(normalizeBaseUrl("ftp://example.com")).toBeNull();
  });
});

describe("endpoint builders", () => {
  const base = "http://localhost:8082";

  it("builds the five contract endpoints", () => {
    expect(jobsUrl(base)).toBe("http://localhost:8082/jobs");
    expect(jobUrl(base, "j1")).toBe("http://localhost:8082/jobs/j1");
    expect(frameUrl(base, "j1")).toBe("http://localhost:8082/jobs/j1/frame.jpg");
    expect(cornersUrl(base, "j1")).toBe("http://localhost:8082/jobs/j1/corners");
    expect(analysisUrl(base, "j1")).toBe("http://localhost:8082/jobs/j1/analysis.json");
  });

  it("URL-encodes hostile job ids", () => {
    expect(jobUrl(base, "a/../b")).toBe("http://localhost:8082/jobs/a%2F..%2Fb");
  });
});

describe("parseJobCreated", () => {
  it("reads the job id", () => {
    expect(parseJobCreated('{"jobId":"abc123"}')).toBe("abc123");
  });

  it("rejects malformed bodies", () => {
    expect(parseJobCreated("not json")).toBeNull();
    expect(parseJobCreated("[]")).toBeNull();
    expect(parseJobCreated("{}")).toBeNull();
    expect(parseJobCreated('{"jobId":""}')).toBeNull();
    expect(parseJobCreated('{"jobId":42}')).toBeNull();
  });
});

describe("parseJobStatus", () => {
  it("reads every contract status", () => {
    for (const status of ["queued", "preparing", "corners_needed", "analyzing", "done", "error"]) {
      expect(parseJobStatus(`{"status":"${status}","progressPct":null,"message":null}`)).toEqual({
        status,
        progressPct: null,
        message: null,
      });
    }
  });

  it("keeps progress and message when present, clamping progress into 0..100", () => {
    expect(parseJobStatus('{"status":"analyzing","progressPct":41.5,"message":"pass 2"}')).toEqual({
      status: "analyzing",
      progressPct: 41.5,
      message: "pass 2",
    });
    expect(parseJobStatus('{"status":"analyzing","progressPct":150}')?.progressPct).toBe(100);
    expect(parseJobStatus('{"status":"analyzing","progressPct":-5}')?.progressPct).toBe(0);
  });

  it("degrades advisory fields to null instead of failing", () => {
    expect(parseJobStatus('{"status":"queued"}')).toEqual({
      status: "queued",
      progressPct: null,
      message: null,
    });
    expect(parseJobStatus('{"status":"queued","progressPct":"41","message":""}')).toEqual({
      status: "queued",
      progressPct: null,
      message: null,
    });
  });

  it("rejects unknown statuses and malformed bodies", () => {
    expect(parseJobStatus('{"status":"exploded"}')).toBeNull();
    expect(parseJobStatus("{}")).toBeNull();
    expect(parseJobStatus("not json")).toBeNull();
    expect(parseJobStatus("[]")).toBeNull();
  });
});

describe("cornersBody", () => {
  const corners: CourtCorners = {
    frontLeft: { x: 0.1, y: 0.9 },
    frontRight: { x: 0.9, y: 0.9 },
    backLeft: { x: 0.25, y: 0.5 },
    backRight: { x: 0.75, y: 0.5 },
  };

  it("serializes the contract shape with [nx, ny] arrays", () => {
    expect(JSON.parse(cornersBody(corners))).toEqual({
      frontLeft: [0.1, 0.9],
      frontRight: [0.9, 0.9],
      backLeft: [0.25, 0.5],
      backRight: [0.75, 0.5],
    });
  });

  it("rounds to 4 decimals and clamps into 0..1", () => {
    const parsed = JSON.parse(
      cornersBody({
        ...corners,
        frontLeft: { x: 0.123456, y: 1.2 },
        backRight: { x: -0.01, y: 0.99995 },
      }),
    ) as Record<string, [number, number]>;
    expect(parsed.frontLeft).toEqual([0.1235, 1]);
    expect(parsed.backRight).toEqual([0, 1]);
  });
});

describe("videoMimeType", () => {
  it("maps mov to quicktime and everything else to mp4", () => {
    expect(videoMimeType("file:///tmp/match.mov")).toBe("video/quicktime");
    expect(videoMimeType("file:///tmp/MATCH.MOV")).toBe("video/quicktime");
    expect(videoMimeType("file:///tmp/match.mov?cache=1")).toBe("video/quicktime");
    expect(videoMimeType("file:///tmp/match.mp4")).toBe("video/mp4");
    expect(videoMimeType("file:///tmp/match")).toBe("video/mp4");
  });
});
