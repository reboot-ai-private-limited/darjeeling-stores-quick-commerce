import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREORDER, hoursProblem, isOpen, istDate, istInstant, istIso, matchSlot, nextOpening, pauseActive, slotLabel, slotsProblem, upcomingSlots,
  type Pause, type WarehouseHours,
} from "../src/modules/hours/domain/hours.js";

// 2026-11-05 is a Thursday (weekday 4).
const at = (iso: string) => new Date(iso);
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const hours = (over: Partial<WarehouseHours> = {}): WarehouseHours => ({
  warehouseId: "w", hours: [{ days: everyDay, open: "07:00", close: "20:00" }], lastOrderMinutesBeforeClose: 15, afterHoursMode: "pre_order", preOrder: DEFAULT_PREORDER, updatedAt: new Date(0), ...over,
});

describe("opening hours", () => {
  it("are read in Indian time", () => {
    // 07:00 IST = 01:30 UTC.
    expect(isOpen(hours(), at("2026-11-05T01:29:00Z"))).toBe(false);
    expect(isOpen(hours(), at("2026-11-05T01:30:00Z"))).toBe(true);
  });
  it("stop taking orders a margin before closing", () => {
    // 20:00 IST = 14:30 UTC; last order 15 minutes earlier.
    expect(isOpen(hours(), at("2026-11-05T14:14:00Z"))).toBe(true);
    expect(isOpen(hours(), at("2026-11-05T14:15:00Z"))).toBe(false);
    expect(isOpen(hours({ lastOrderMinutesBeforeClose: 0 }), at("2026-11-05T14:29:00Z"))).toBe(true);
    expect(isOpen(hours({ lastOrderMinutesBeforeClose: 0 }), at("2026-11-05T14:30:00Z"))).toBe(false);
  });
  it("can differ by day", () => {
    const weekdays = hours({ hours: [{ days: [1, 2, 3, 4, 5], open: "07:00", close: "20:00" }, { days: [0, 6], open: "09:00", close: "18:00" }] });
    expect(isOpen(weekdays, at("2026-11-05T02:30:00Z"))).toBe(true); // Thursday 08:00
    expect(isOpen(weekdays, at("2026-11-07T02:30:00Z"))).toBe(false); // Saturday 08:00
    expect(isOpen(weekdays, at("2026-11-07T04:30:00Z"))).toBe(true); // Saturday 10:00
  });
  it("find the next opening", () => {
    expect(nextOpening(hours(), at("2026-11-05T16:00:00Z"))).toEqual(at("2026-11-06T01:30:00Z")); // Thursday 21:30 -> Friday 07:00
    expect(nextOpening(hours(), at("2026-11-05T00:00:00Z"))).toEqual(at("2026-11-05T01:30:00Z")); // before opening, same day
    const now = at("2026-11-05T03:00:00Z");
    expect(nextOpening(hours(), now)).toEqual(now);
    expect(nextOpening(hours({ hours: [{ days: [1], open: "07:00", close: "20:00" }] }), at("2026-11-05T03:00:00Z"))).toEqual(at("2026-11-09T01:30:00Z"));
  });
  it("are checked", () => {
    expect(hoursProblem([])).toMatch(/at least one/);
    expect(hoursProblem([{ days: [], open: "07:00", close: "20:00" }])).toMatch(/Days/);
    expect(hoursProblem([{ days: [7], open: "07:00", close: "20:00" }])).toMatch(/Days/);
    expect(hoursProblem([{ days: [1], open: "7:00", close: "20:00" }])).toMatch(/HH:MM/);
    expect(hoursProblem([{ days: [1], open: "20:00", close: "07:00" }])).toMatch(/after opening/);
    expect(hoursProblem([{ days: [1], open: "07:00", close: "20:00" }])).toBeNull();
  });
});

describe("indian dates and times", () => {
  it("convert in both directions", () => {
    expect(istDate(at("2026-11-05T19:00:00Z"))).toBe("2026-11-06");
    expect(istInstant(at("2026-11-05T05:00:00Z"), "07:00")).toEqual(at("2026-11-05T01:30:00Z"));
    expect(istInstant(at("2026-11-05T05:00:00Z"), "07:00", 1)).toEqual(at("2026-11-06T01:30:00Z"));
    expect(istIso(at("2026-11-06T01:30:00Z"))).toBe("2026-11-06T07:00:00+05:30");
  });
});

