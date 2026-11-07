export type CustomerStatus = "active" | "blocked" | "deactivated" | "deletion_requested" | "deleted";
export const STATUSES: readonly CustomerStatus[] = ["active", "blocked", "deactivated", "deletion_requested", "deleted"];

export interface Note { text: string; by: string; at: Date }
export interface CustomerStats { orderCount: number; lifetimeValue: number; lastOrderAt: Date | null }
export interface Customer {
  id: string; name: string; phone: string | null; status: CustomerStatus; codAllowed: boolean; blockedReason: string | null; notes: Note[];
  deletionRequestedAt: Date | null; createdAt: Date | null;
}

export type Transition = "block" | "unblock" | "finalise";
/** The status a customer must be in for each administrative action. */
export const REQUIRED_STATUS: Record<Transition, CustomerStatus> = { block: "active", unblock: "blocked", finalise: "deletion_requested" };
export const TRANSITION_MESSAGE: Record<Transition, string> = {
  block: "Only an active customer can be blocked", unblock: "Only a blocked customer can be unblocked", finalise: "This customer has not asked for their account to be deleted",
};

/** What a search text means: a phone number (digits, optionally with +) or the start of a name. */
export function searchFilter(q: string): { phone: string } | { namePrefix: string } {
  const compact = q.replace(/[\s-]/g, "");
  if (/^\+?\d{4,15}$/.test(compact)) return { phone: compact.startsWith("+") ? compact : compact.length === 10 ? `+91${compact}` : `+${compact}` };
  return { namePrefix: q };
}
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const customerView = (c: Customer, s: CustomerStats) => ({
  id: c.id, name: c.name, phone: c.phone, status: c.status, codAllowed: c.codAllowed, orderCount: s.orderCount, lifetimeValue: s.lifetimeValue,
  lastOrderAt: s.lastOrderAt?.toISOString() ?? null, blockedReason: c.blockedReason,
  internalNotes: c.notes.map(n => ({ text: n.text, by: n.by, at: n.at.toISOString() })),
});

export const NO_STATS: CustomerStats = { orderCount: 0, lifetimeValue: 0, lastOrderAt: null };
