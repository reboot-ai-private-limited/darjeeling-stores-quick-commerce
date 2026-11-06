/** Opening hours, pre-order slots and pauses. All clock times are Indian time; instants are real moments. */

export interface HoursRule { days: number[]; open: string; close: string }
export interface Slot { start: string; end: string; capacity: number }
export interface PreOrderConfig { enabled: boolean; slots: Slot[]; cutoffMinutesBeforeSlot: number; packLeadMinutes: number }
export interface WarehouseHours {
  warehouseId: string; hours: HoursRule[]; lastOrderMinutesBeforeClose: number; afterHoursMode: "closed" | "pre_order"; preOrder: PreOrderConfig; updatedAt: Date;
}
export interface Pause { scope: "warehouse" | "zone"; id: string; active: boolean; message: string | null; until: Date | null; by: string; at: Date }

export const IST_MS = 5.5 * 3_600_000;
export const DEFAULT_PREORDER: PreOrderConfig = { enabled: false, slots: [], cutoffMinutesBeforeSlot: 60, packLeadMinutes: 45 };
export const validClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };

/** Wall-clock parts of an instant in India. */
export function istParts(at: Date) {
  const d = new Date(at.getTime() + IST_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/** The instant of a clock time on the Indian calendar day that `at` falls on (dayOffset moves the day). */
export function istInstant(at: Date, hhmm: string, dayOffset = 0): Date {
  const p = istParts(at);
  return new Date(Date.UTC(p.y, p.mo, p.day + dayOffset, 0, 0) + minutesOf(hhmm) * 60_000 - IST_MS);
}
export const istDate = (at: Date) => { const p = istParts(at); return `${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
/** An instant written the way the apps read it, with the +05:30 offset. */
export function istIso(at: Date): string {
  const d = new Date(at.getTime() + IST_MS);
  return `${d.toISOString().slice(0, 19)}+05:30`;
}

export function hoursProblem(rules: readonly HoursRule[]): string | null {
  if (rules.length === 0) return "Add at least one opening time";
  for (const r of rules) {
    if (r.days.length === 0 || r.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return "Days are numbers from 0 (Sunday) to 6";
    if (!validClock(r.open) || !validClock(r.close)) return "Times must be HH:MM";
    if (minutesOf(r.close) <= minutesOf(r.open)) return "Closing time must be after opening time";
  }
  return null;
}
export function slotsProblem(slots: readonly Slot[]): string | null {
  for (const s of slots) {
    if (!validClock(s.start) || !validClock(s.end)) return "Slot times must be HH:MM";
    if (minutesOf(s.end) <= minutesOf(s.start)) return "A slot must end after it starts";
    if (!Number.isInteger(s.capacity) || s.capacity < 1) return "Capacity must be at least 1";
  }
  const sorted = [...slots].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let i = 1; i < sorted.length; i++) if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) return "Slots must not overlap";
  return null;
}

/** Open for new orders at this moment: inside a day's hours, and not within the last-order margin before closing. */
export function isOpen(h: WarehouseHours, at: Date): boolean {
  const p = istParts(at);
  return h.hours.some(r => r.days.includes(p.weekday) && p.minutes >= minutesOf(r.open) && p.minutes < minutesOf(r.close) - h.lastOrderMinutesBeforeClose);
}
/** The next moment the warehouse opens for orders (within a week), or null. */
export function nextOpening(h: WarehouseHours, at: Date): Date | null {
  if (isOpen(h, at)) return at;
  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (istParts(at).weekday + offset) % 7;
    for (const r of h.hours.filter(x => x.days.includes(weekday))) {
      const when = istInstant(at, r.open, offset);
      if (when.getTime() > at.getTime() && (!best || when < best)) best = when;
    }
    if (best) return best;
  }
  return best;
}
export const pauseActive = (p: Pause | null | undefined, at: Date) => Boolean(p?.active && (!p.until || p.until.getTime() > at.getTime()));

export interface SlotInstance { start: Date; end: Date; slot: Slot; date: string; cutoffAt: Date; label: string }

const fmtHour = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const h12 = h! % 12 === 0 ? 12 : h! % 12; return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}`; };
const meridian = (hhmm: string) => (minutesOf(hhmm) < 720 ? "AM" : "PM");
export function slotLabel(slot: Slot, dayOffset: number): string {
  const day = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : "Later";
  const same = meridian(slot.start) === meridian(slot.end);
  return `${day} ${fmtHour(slot.start)}${same ? "" : ` ${meridian(slot.start)}`}–${fmtHour(slot.end)} ${meridian(slot.end)}`;
}

/** Upcoming slots, today then tomorrow, whose booking cutoff has not passed. */
export function upcomingSlots(config: PreOrderConfig, at: Date): SlotInstance[] {
  const out: SlotInstance[] = [];
  for (const offset of [0, 1]) {
    for (const slot of [...config.slots].sort((a, b) => minutesOf(a.start) - minutesOf(b.start))) {
      const start = istInstant(at, slot.start, offset);
      const cutoffAt = new Date(start.getTime() - config.cutoffMinutesBeforeSlot * 60_000);
      if (cutoffAt.getTime() <= at.getTime()) continue;
      out.push({ start, end: istInstant(at, slot.end, offset), slot, date: istDate(start), cutoffAt, label: slotLabel(slot, offset) });
    }
    if (out.length > 0) break;
  }
  return out;
}

/** Finds the configured slot that matches a requested window exactly. */
export function matchSlot(config: PreOrderConfig, window: { start: Date; end: Date }): { slot: Slot; date: string; cutoffAt: Date } | null {
  const p = istParts(window.start);
  const startClock = `${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
  const slot = config.slots.find(s => s.start === startClock && window.end.getTime() === window.start.getTime() + (minutesOf(s.end) - minutesOf(s.start)) * 60_000);
  return slot ? { slot, date: istDate(window.start), cutoffAt: new Date(window.start.getTime() - config.cutoffMinutesBeforeSlot * 60_000) } : null;
}

/** A pre-order window must be on today or tomorrow (Indian calendar) and still ahead. */
export function onOfferedDay(window: { start: Date }, at: Date): boolean {
  const day = istDate(window.start);
  return window.start.getTime() > at.getTime() && (day === istDate(at) || day === istDate(new Date(at.getTime() + 86_400_000)));
}

export const hoursView = (h: WarehouseHours) => ({
  warehouseId: h.warehouseId, hours: h.hours, lastOrderMinutesBeforeClose: h.lastOrderMinutesBeforeClose, afterHoursMode: h.afterHoursMode,
  preOrder: h.preOrder,
});
