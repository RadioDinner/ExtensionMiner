import { describe, expect, it, vi } from "vitest";

// order-store imports the polyfill for its storage wrappers; the pure merge/union
// helpers under test never touch it, but the import must not throw at load.
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
}));

import {
  emptyStore,
  forgetAccount,
  mergeAccountOrders,
  orderKey,
  parseOrderStore,
  summarizeAccounts,
  unionOrders,
} from "../src/shared/order-store";
import type { AmazonOrderLite } from "../src/shared/messages";

function order(id: string, cents: number, over: Partial<AmazonOrderLite> = {}): AmazonOrderLite {
  return { orderId: id, date: "2026-06-01", totalCents: cents, itemTitles: ["Thing"], ...over };
}

describe("orderKey", () => {
  it("uses the order id, falling back to date|total|item", () => {
    expect(orderKey(order("111-2222222-3333333", 100))).toBe("111-2222222-3333333");
    expect(orderKey({ orderId: "", date: "2026-06-01", totalCents: 100, itemTitles: ["A"] })).toBe(
      "2026-06-01|100|A",
    );
  });
});

describe("mergeAccountOrders", () => {
  it("adds a new account bucket and tags orders with the account", () => {
    const s = mergeAccountOrders(emptyStore(), "Derrick", [order("o1", 100)], 1000);
    expect(Object.keys(s.accounts)).toEqual(["Derrick"]);
    expect(s.accounts["Derrick"]!.orders[0]!.account).toBe("Derrick");
    expect(s.accounts["Derrick"]!.lastSync).toBe(1000);
  });

  it("UNIONs across re-syncs — a shallow re-sync never drops earlier orders", () => {
    let s = mergeAccountOrders(emptyStore(), "Derrick", [order("old", 100), order("mid", 200)], 1);
    // A later (shallow) sync returns only the most recent order.
    s = mergeAccountOrders(s, "Derrick", [order("new", 300)], 2);
    const ids = s.accounts["Derrick"]!.orders.map((o) => o.orderId).sort();
    expect(ids).toEqual(["mid", "new", "old"]);
    expect(s.accounts["Derrick"]!.lastSync).toBe(2);
  });

  it("keeps a return hint once seen, even if a later scrape lacks it", () => {
    let s = mergeAccountOrders(emptyStore(), "D", [order("o1", 100, { returnHint: true })], 1);
    s = mergeAccountOrders(s, "D", [order("o1", 100, { returnHint: false })], 2);
    expect(s.accounts["D"]!.orders[0]!.returnHint).toBe(true);
  });

  it("keeps separate buckets per account", () => {
    let s = mergeAccountOrders(emptyStore(), "Derrick", [order("d1", 100)], 1);
    s = mergeAccountOrders(s, "Sarah", [order("s1", 200)], 2);
    expect(Object.keys(s.accounts).sort()).toEqual(["Derrick", "Sarah"]);
  });
});

describe("unionOrders", () => {
  it("flattens all accounts' orders", () => {
    let s = mergeAccountOrders(emptyStore(), "Derrick", [order("d1", 100)], 1);
    s = mergeAccountOrders(s, "Sarah", [order("s1", 200)], 2);
    expect(unionOrders(s).map((o) => o.orderId).sort()).toEqual(["d1", "s1"]);
  });

  it("dedupes a shared key across accounts, keeping a return hint", () => {
    let s = mergeAccountOrders(emptyStore(), "A", [{ orderId: "", date: "2026-06-01", totalCents: 100, itemTitles: ["X"], returnHint: true }], 1);
    s = mergeAccountOrders(s, "B", [{ orderId: "", date: "2026-06-01", totalCents: 100, itemTitles: ["X"] }], 2);
    const u = unionOrders(s);
    expect(u).toHaveLength(1);
    expect(u[0]!.returnHint).toBe(true);
  });
});

describe("summarizeAccounts", () => {
  it("marks the active account and sorts it first, then by recency", () => {
    let s = mergeAccountOrders(emptyStore(), "Derrick", [order("d1", 100)], 100);
    s = mergeAccountOrders(s, "Sarah", [order("s1", 200), order("s2", 300)], 200);
    const sum = summarizeAccounts(s, "Derrick");
    expect(sum.map((a) => a.label)).toEqual(["Derrick", "Sarah"]); // active first
    expect(sum[0]).toMatchObject({ label: "Derrick", count: 1, active: true });
    expect(sum[1]).toMatchObject({ label: "Sarah", count: 2, active: false });
  });

  it("with no active account, sorts by most-recent sync", () => {
    let s = mergeAccountOrders(emptyStore(), "Old", [order("o", 1)], 100);
    s = mergeAccountOrders(s, "New", [order("n", 1)], 999);
    expect(summarizeAccounts(s, null).map((a) => a.label)).toEqual(["New", "Old"]);
  });
});

describe("forgetAccount / parseOrderStore", () => {
  it("drops just the named account", () => {
    let s = mergeAccountOrders(emptyStore(), "Derrick", [order("d1", 100)], 1);
    s = mergeAccountOrders(s, "Sarah", [order("s1", 200)], 2);
    s = forgetAccount(s, "Sarah");
    expect(Object.keys(s.accounts)).toEqual(["Derrick"]);
  });

  it("coerces garbage into an empty store", () => {
    expect(parseOrderStore(null)).toEqual(emptyStore());
    expect(parseOrderStore("nope")).toEqual(emptyStore());
    expect(parseOrderStore({ accounts: "bad" })).toEqual(emptyStore());
  });

  it("round-trips a valid store", () => {
    const s = mergeAccountOrders(emptyStore(), "Derrick", [order("d1", 100)], 5);
    expect(parseOrderStore(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
