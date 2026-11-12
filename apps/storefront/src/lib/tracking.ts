/** Live tracking helpers, the same wording and steps as the customer app. */

export type Tracking = {
  orderId: string;
  orderNo: string;
  status: string;
  eta: { promisedAt: string | null; liveEtaMinutes: number | null; liveEtaAt: string | null; updatedAt: string | null };
  /** null until the order is picked up; `location` only from PICKED_UP to ARRIVED. */
  rider: { name: string; phone: string; location?: { lat: number; lng: number } | null; lastLocationAt?: string | null } | null;
  timeline: { status: string; at: string }[];
  group: { groupNo: string; children: { id: string; orderNo: string; status: string; promisedAt?: string | null }[] };
  deliveryOtp: string | null;
};

/** What to tell the customer for each status, in plain words. */
export const trackingHeadline = (status: string): { title: string; sub: string } => {
  switch (status) {
    case "PENDING_PAYMENT": return { title: "Waiting for payment", sub: "We will start packing once it goes through." };
    case "PLACED": case "CONFIRMED": return { title: "Order confirmed", sub: "The store has your order." };
    case "PACKING": return { title: "Packing your order", sub: "Your items are being picked and packed." };
    case "READY": case "ASSIGNED": return { title: "Ready for pickup", sub: "A delivery partner is on the way to the store." };
    case "PICKED_UP": case "OUT_FOR_DELIVERY": return { title: "On the way", sub: "Your delivery partner is heading to you." };
    case "ARRIVED": return { title: "Arrived at your door", sub: "Share your delivery code with the partner." };
    case "DELIVERED": return { title: "Delivered", sub: "Enjoy your order!" };
    case "CANCELLED": return { title: "Order cancelled", sub: "This order was cancelled." };
    case "FAILED_DELIVERY": return { title: "Delivery failed", sub: "We could not deliver this order." };
    default: return { title: status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), sub: "" };
  }
};

export const isActiveStatus = (s: string) => !["DELIVERED", "CANCELLED", "FAILED_DELIVERY", "PARTIAL"].includes(s);

/** How often to ask the server: every 10 s while the rider is out, every 30 s before that. */
export const pollMs = (status: string) => (["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"].includes(status) ? 10_000 : 30_000);

/** The five steps a customer cares about; PICKED_UP and ARRIVED count towards "Out for delivery". */
export const STEPS = [
  { key: "PLACED", label: "Order placed", match: ["PLACED"] },
  { key: "CONFIRMED", label: "Confirmed", match: ["CONFIRMED"] },
  { key: "PACKING", label: "Packing your order", match: ["PACKING", "READY", "ASSIGNED"] },
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery", match: ["PICKED_UP", "OUT_FOR_DELIVERY", "ARRIVED"] },
  { key: "DELIVERED", label: "Delivered", match: ["DELIVERED"] },
];

/** The time each step was first reached, or null. */
export const stepTimes = (timeline: { status: string; at: string }[] = []) =>
  STEPS.map((st) => timeline.find((t) => st.match.includes(t.status))?.at ?? null);

/** "Updated 2 min ago" style text. */
export const ago = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 15) return "just now";
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
