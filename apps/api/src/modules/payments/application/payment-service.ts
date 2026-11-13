import { createHash } from "node:crypto";
import { AppError, conflict, forbidden, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { paymentView, type Mismatch, type Payment, type PaymentEvent, type PaymentState } from "../domain/payment.js";
import { DuplicateEventError, type PaymentDeps } from "./ports.js";

const IST_MS = 5.5 * 3_600_000;
const istDay = (at: Date) => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
const dayRange = (date: string) => { const from = new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_MS); return { from, to: new Date(from.getTime() + 86_400_000) }; };
/** Payments span warehouses, so only staff who can see every warehouse use these screens. */
const wholeBusiness = (ctx: Ctx) => { if (!ctx.actor.scope.all) throw forbidden("Payments are shown to staff who manage every warehouse"); };

type Group = NonNullable<Awaited<ReturnType<PaymentDeps["groups"]["get"]>>>;
interface CapturedEntity { id: string; amount: number }

/** Online payments, the Razorpay webhook, pay-online-later links and reconciliation (F15). The webhook is the source of truth. */
export function createPaymentService(deps: PaymentDeps) {
  const { store, provider, groups, refunds, notifier, settings, now, newId } = deps;

  const checkout = (p: Payment) => ({
    razorpayKeyId: provider.keyId, razorpayOrderId: p.razorpayOrderId, amount: p.amount, currency: settings.currency, expiresAt: p.expiresAt?.toISOString() ?? null,
  });
  /** The group can still be paid: some order is still waiting for payment. */
  const openForPayment = (g: Group) => g.paymentMethod === "online" && g.paymentStatus !== "paid" && g.children.some(c => c.status === "PENDING_PAYMENT");
  const expiredGroup = (g: Group) => g.paymentMethod === "online" && g.paymentStatus !== "paid" && !openForPayment(g);

  async function newAttempt(g: Group): Promise<Payment> {
    const attempt = (await store.forGroup(g.id)).filter(p => p.method === "razorpay").length + 1;
    const order = await provider.createOrder({ amount: g.total, receipt: g.groupNo, notes: { groupId: g.id, attempt: String(attempt) } });
    const at = now();
    const payment: Payment = {
      id: newId(), groupId: g.id, userId: g.userId, method: "razorpay", amount: g.total, status: "created", attempt, razorpayOrderId: order.id, razorpayPaymentId: null, razorpayLinkId: null, linkUrl: null,
      signatureVerified: false, failureReason: null, flag: null, expiresAt: g.expiresAt, capturedAt: null, createdAt: at, updatedAt: at,
    };
    await store.insert(payment);
    return payment;
  }
  async function owned(userId: string, groupId: string): Promise<Group> {
    const g = await groups.get(groupId);
    if (!g || g.userId !== userId) throw notFound("Order group");
    return g;
  }

  /** The money arrived. What happens next depends on where the order stands. */
  async function captured(payment: Payment, entity: CapturedEntity, options: { skipAmountCheck?: boolean; actor?: Ctx } = {}): Promise<string> {
    if (payment.status === "captured") return "already_captured";
    const group = await groups.get(payment.groupId);
    if (!group) return "unknown_group";
    if (!options.skipAmountCheck && entity.amount !== payment.amount) {
      await store.update(payment.id, { razorpayPaymentId: entity.id, status: "authorized", flag: "amount_mismatch" });
      await notifier.adminAlert("A payment does not match the amount due", { groupNo: group.groupNo, expected: String(payment.amount), actual: String(entity.amount) }).catch(() => undefined);
      return "amount_mismatch";
    }
    const at = now();
    const won = await store.capture(payment.id, { razorpayPaymentId: entity.id, signatureVerified: true, failureReason: null, capturedAt: at });
    if (!won) return "already_captured";

    if (payment.method === "razorpay_link") {
      const handled = group.children.some(c => c.collectionRecorded || c.status === "DELIVERED") || group.paymentStatus === "paid";
      if (handled) {
        await store.update(payment.id, { flag: "overpaid" });
        await refunds.refund({ groupId: group.id, amount: payment.amount, reason: "Paid online after the cash was taken", kind: "overpaid", key: `overpaid:${payment.id}` });
        return "overpaid_refund";
      }
      await groups.markCodPaid(group.id, { paymentId: entity.id });
      return "paid_cod";
    }
    if (group.paymentStatus === "paid") {
      await store.update(payment.id, { flag: "overpaid" });
      await refunds.refund({ groupId: group.id, amount: payment.amount, reason: "Paid twice", kind: "overpaid", key: `overpaid:${payment.id}` });
      return "duplicate_refund";
    }
    if (!openForPayment(group)) {
      // The order was cancelled or expired before the money arrived: the customer gets it back.
      await store.update(payment.id, { flag: "late_payment" });
      await refunds.refund({ groupId: group.id, amount: payment.amount, reason: "Payment arrived after the order was cancelled", kind: "late_payment", key: `late:${payment.id}` });
      return "late_refund";
    }
    await groups.markPaid(group.id, { paymentId: entity.id });
    return "paid";
  }

  return {
    /** The checkout data for a new online group, or the one already open for it. */
    async startPayment(groupId: string) {
      const g = await groups.get(groupId);
      if (!g || g.paymentMethod !== "online") return null;
      const open = (await store.forGroup(groupId)).filter(p => p.method === "razorpay" && p.status === "created" && (!p.expiresAt || p.expiresAt.getTime() > now().getTime())).at(-1);
      return { provider: "razorpay", ...checkout(open ?? (await newAttempt(g))) };
    },

    /** The app's success callback. Only provisional: the webhook confirms. */
    async verify(userId: string, input: { groupId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
      const g = await owned(userId, input.groupId);
      const payment = await store.byRazorpayOrder(input.razorpayOrderId);
      if (!payment || payment.groupId !== g.id || payment.amount !== g.total) throw new AppError("PAYMENT_MISMATCH", "This payment does not belong to the order", { amountDue: g.total });
      if (!provider.verifyCheckout(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) throw validation("The payment could not be verified", { field: "razorpaySignature" });
      if (g.paymentStatus === "paid") return { groupId: g.id, state: "confirmed" as const, provisional: true };
      if (expiredGroup(g)) throw new AppError("PAYMENT_EXPIRED", "The time to pay for this order has ended");
      if (payment.status === "created") await store.update(payment.id, { razorpayPaymentId: input.razorpayPaymentId, signatureVerified: true, status: "authorized" });
      return { groupId: g.id, state: "confirming" as const, provisional: true };
    },

    /** "Confirming payment" polling. */
    async status(userId: string, groupId: string) {
      const g = await owned(userId, groupId);
      const attempts = await store.forGroup(groupId);
      const latest = attempts.filter(p => p.method === "razorpay").at(-1);
      let state: PaymentState;
      if (g.paymentStatus === "paid") state = "confirmed";
      else if (expiredGroup(g)) state = "expired";
      else if (latest?.status === "authorized" && latest.signatureVerified) state = "confirming";
      else if (latest?.status === "failed") state = "failed";
      else state = "awaiting_payment";
      return { groupId, paymentStatus: g.paymentStatus, state, expiresAt: g.expiresAt?.toISOString() ?? null };
    },

    /** A new attempt before the time runs out. Only expiry cancels the order, not a failed attempt. */
    async retry(userId: string, groupId: string) {
      const g = await owned(userId, groupId);
      if (g.paymentMethod !== "online") throw conflict("This order is paid on delivery", { reason: "not_online" });
      if (g.paymentStatus === "paid") throw conflict("This order is already paid", { reason: "already_paid" });
      if (!openForPayment(g) || (g.expiresAt && g.expiresAt.getTime() <= now().getTime())) throw new AppError("PAYMENT_EXPIRED", "The time to pay for this order has ended");
      return checkout(await newAttempt(g));
    },

    /** A cash-on-delivery customer pays online before the rider collects. */
    async payLink(userId: string, orderId: string, method: "upi_intent" | "link") {
      const groupId = await groups.groupOfOrder(orderId);
      const g = groupId ? await owned(userId, groupId) : null;
      if (!g || !g.children.some(c => c.id === orderId)) throw notFound("Order");
      if (g.paymentMethod !== "cod") throw conflict("This order is not paid on delivery", { reason: "not_cod" });
      const live = g.children.filter(c => c.status !== "CANCELLED");
      if (live.length === 0 || g.paymentStatus === "paid" || live.some(c => c.collectionRecorded || c.status === "DELIVERED")) throw conflict("This order can no longer be paid online", { reason: "cash_collected" });
      const amount = live.reduce((sum, c) => sum + c.amountDue, 0);
      if (amount <= 0) throw conflict("Nothing is due on this order", { reason: "nothing_due" });
      const existing = (await store.forGroup(g.id)).filter(p => p.method === "razorpay_link" && p.status === "created" && p.amount === amount && p.expiresAt && p.expiresAt.getTime() > now().getTime()).at(-1);
      if (existing) return { groupId: g.id, amount, paymentLinkId: existing.razorpayLinkId, url: existing.linkUrl, upiIntentUrl: method === "upi_intent" ? existing.linkUrl : null, expiresAt: existing.expiresAt!.toISOString() };
      const expiresAt = new Date(now().getTime() + settings.payLinkMinutes * 60_000);
      const link = await provider.createPaymentLink({ amount, reference: g.groupNo, description: `Order ${g.groupNo}`, expiresAt, customer: { name: g.customerName, phone: g.customerPhone } });
      const at = now();
      await store.insert({
        id: newId(), groupId: g.id, userId, method: "razorpay_link", amount, status: "created", attempt: 1, razorpayOrderId: null, razorpayPaymentId: null, razorpayLinkId: link.id, linkUrl: link.url,
        signatureVerified: false, failureReason: null, flag: null, expiresAt, capturedAt: null, createdAt: at, updatedAt: at,
      });
      return { groupId: g.id, amount, paymentLinkId: link.id, url: link.url, upiIntentUrl: method === "upi_intent" ? link.upiIntentUrl ?? link.url : link.upiIntentUrl, expiresAt: expiresAt.toISOString() };
    },

    /** Razorpay's event. Verified, recorded once, and handled so that a repeat or a late one changes nothing. */
    async webhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<{ ok: boolean; result: string }> {
      if (!provider.verifyWebhook(rawBody, signature)) throw forbidden("Invalid signature");
      let body: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; error_description?: string } }; payment_link?: { entity?: { id?: string } } } };
      try { body = JSON.parse(rawBody!.toString("utf8")); } catch { return { ok: true, result: "ignored" }; }
      const entity = body.payload?.payment?.entity;
      const linkId = body.payload?.payment_link?.entity?.id ?? null;
      const eventId = eventIdHeader ?? createHash("sha256").update(rawBody!).digest("hex");
      const event: PaymentEvent = {
        id: newId(), eventId, type: String(body.event ?? ""), razorpayOrderId: entity?.order_id ?? null, razorpayPaymentId: entity?.id ?? null, amount: entity?.amount ?? null, result: "received", at: now(),
      };
      try { await store.recordEvent(event); } catch (error) { if (error instanceof DuplicateEventError) return { ok: true, result: "duplicate" }; throw error; }

      let result = "ignored";
      if (["payment.captured", "order.paid", "payment_link.paid"].includes(event.type) && entity?.id) {
        const payment = (linkId ? await store.byLink(linkId) : null) ?? (entity.order_id ? await store.byRazorpayOrder(entity.order_id) : null);
        result = payment ? await captured(payment, { id: entity.id, amount: entity.amount ?? 0 }) : "unknown_payment";
      } else if (event.type === "payment.failed" && entity?.order_id) {
        const payment = await store.byRazorpayOrder(entity.order_id);
        if (payment && payment.status !== "captured") { await store.update(payment.id, { status: "failed", failureReason: entity.error_description ?? "The payment failed", razorpayPaymentId: entity.id ?? null }); result = "failure_recorded"; }
        else result = "unknown_payment";
      }
      await store.setEventResult(eventId, result);
      return { ok: true, result };
    },

    /** Online groups whose time ran out are cancelled (the stock goes back); the payment attempts are closed. */
    async expireOverdue(): Promise<number> { return groups.expireOverdue(); },

    // ---------------------------------------------------------------- the admin

    async list(ctx: Ctx, query: { status?: string | undefined; method?: string | undefined; groupNo?: string | undefined; from?: Date | undefined; to?: Date | undefined; limit: number; cursor?: string | undefined }) {
      wholeBusiness(ctx);
      let groupIds: readonly string[] | undefined;
      if (query.groupNo) { const id = await groups.idByNo(query.groupNo); groupIds = id ? [id] : []; }
      const rows = await store.list({ ...(query.status && { status: query.status }), ...(query.method && { method: query.method }), ...(groupIds && { groupIds }), ...(query.from && { from: query.from }), ...(query.to && { to: query.to }) }, query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      const data = await Promise.all(page.map(async p => { const g = await groups.get(p.groupId); return { ...paymentView(p), groupNo: g?.groupNo ?? null, customerName: g?.customerName ?? null }; }));
      return { data, nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
    },
    async get(ctx: Ctx, id: string) {
      wholeBusiness(ctx);
      const p = await store.get(id);
      if (!p) throw notFound("Payment");
      const [g, last] = await Promise.all([groups.get(p.groupId), store.lastEvent(p.razorpayOrderId, p.razorpayPaymentId)]);
      return { ...paymentView(p), groupNo: g?.groupNo ?? null, customerName: g?.customerName ?? null, lastEvent: last && { type: last.type, result: last.result, at: last.at.toISOString() } };
    },

    /** Sends money back through Razorpay for a group that was paid online. Calling it again with the same key refunds once. */
    async refundOnline(input: { groupId: string; amount: number; key: string }): Promise<{ id: string }> {
      const paid = (await store.forGroup(input.groupId)).filter(p => p.method === "razorpay" && p.status === "captured" && p.razorpayPaymentId).at(-1);
      if (!paid) throw conflict("No online payment was received for this order, so there is nothing to send back through Razorpay", { reason: "no_captured_payment" });
      if (input.amount > paid.amount) throw conflict("That is more than the customer paid online", { reason: "exceeds_payment", paid: paid.amount });
      return provider.refund({ paymentId: paid.razorpayPaymentId!, amount: input.amount, key: input.key, notes: { groupId: input.groupId } });
    },

    /** Compares one day's captures at Razorpay with ours. */
    async reconcile(ctx: Ctx, date?: string) {
      wholeBusiness(ctx);
      const day = date ?? istDay(now());
      const { from, to } = dayRange(day);
      const [theirs, ours] = await Promise.all([provider.capturesOn(from, to), store.capturedBetween(from, to)]);
      const byProviderId = new Map(ours.filter(p => p.razorpayPaymentId).map(p => [p.razorpayPaymentId!, p]));
      const mismatches: Mismatch[] = [];
      let matched = 0;
      const seen = new Set<string>();
      for (const capture of theirs) {
        const mine = byProviderId.get(capture.paymentId);
        if (!mine) { if (capture.status === "captured") mismatches.push({ type: "missing_in_db", razorpayPaymentId: capture.paymentId, amount: capture.amount }); continue; }
        seen.add(mine.id);
        if (capture.status !== "captured" && capture.status !== "refunded") mismatches.push({ type: "status_mismatch", paymentId: mine.id });
        else if (capture.amount !== mine.amount) mismatches.push({ type: "amount_mismatch", paymentId: mine.id, expected: mine.amount, actual: capture.amount });
        else matched++;
      }
      for (const mine of ours) if (!seen.has(mine.id)) mismatches.push({ type: "missing_in_provider", paymentId: mine.id, amount: mine.amount });
      const record = { id: newId(), date: day, matched, mismatches, createdAt: now() };
      await store.saveReconciliation(record);
      return { jobId: record.id };
    },
    async latestReconciliation(ctx: Ctx, date?: string) {
      wholeBusiness(ctx);
      const day = date ?? istDay(now());
      const r = await store.latestReconciliation(day);
      return r ? { date: r.date, matched: r.matched, mismatches: r.mismatches } : { date: day, matched: 0, mismatches: [] as Mismatch[] };
    },

    /** After checking the Razorpay dashboard: treat a stuck payment as received. */
    async markPaid(ctx: Ctx, id: string, input: { razorpayPaymentId: string; note: string | null }) {
      wholeBusiness(ctx);
      const payment = await store.get(id);
      if (!payment) throw notFound("Payment");
      if (payment.status === "captured") throw conflict("This payment is already captured", { reason: "already_captured" });
      const result = await captured(payment, { id: input.razorpayPaymentId, amount: payment.amount }, { skipAmountCheck: true, actor: ctx });
      if (result === "already_captured") throw conflict("This payment is already captured", { reason: "already_captured" });
      return paymentView((await store.get(id))!);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
