import { api, ApiError } from "./http";

export type Slot = { start: string; end: string; label: string; remaining: number; cutoffAt: string };
export type Slots = { available: boolean; slots: Slot[] };

/** Next-morning (or later today) delivery windows. Only has slots while the store is closed and pre-orders are on. */
export const getSlots = (zoneId: string) => api<Slots>("GET", `/preorder/slots?zoneId=${zoneId}`).then(r => r.data);

export const slotMessage = (e: unknown): string | null => {
  if (e instanceof ApiError && e.code === "CONFLICT") {
    if (e.details?.reason === "slot_full") return "That time slot just filled up. Please pick another.";
    if (e.details?.reason === "cutoff_passed") return "Booking for that slot has closed. Please pick another.";
  }
  return null;
};

/** "Tomorrow 7:00 AM" style text for the store's next opening time. */
export const opensText = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso); const now = new Date();
  const day = d.toDateString() === now.toDateString() ? "Today" : new Date(now.getTime() + 864e5).toDateString() === d.toDateString() ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
};
