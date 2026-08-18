/**
 * The store boundary. Behind these functions sits RevenueCat's native SDK via
 * lib/subscription.ts, so the contract is: anything it resolves with, rejects
 * with, or returns as junk becomes an outcome — never a throw, and never a claim
 * that money changed hands that the entitlement can't back up.
 *
 * The result shapes exercised here are lib/subscription.ts's real PurchaseResult
 * and RestoreResult unions, plus the junk a drifting or replaced store module
 * could hand over.
 */
import {
  narrowPurchaseOutcome,
  narrowRestoreOutcome,
  purchaseOutcomeFromError,
  restoreOutcomeFromError,
  runPurchase,
  runRestore,
} from "../subscriptionApi";

describe("narrowPurchaseOutcome", () => {
  it("reads an explicit status", () => {
    expect(narrowPurchaseOutcome({ status: "purchased" })).toEqual({ status: "purchased" });
    expect(narrowPurchaseOutcome({ status: "cancelled" })).toEqual({ status: "cancelled" });
    expect(narrowPurchaseOutcome({ status: "unavailable" })).toEqual({ status: "unavailable" });
  });

  it("treats RevenueCat's userCancelled flag as a cancel", () => {
    expect(narrowPurchaseOutcome({ userCancelled: true })).toEqual({ status: "cancelled" });
    expect(narrowPurchaseOutcome({ cancelled: true })).toEqual({ status: "cancelled" });
    expect(narrowPurchaseOutcome(false)).toEqual({ status: "cancelled" });
  });

  it("shows the store module's own sentence verbatim, not nested inside ours", () => {
    // lib/subscription.ts already writes its failures for the user; wrapping
    // one in a second apology reads as two errors for a single problem.
    expect(
      narrowPurchaseOutcome({
        status: "failed",
        message: "That subscription isn't available from the App Store right now.",
      }),
    ).toEqual({
      status: "failed",
      message: "That subscription isn't available from the App Store right now.",
    });
  });

  it("falls back to our copy when a failure carries no message", () => {
    expect(narrowPurchaseOutcome({ status: "failed" })).toEqual({
      status: "failed",
      message: "The purchase couldn't be completed. Your Apple ID has not been charged.",
    });
  });

  it("reads an error-shaped result", () => {
    expect(narrowPurchaseOutcome({ error: new Error("network down") })).toEqual({
      status: "failed",
      message: expect.stringContaining("network down"),
    });
  });

  it("falls back to purchased for an unrecognised resolve, not to a false error", () => {
    // Resolve-means-success is the common convention, and the entitlement — not
    // this value — decides what the user actually owns. Guessing "failed" would
    // show an error to someone who just paid.
    expect(narrowPurchaseOutcome(undefined)).toEqual({ status: "purchased" });
    expect(narrowPurchaseOutcome({ customerInfo: {}, productIdentifier: "x" })).toEqual({
      status: "purchased",
    });
    expect(narrowPurchaseOutcome(true)).toEqual({ status: "purchased" });
  });
});

describe("purchaseOutcomeFromError", () => {
  it("is silent for a user-dismissed sheet", () => {
    expect(purchaseOutcomeFromError({ userCancelled: true })).toEqual({ status: "cancelled" });
  });

  it("wraps a thrown message in copy written for the user", () => {
    const outcome = purchaseOutcomeFromError(new Error("StoreKit error 2"));
    expect(outcome).toEqual({
      status: "failed",
      message: expect.stringContaining("StoreKit error 2"),
    });
  });

  it("survives a throw with nothing useful in it", () => {
    expect(purchaseOutcomeFromError(undefined)).toEqual({
      status: "failed",
      message: "The purchase couldn't be completed. Your Apple ID has not been charged.",
    });
    expect(purchaseOutcomeFromError(new Error("   "))).toEqual({
      status: "failed",
      message: expect.not.stringContaining("("),
    });
  });
});

