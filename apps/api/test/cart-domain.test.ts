import { describe, expect, it } from "vitest";
import { allocate, mergeItems, shares, type AllocLine } from "../src/modules/cart/domain/cart.js";

const line = (qty: number, stock: Record<string, number>): AllocLine => ({ qty, available: new Map(Object.entries(stock)) });
const near = { id: "near", travelMinutes: 5 };
const far = { id: "far", travelMinutes: 12 };

describe("allocating a cart to warehouses", () => {
  it("sends everything to the nearest warehouse that has it all", () => {
    const lines = [line(2, { near: 5, far: 5 }), line(1, { near: 1, far: 9 })];
    expect(allocate(lines, [far, near], 2)).toEqual({ ok: true, groups: [{ warehouseId: "near", lines: [0, 1] }] });
  });
  it("uses a farther warehouse when the nearer one lacks the full quantity of a line", () => {
    const lines = [line(3, { near: 2, far: 9 }), line(1, { near: 1, far: 1 })];
    expect(allocate(lines, [near, far], 2)).toEqual({ ok: true, groups: [{ warehouseId: "far", lines: [0, 1] }] });
  });
  it("splits when no single warehouse covers everything, starting with the one covering most lines", () => {
    const lines = [line(1, { near: 1 }), line(1, { far: 1 }), line(1, { far: 1 })];
    expect(allocate(lines, [near, far], 2)).toEqual({ ok: true, groups: [{ warehouseId: "far", lines: [1, 2] }, { warehouseId: "near", lines: [0] }] });
  });
  it("prefers the nearer warehouse when both cover the same number of lines", () => {
    const lines = [line(1, { near: 1 }), line(1, { far: 1 })];
    expect(allocate(lines, [far, near], 2)).toEqual({ ok: true, groups: [{ warehouseId: "near", lines: [0] }, { warehouseId: "far", lines: [1] }] });
  });
  it("breaks a tie of distance by the warehouse id so the answer never changes", () => {
    const a = { id: "a", travelMinutes: 5 };
    const b = { id: "b", travelMinutes: 5 };
    expect(allocate([line(1, { a: 1, b: 1 })], [b, a], 2)).toEqual({ ok: true, groups: [{ warehouseId: "a", lines: [0] }] });
  });
  it("names the lines nobody can supply", () => {
    const lines = [line(1, { near: 1 }), line(1, {}), line(5, { near: 4 })];
    expect(allocate(lines, [near, far], 2)).toEqual({ ok: false, uncovered: [1, 2] });
  });
  it("fails when more deliveries are needed than allowed, naming the lines beyond the limit", () => {
    const a = { id: "a", travelMinutes: 1 };
    const b = { id: "b", travelMinutes: 2 };
    const c = { id: "c", travelMinutes: 3 };
    const lines = [line(1, { a: 1 }), line(1, { b: 1 }), line(1, { c: 1 })];
    expect(allocate(lines, [a, b, c], 2)).toEqual({ ok: false, uncovered: [2] });
    expect(allocate(lines, [a, b, c], 3).ok).toBe(true);
  });
  it("has nothing to allocate for no warehouses", () => {
    expect(allocate([line(1, {})], [], 2)).toEqual({ ok: false, uncovered: [0] });
  });
});

describe("pro-rata shares", () => {
  it("add up to the amount, with the odd paise on the first", () => {
    expect(shares(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares(500, [6400, 4600])).toEqual([291, 209].map((n, i) => (i === 0 ? n + (500 - 291 - 209) : n)));
    for (const amount of [0, 1, 7, 4000, 12345]) expect(shares(amount, [3, 5, 11]).reduce((a, b) => a + b, 0)).toBe(amount);
  });
  it("gives everything to the first when the weights are zero, and nothing for no deliveries", () => {
    expect(shares(90, [0, 0])).toEqual([90, 0]);
    expect(shares(90, [])).toEqual([]);
  });
});

describe("merging cart lines", () => {
  it("adds up repeats of the same variant and keeps order", () => {
    expect(mergeItems([{ productId: "p", variantId: "a", qty: 1 }, { productId: "p", variantId: "b", qty: 2 }, { productId: "p", variantId: "a", qty: 3 }]))
      .toEqual([{ productId: "p", variantId: "a", qty: 4 }, { productId: "p", variantId: "b", qty: 2 }]);
  });
});
