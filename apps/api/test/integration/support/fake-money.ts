import type { MoneyPort } from "../../../src/modules/orders/orders.public.js";

export interface RecordedRefund { id: string; orderId: string; orderNo: string; amount: number; reason: string; kind: string; by: { userId: string | null; role: string } }

/** Refunds and online payments held in memory: records what the orders module asked for. */
export function createFakeMoney() {
  const refunds: RecordedRefund[] = [];
  let counter = 0;
  const state = { failRefunds: false };
  const port: MoneyPort = {
    async refund({ order, amount, reason, kind, by }) {
      if (state.failRefunds) throw new Error("payment provider is down");
      counter++;
      const refund = { id: `refund-${counter}`, orderId: order.id, orderNo: order.orderNo, amount, reason, kind, by };
      refunds.push(refund);
      return { id: refund.id, amount };
    },
    async startPayment(group) {
      return { provider: "fake", amount: group.pricing.total, currency: "INR", expiresAt: group.expiresAt?.toISOString() ?? null };
    },
  };
  return { port, refunds, state, reset() { refunds.length = 0; counter = 0; state.failRefunds = false; } };
}
export type FakeMoney = ReturnType<typeof createFakeMoney>;
