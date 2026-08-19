/**
 * The video attached to an analysis, and the one way it goes missing while the
 * file is still there.
 *
 * `<id>.video.json` stores an ABSOLUTE `file://` path into the app's sandbox,
 * and iOS mints a new container UUID on reinstall and on restore from a
 * backup. The clip does not move — the directory it lives in changes name —
 * so a reader that only checks the stored path reports "no video" for footage
 * sitting right next to the analysis that describes it. This pins the recovery.
 */
import { readAnalysisVideoRef, writeAnalysisVideoRef } from "../analysisVideo";

jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  const DIR = "file:///documents/recordings/";
  class MockFile {
    readonly uri: string;
    constructor(parent: unknown, name?: string) {
      const base = typeof parent === "string" ? parent : ((parent as { uri: string })?.uri ?? "");
      this.uri = name === undefined ? base : `${base}${name}`;
    }
    get exists(): boolean {
      return store.has(this.uri);
    }
    create(): void {
      if (!store.has(this.uri)) store.set(this.uri, "");
    }
    write(text: string): void {
      store.set(this.uri, text);
    }
    textSync(): string {
      const text = store.get(this.uri);
      if (text === undefined) throw new Error(`no such file: ${this.uri}`);
      return text;
    }
    delete(): void {
      store.delete(this.uri);
    }
  }
  class MockDirectory {
    readonly uri = DIR;
    get exists(): boolean {
      return true;
    }
    create(): void {}
  }
  return { File: MockFile, Directory: MockDirectory, Paths: { document: "file:///documents/" }, __store: store, __DIR: DIR };
});

jest.mock("@/lib/recordingsDir", () => {
  const { Directory } = jest.requireMock("expo-file-system") as { Directory: new () => object };
  return { recordingsDirectory: () => new Directory() };
});

const { __store: store, __DIR: DIR } = jest.requireMock("expo-file-system") as {
  __store: Map<string, string>;
  __DIR: string;
};

const ID = "imp-20260817-233000-good";
const CLIP = `${DIR}${ID}.video.mp4`;

beforeEach(() => {
  store.clear();
});

describe("readAnalysisVideoRef", () => {
  it("returns the stored path when the clip is where it says", () => {
    store.set(CLIP, "video-bytes");
    writeAnalysisVideoRef(ID, CLIP);
    expect(readAnalysisVideoRef(ID)).toBe(CLIP);
  });

  it("recovers a clip whose container UUID has changed under it", () => {
    // What a reinstall leaves behind: the ref points into the OLD container,
    // the file is in the current one under the same name.
    const stale =
      "file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/recordings/" +
      `${ID}.video.mp4`;
    store.set(CLIP, "video-bytes");
    writeAnalysisVideoRef(ID, stale);

    expect(readAnalysisVideoRef(ID)).toBe(CLIP);
  });

  it("heals the ref, so the recovery happens once and not on every read", () => {
    const stale = `file:///old/Documents/recordings/${ID}.video.mp4`;
    store.set(CLIP, "video-bytes");
    writeAnalysisVideoRef(ID, stale);
    readAnalysisVideoRef(ID);

    expect(JSON.parse(store.get(`${DIR}${ID}.video.json`) ?? "{}")).toEqual({ videoUri: CLIP });
  });

  it("still reports no video when the clip is genuinely gone", () => {
    // A purge or a manual delete: nothing by that name in the directory
    // either, so there is nothing to recover and a player must not be offered.
    writeAnalysisVideoRef(ID, `file:///old/Documents/recordings/${ID}.video.mp4`);
    expect(readAnalysisVideoRef(ID)).toBeNull();
  });

  it("reports no video for a missing, empty or malformed ref", () => {
    expect(readAnalysisVideoRef(ID)).toBeNull();

    store.set(`${DIR}${ID}.video.json`, "{{{");
    expect(readAnalysisVideoRef(ID)).toBeNull();

    store.set(`${DIR}${ID}.video.json`, JSON.stringify({ videoUri: "" }));
    expect(readAnalysisVideoRef(ID)).toBeNull();

    store.set(`${DIR}${ID}.video.json`, JSON.stringify({ videoUri: 42 }));
    expect(readAnalysisVideoRef(ID)).toBeNull();
  });

  it("passes a non-file uri through untouched", () => {
    // A remote clip has no local existence to check and no filename to
    // recover; it is the server's problem, not this reader's.
    const remote = "https://example.test/match.mp4";
    writeAnalysisVideoRef(ID, remote);
    expect(readAnalysisVideoRef(ID)).toBe(remote);
  });
});
