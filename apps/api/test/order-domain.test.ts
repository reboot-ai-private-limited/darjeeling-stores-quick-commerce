import { describe, expect, it } from "vitest";
import { createCodeBox, newCode, refundOnCancel, sameCode } from "../src/modules/orders/application/order-core.js";
import { ACTIVE_BEFORE_PICKUP, CANCELLABLE, CUSTOMER_CANCELLABLE, LEGAL, TERMINAL, groupStatusOf, paymentStatusAfterCollection, type Order, type OrderStatus } from "../src/modules/orders/domain/order.js";

const ALL = Object.keys(LEGAL) as OrderStatus[];

describe("the order state machine", () => {
  it("has the moves in the lifecycle diagram and nothing else", () => {
    expect(LEGAL.PENDING_PAYMENT).toEqual(["PLACED", "CANCELLED"]);
    expect(LEGAL.PLACED).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(LEGAL.ASSIGNED).toEqual(["READY", "PICKED_UP", "CANCELLED"]);
    expect(LEGAL.OUT_FOR_DELIVERY).toEqual(["ARRIVED", "FAILED_DELIVERY"]);
    expect(LEGAL.FAILED_DELIVERY).toEqual(["READY", "CANCELLED"]);
  });
  it("ends at delivered and cancelled", () => {
    for (const s of TERMINAL) expect(LEGAL[s]).toEqual([]);
    for (const s of ALL.filter(s => !TERMINAL.includes(s))) expect(LEGAL[s].length).toBeGreaterThan(0);
  });
  it("lets nothing be cancelled once it is on the road", () => {
    for (const s of ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED", "CANCELLED", "FAILED_DELIVERY"] as const) expect(CANCELLABLE).not.toContain(s);
    for (const s of CANCELLABLE) expect(LEGAL[s]).toContain("CANCELLED");
    expect(ACTIVE_BEFORE_PICKUP).toEqual(CANCELLABLE);
  });
  it("lets a customer cancel only in the early states", () => {
    expect(CUSTOMER_CANCELLABLE).toEqual(["PENDING_PAYMENT", "PLACED", "CONFIRMED"]);
  });
  it("can reach delivered from the start by the documented path", () => {
    const path: OrderStatus[] = ["PLACED", "CONFIRMED", "PACKING", "READY", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERED"];
    path.slice(1).forEach((to, i) => expect(LEGAL[path[i]!]).toContain(to));
  });
});

describe("the status of a group", () => {
  it("follows its children", () => {
    expect(groupStatusOf([])).toBe("CANCELLED");
    expect(groupStatusOf(["PENDING_PAYMENT"])).toBe("PENDING_PAYMENT");
    expect(groupStatusOf(["PLACED", "PACKING"])).toBe("ACTIVE");
    expect(groupStatusOf(["DELIVERED", "PICKED_UP"])).toBe("ACTIVE");
    expect(groupStatusOf(["DELIVERED", "DELIVERED"])).toBe("DELIVERED");
    expect(groupStatusOf(["DELIVERED", "CANCELLED"])).toBe("PARTIAL");
    expect(groupStatusOf(["CANCELLED", "CANCELLED"])).toBe("CANCELLED");
    expect(groupStatusOf(["CANCELLED", "PLACED"])).toBe("ACTIVE");
    expect(groupStatusOf(["FAILED_DELIVERY"])).toBe("ACTIVE");
  });
});

describe("payment status after a collection", () => {
  it("names what was taken at the door", () => {
    expect(paymentStatusAfterCollection("cash")).toBe("cod_collected");
    expect(paymentStatusAfterCollection("upi_unverified")).toBe("upi_unverified");
    expect(paymentStatusAfterCollection("upi_verified")).toBe("upi_verified");
  });
});

describe("delivery codes at rest", () => {
  it("are four digits", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{4}$/);
  });
  it("can be locked and opened again, but not with another key or after tampering", () => {
    const box = createCodeBox("11".repeat(32));
    const sealed = box.seal("4271");
    expect(sealed).not.toContain("4271");
    expect(box.open(sealed)).toBe("4271");
    expect(box.seal("4271")).not.toBe(sealed);
    expect(createCodeBox("22".repeat(32)).open(sealed)).toBeNull();
    expect(box.open(`${sealed.slice(0, -2)}AA`)).toBeNull();
    expect(box.open("garbage")).toBeNull();
    expect(box.open("")).toBeNull();
  });
  it("needs a key of the right size", () => {
    expect(() => createCodeBox("abcd")).toThrow();
    expect(createCodeBox(null).open(createCodeBox(null).seal("0007"))).toBe("0007");
  });
  it("compare without leaking, and only when equal", () => {
    expect(sameCode("4271", "4271")).toBe(true);
    expect(sameCode("4271", "4272")).toBe(false);
    expect(sameCode("4271", "42710")).toBe(false);
  });
});

describe("what a customer is refunded when an order is cancelled", () => {
  const order = (over: Partial<Order> = {}): Order => ({
    id: "o1", orderNo: "DS-1", groupId: "g", userId: "u", zoneId: "z", warehouseId: "w", status: "PLACED", paymentMethod: "online", paymentStatus: "paid", refundStatus: "none",
    customerName: "A", customerPhone: "1", locality: "L",
    items: [{ productId: "p", variantId: "v", name: "n", variantLabel: "l", weightGrams: 500, unitPrice: 3000, qty: 2, originalQty: 2, lineTotal: 6000, gstRate: 0, hsnCode: null, status: "ok", unavailableReason: null }],
    itemsSubtotal: 6000, allocatedDiscount: 500, allocatedCharges: [{ type: "delivery_fee", label: "Delivery fee", amount: 400 }], amountDue: 0, paidAmount: 5900,
    scheduledWindow: null, eta: { packMinutes: 5, riderArrivalMinutes: 5, travelMinutes: 5, extraMinutes: 0 }, promisedAt: new Date(),
    stamps: { placedAt: null, confirmedAt: null, packingAt: null, readyAt: null, assignedAt: null, pickedUpAt: null, outForDeliveryAt: null, arrivedAt: null, deliveredAt: null, cancelledAt: null, failedAt: null },
    voiceMediaId: null, voiceDurationSec: null, housePhotoMediaId: null, bagCount: null, collection: null, delivery: null, failedDelivery: null, cancel: null, notes: [], rev: 0,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  it("is nothing for a cash order, or one that was not paid", () => {
    expect(refundOnCancel(order({ paymentMethod: "cod", paymentStatus: "cod_pending", paidAmount: 0 }), [])).toBe(0);
    expect(refundOnCancel(order({ paymentStatus: "pending" }), [])).toBe(0);
  });
  it("is the items less the discount, plus the fees when the whole group goes", () => {
    expect(refundOnCancel(order(), [order()])).toBe(5500 + 400);
  });
  it("leaves the fees when another order of the group carries on", () => {
    const other = order({ id: "o2", status: "PICKED_UP" });
    expect(refundOnCancel(order(), [order(), other])).toBe(5500);
  });
  it("leaves the fees when the other orders are not yet all cancelled", () => {
    const other = order({ id: "o2", status: "PACKING" });
    expect(refundOnCancel(order(), [order(), other])).toBe(5500);
  });
  it("never refunds more than was paid, and ignores lines that were removed", () => {
    expect(refundOnCancel(order({ paidAmount: 1000 }), [order()])).toBe(1000);
    const removed = order({ items: [{ ...order().items[0]!, status: "unavailable", qty: 0, lineTotal: 0 }], allocatedDiscount: 0, paidAmount: 400 });
    expect(refundOnCancel(removed, [removed])).toBe(400);
  });
});
