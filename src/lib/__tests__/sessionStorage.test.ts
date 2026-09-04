/**
 * The session storage adapter's one hard rule: clearing some other key must
 * never clear the session.
 *
 * The adapter used to ignore the key and point every slot at one file, so
 * auth-js tidying up its PKCE slot — `removeItem("<storageKey>-code-verifier")`,
 * which it does on any failed user write — deleted the live session instead.
 * That fires on the Apple signup path in particular, because it is the only
 * flow that writes to the user right after the session is created.
 */

const mockFiles = new Map<string, string>();

jest.mock("expo-file-system", () => ({
  Paths: { document: "/documents" },
  File: class {
    private readonly path: string;
    constructor(_dir: string, name: string) {
      this.path = name;
    }
    get exists(): boolean {
      return mockFiles.has(this.path);
    }
    textSync(): string {
      return mockFiles.get(this.path) ?? "";
    }
    write(value: string): void {
      mockFiles.set(this.path, value);
    }
    delete(): void {
      mockFiles.delete(this.path);
    }
  },
}));

// The client is constructed at import time; capture the storage it was handed.
type Storage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};
let storage!: Storage;
let storageKey!: string;

jest.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: { auth: Record<string, unknown> }) => {
    storage = options.auth.storage as Storage;
    storageKey = options.auth.storageKey as string;
    return {};
  },
}));

beforeEach(() => {
  mockFiles.clear();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../supabaseClient");
});

it("keeps the session on its historical filename, so upgrading signs nobody out", () => {
  storage.setItem(storageKey, "the-session");
  expect(mockFiles.get("auth-session.json")).toBe("the-session");
});

it("survives auth-js clearing its PKCE slot", () => {
  storage.setItem(storageKey, "the-session");
  // Exactly what auth-js does when a user write fails.
  storage.removeItem(`${storageKey}-code-verifier`);
  expect(storage.getItem(storageKey)).toBe("the-session");
});

it("does not let one key read another's value", () => {
  storage.setItem(storageKey, "the-session");
  expect(storage.getItem(`${storageKey}-code-verifier`)).toBeNull();
});

it("still clears the session when the session key itself is removed", () => {
  storage.setItem(storageKey, "the-session");
  storage.removeItem(storageKey);
  expect(storage.getItem(storageKey)).toBeNull();
});

it("reads a missing slot as signed out rather than throwing", () => {
  expect(storage.getItem(storageKey)).toBeNull();
});
