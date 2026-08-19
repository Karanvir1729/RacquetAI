/**
 * The login gate. Three states, and the one that breaks silently is the
 * first: while the persisted session is being restored the gate must hold a
 * BLANK cover — flashing the sign-in form at a signed-in user once per cold
 * start reads as being logged out.
 *
 * JS (createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AuthGateScreen, useAuthGate } from "../AuthGate";

const authState = { ready: false, session: null as object | null };

jest.mock("@/lib/auth", () => ({
  useAuthReady: () => authState.ready,
  useAuthSession: () => authState.session,
  isAppleSignInAvailable: async () => false,
  signInWithApple: async () => ({ status: "ok" }),
  signInWithEmail: async () => ({ status: "ok" }),
  signUpWithEmail: async () => ({ status: "ok" }),
  signOutUser: async () => {},
  getSession: () => authState.session,
  initAuth: () => {},
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

// AccountScreen pulls the billing client, which loads RevenueCat's guarded
// loader — irrelevant here and mocked away wholesale.
jest.mock("@/lib/subscription", () => ({
  useEntitlement: () => ({ status: "unknown" }),
  configure: () => false,
  refresh: async () => {},
}));

async function mount(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function Probe() {
  const gate = useAuthGate();
  return createElement("gate-probe" as never, { covered: gate.covered });
}

beforeEach(() => {
  authState.ready = false;
  authState.session = null;
});

describe("the gate's three states", () => {
  it("covers with a blank canvas while the session is being restored", async () => {
    const tree = await mount(createElement(AuthGateScreen));
    // No sign-in form yet: the user may well BE signed in.
    expect(text(tree)).not.toContain("Email");
    expect(text(tree)).not.toContain("Sign in");
  });

  it("shows the one sign-in card once restore says signed out", async () => {
    authState.ready = true;
    const tree = await mount(createElement(AuthGateScreen));
    const rendered = text(tree);
    expect(rendered).toContain("RacquetIQ");
    expect(rendered).toContain("Email");
    expect(rendered).toContain("Password");
    expect(rendered).toContain("Create an account");
  });

  it("stays covered until there is both a restore and a session", async () => {
    let probe = await mount(createElement(Probe));
    expect(probe.root.findByType("gate-probe" as never).props.covered).toBe(true);

    authState.ready = true;
    probe = await mount(createElement(Probe));
    expect(probe.root.findByType("gate-probe" as never).props.covered).toBe(true);

    authState.session = { user: { email: "k@example.test" } };
    probe = await mount(createElement(Probe));
    expect(probe.root.findByType("gate-probe" as never).props.covered).toBe(false);
  });
});