describe("narrowRestoreOutcome", () => {
  it("reads the shapes a restore might plausibly return", () => {
    expect(narrowRestoreOutcome(true)).toEqual({ status: "restored" });
    expect(narrowRestoreOutcome("pro")).toEqual({ status: "restored" });
    expect(narrowRestoreOutcome({ entitlement: "pro" })).toEqual({ status: "restored" });
    expect(narrowRestoreOutcome({ isActive: true })).toEqual({ status: "restored" });
    expect(narrowRestoreOutcome({ status: "restored" })).toEqual({ status: "restored" });
  });

  it("reads a nothing-to-restore result", () => {
    expect(narrowRestoreOutcome(false)).toEqual({ status: "none" });
    expect(narrowRestoreOutcome("free")).toEqual({ status: "none" });
    expect(narrowRestoreOutcome({ entitlement: "free" })).toEqual({ status: "none" });
    expect(narrowRestoreOutcome({ isActive: false })).toEqual({ status: "none" });
  });

  it("says 'completed', never 'restored', when the result is unreadable", () => {
    // Telling someone their subscription is back when it may not be is the one
    // lie a restore button must not tell.
    expect(narrowRestoreOutcome(undefined)).toEqual({ status: "completed" });
    expect(narrowRestoreOutcome({ customerInfo: {} })).toEqual({ status: "completed" });
    expect(narrowRestoreOutcome("something else")).toEqual({ status: "completed" });
  });

  it("turns a rejection into a failure message", () => {
    expect(restoreOutcomeFromError(new Error("offline"))).toEqual({
      status: "failed",
      message: expect.stringContaining("offline"),
    });
  });
});

describe("the shapes lib/subscription.ts actually returns today", () => {
  it("maps every PurchaseResult variant", () => {
    expect(narrowPurchaseOutcome({ status: "purchased", entitlement: "pro" })).toEqual({
      status: "purchased",
    });
    expect(narrowPurchaseOutcome({ status: "cancelled" })).toEqual({ status: "cancelled" });
    expect(narrowPurchaseOutcome({ status: "unavailable", message: "no key" })).toEqual({
      status: "unavailable",
    });
    expect(narrowPurchaseOutcome({ status: "failed", message: "declined" })).toEqual({
      status: "failed",
      message: "declined",
    });
  });

  it("maps every RestoreResult variant", () => {
    expect(narrowRestoreOutcome({ status: "restored" })).toEqual({ status: "restored" });
    expect(narrowRestoreOutcome({ status: "none" })).toEqual({ status: "none" });
    expect(narrowRestoreOutcome({ status: "unavailable", message: "no key" })).toEqual({
      status: "unavailable",
    });
    expect(
      narrowRestoreOutcome({ status: "failed", message: "Couldn't read your purchases." }),
    ).toEqual({ status: "failed", message: "Couldn't read your purchases." });
  });
});

describe("runPurchase / runRestore", () => {
  it("passes the product id through", async () => {
    const purchase = jest.fn().mockResolvedValue({ status: "purchased" });
    await expect(runPurchase(purchase, "racquetiq_pro_yearly")).resolves.toEqual({
      status: "purchased",
    });
    expect(purchase).toHaveBeenCalledWith("racquetiq_pro_yearly");
  });

  it("catches a rejection", async () => {
    const purchase = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(runPurchase(purchase, "x")).resolves.toEqual({
      status: "failed",
      message: expect.stringContaining("boom"),
    });
  });

  it("catches a SYNCHRONOUS throw — the missing-native-module case", async () => {
    // A bare `import Purchases from "react-native-purchases"` that failed to
    // link throws the moment it is touched. That must not escape as a crash.
    const purchase = jest.fn(() => {
      throw new Error("Cannot find native module 'RNPurchases'");
    });
    await expect(runPurchase(purchase, "x")).resolves.toEqual({
      status: "failed",
      message: expect.stringContaining("RNPurchases"),
    });
  });

  it("catches a synchronous throw from restore too", async () => {
    const restore = jest.fn(() => {
      throw new Error("not configured");
    });
    await expect(runRestore(restore)).resolves.toEqual({
      status: "failed",
      message: expect.stringContaining("not configured"),
    });
  });
});