describe("pre-order slots", () => {
  const config = { enabled: true, slots: [{ start: "07:00", end: "09:00", capacity: 20 }, { start: "09:00", end: "11:00", capacity: 10 }], cutoffMinutesBeforeSlot: 60, packLeadMinutes: 45 };
  it("are accepted when they do not overlap", () => {
    expect(slotsProblem(config.slots)).toBeNull();
    expect(slotsProblem([{ start: "07:00", end: "09:00", capacity: 5 }, { start: "08:30", end: "10:00", capacity: 5 }])).toMatch(/overlap/);
    expect(slotsProblem([{ start: "09:00", end: "07:00", capacity: 5 }])).toMatch(/end after/);
    expect(slotsProblem([{ start: "07:00", end: "09:00", capacity: 0 }])).toMatch(/Capacity/);
    expect(slotsProblem([{ start: "7:00", end: "09:00", capacity: 1 }])).toMatch(/HH:MM/);
  });
  it("offer tomorrow's slots in the evening, with their booking cutoff", () => {
    const slots = upcomingSlots(config, at("2026-11-05T16:00:00Z")); // Thursday 21:30
    expect(slots.map(s => [istIso(s.start), istIso(s.end), s.label, istIso(s.cutoffAt)])).toEqual([
      ["2026-11-06T07:00:00+05:30", "2026-11-06T09:00:00+05:30", "Tomorrow 7–9 AM", "2026-11-06T06:00:00+05:30"],
      ["2026-11-06T09:00:00+05:30", "2026-11-06T11:00:00+05:30", "Tomorrow 9–11 AM", "2026-11-06T08:00:00+05:30"],
    ]);
    expect(slots[0]!.date).toBe("2026-11-06");
  });
  it("offer this morning's slots when it is early enough, and drop those past their cutoff", () => {
    const early = upcomingSlots(config, at("2026-11-04T23:00:00Z")); // Thursday 04:30
    expect(early.map(s => s.label)).toEqual(["Today 7–9 AM", "Today 9–11 AM"]);
    const later = upcomingSlots(config, at("2026-11-05T00:45:00Z")); // 06:15: the 7 AM cutoff (06:00) has passed
    expect(later.map(s => s.label)).toEqual(["Today 9–11 AM"]);
    expect(upcomingSlots(config, at("2026-11-05T03:00:00Z")).map(s => s.label)).toEqual(["Tomorrow 7–9 AM", "Tomorrow 9–11 AM"]);
  });
  it("have no slots when none are set", () => { expect(upcomingSlots(DEFAULT_PREORDER, at("2026-11-05T16:00:00Z"))).toEqual([]); });
  it("are labelled across noon", () => {
    expect(slotLabel({ start: "11:00", end: "13:00", capacity: 1 }, 1)).toBe("Tomorrow 11 AM–1 PM");
    expect(slotLabel({ start: "07:30", end: "09:00", capacity: 1 }, 0)).toBe("Today 7:30–9 AM");
  });
  it("match a requested window exactly", () => {
    const hit = matchSlot(config, { start: at("2026-11-06T01:30:00Z"), end: at("2026-11-06T03:30:00Z") });
    expect(hit?.slot.start).toBe("07:00");
    expect(hit?.date).toBe("2026-11-06");
    expect(istIso(hit!.cutoffAt)).toBe("2026-11-06T06:00:00+05:30");
    expect(matchSlot(config, { start: at("2026-11-06T01:30:00Z"), end: at("2026-11-06T03:00:00Z") })).toBeNull();
    expect(matchSlot(config, { start: at("2026-11-06T02:00:00Z"), end: at("2026-11-06T04:00:00Z") })).toBeNull();
  });
});

describe("pauses", () => {
  const pause = (over: Partial<Pause> = {}): Pause => ({ scope: "warehouse", id: "w", active: true, message: null, until: null, by: "u", at: new Date(0), ...over });
  it("last until switched off or their end time", () => {
    const t = at("2026-11-05T10:00:00Z");
    expect(pauseActive(null, t)).toBe(false);
    expect(pauseActive(pause(), t)).toBe(true);
    expect(pauseActive(pause({ active: false }), t)).toBe(false);
    expect(pauseActive(pause({ until: at("2026-11-05T10:00:01Z") }), t)).toBe(true);
    expect(pauseActive(pause({ until: at("2026-11-05T10:00:00Z") }), t)).toBe(false);
  });
});
