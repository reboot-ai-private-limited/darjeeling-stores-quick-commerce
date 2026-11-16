export const GROUPS = ["store", "delivery", "eta", "hours", "preOrder", "assignment", "payments", "discounts", "stock", "orders", "media", "auth", "app", "tax", "notifications"] as const;
export type Group = (typeof GROUPS)[number];
export type ScopeType = "global" | "zone" | "warehouse";
export const SCOPE_ORDER: readonly ScopeType[] = ["warehouse", "zone", "global"];

type Unit = "paise" | "minutes" | "seconds" | "hours" | "days" | "metres" | "bytes";
interface Base { group: Group; key: string; scopes: readonly ScopeType[]; description: string; unit?: Unit }
export type SettingDef =
  | (Base & { type: "integer"; min: number; max: number; default: number })
  | (Base & { type: "number"; min: number; max: number; default: number })
  | (Base & { type: "boolean"; default: boolean })
  | (Base & { type: "enum"; values: readonly string[]; default: string });

const ALL: readonly ScopeType[] = ["warehouse", "zone", "global"];
const ZONE: readonly ScopeType[] = ["zone", "global"];
const GLOBAL: readonly ScopeType[] = ["global"];
const int = (group: Group, key: string, min: number, max: number, def: number, description: string, scopes: readonly ScopeType[] = ALL, unit?: Unit): SettingDef =>
  ({ group, key, type: "integer", min, max, default: def, scopes, description, ...(unit && { unit }) });
const bool = (group: Group, key: string, def: boolean, description: string, scopes: readonly ScopeType[] = ALL): SettingDef =>
  ({ group, key, type: "boolean", default: def, scopes, description });
const choice = (group: Group, key: string, values: readonly string[], def: string, description: string, scopes: readonly ScopeType[] = ALL): SettingDef =>
  ({ group, key, type: "enum", values, default: def, scopes, description });

/**
 * The settings an owner can change in admin: only those worth changing over time (everything else is `FIXED_VALUES` below). Defaults match the values the modules use today. Secrets (Razorpay, WhatsApp, S3 keys) are never settings.
 * Opening hours, pre-order slots and pauses live with the warehouse (F17) and are deliberately not repeated here.
 * Settings that only apply everywhere (not per zone or warehouse) are marked GLOBAL: the modules that read them have no zone or warehouse to ask about.
 * The `auth`, `app` and `notifications` groups exist so screens can list them, but have no keys yet.
 */
export const REGISTRY: readonly SettingDef[] = [
  bool("store", "showOutOfStockItems", true, "Show sold-out items in the catalogue", GLOBAL),
  bool("delivery", "deliveryOtpEnabled", true, "Riders must enter the customer's delivery OTP", GLOBAL),
  bool("delivery", "tipsEnabled", true, "Customers can add a tip for the rider at checkout", ZONE),
  int("delivery", "tipPreset1", 0, 100_000, 1000, "First quick tip amount shown at checkout", ZONE, "paise"),
  int("delivery", "tipPreset2", 0, 100_000, 2000, "Second quick tip amount shown at checkout", ZONE, "paise"),
  int("delivery", "tipPreset3", 0, 100_000, 5000, "Third quick tip amount shown at checkout", ZONE, "paise"),
  int("delivery", "tipMaxAmount", 0, 1_000_000, 20_000, "The largest tip a customer may add to one order", ZONE, "paise"),
  int("eta", "extraMinutes", 0, 120, 0, "Extra minutes added to every tracked ETA", GLOBAL, "minutes"),
  int("assignment", "maxActiveOrders", 1, 10, 2, "Orders a rider may carry at once", GLOBAL),
  choice("assignment", "assignmentMode", ["manual", "auto"], "manual", "Whether orders are assigned by staff or automatically", GLOBAL),
  int("payments", "codMaxAmount", 0, 10_000_000, 200_000, "Largest cash-on-delivery order", ZONE, "paise"),
  int("payments", "refundWindowHours", 1, 720, 24, "How long after delivery a customer may ask for a refund", GLOBAL, "hours"),
  int("discounts", "surchargeCap", 0, 1_000_000, 5000, "The most all surcharges together may add to one order (0 means no limit)", ZONE, "paise"),
  int("discounts", "rainSurchargeAmount", 0, 100_000, 1500, "Default rain-mode surcharge", ZONE, "paise"),
  int("discounts", "rainExtraMinutes", 0, 120, 10, "Default extra minutes while rain mode is on", ZONE, "minutes"),
  choice("orders", "confirmMode", ["auto", "manual"], "auto", "Whether a placed order is confirmed automatically", GLOBAL),
  choice("orders", "customerCancelUntil", ["PLACED", "CONFIRMED", "PACKING"], "CONFIRMED", "The last stage at which a customer may cancel", GLOBAL),
  int("orders", "maxItemsPerOrder", 1, 200, 40, "Most items in one order", GLOBAL),
  int("orders", "maxQtyPerItem", 1, 100, 10, "Most units of one item in a cart", GLOBAL),
  int("orders", "defaultMinOrder", 0, 10_000_000, 0, "Minimum order value when no fee rule sets one", ZONE, "paise"),
];

/**
 * Everything else is fixed in code: values set at launch that are not worth an owner editing. Change one here and redeploy.
 * `effectiveValues` still hands them to the modules, so the code that reads them needs no change; they just cannot be edited in admin.
 */
export const FIXED_VALUES: Readonly<Record<string, Readonly<Record<string, SettingValue>>>> = {
  store: {
    maxChangesPerSync: 500, // Largest catalogue change batch a phone downloads
  },
  delivery: {
    geofenceMeters: 300, // Offline deliveries further than this from the address are flagged
    maxClockSkewMinutes: 5, // How far a rider phone clock may differ from the server before an offline delivery is flagged
    locationPingSecondsOnOrder: 10, // How often a rider phone sends its position while carrying an order
    locationPingSecondsIdle: 60, // How often a rider phone sends its position when it has no order
    punchInRadiusMeters: 150, // How close a rider must be to the warehouse to punch in
  },
  eta: {
    packMinutes: 5, // Minutes to pack an order
    riderArrivalMinutes: 5, // Minutes for a rider to reach the warehouse
    defaultTravelMinutes: 10, // Travel time used when no locality time is known
    tokenTtlHours: 24, // How long a customer's live tracking link keeps working
    maxPointAgeDays: 7, // How long rider position history is kept
    averageSpeedKmh: 18, // Rider speed used for the baseline travel estimate
    detourFactor: 1.3, // Road distance as a multiple of straight-line distance
    etaRefreshSeconds: 60, // How often a tracked ETA is recalculated
  },
  hours: {
    lastOrderMinutesBeforeClose: 15, // Default: minutes before closing when a warehouse stops taking orders
    afterHoursMode: "closed", // Default: what a warehouse does outside its hours
  },
  preOrder: {
    cutoffMinutesBeforeSlot: 60, // Default: booking closes this many minutes before a pre-order slot starts
    packLeadMinutes: 45, // Default: packing starts this many minutes before a pre-order slot
  },
  assignment: {
    ackTimeoutSeconds: 120, // Time a rider has to acknowledge an assignment
    maxBatchOrders: 3, // Orders that may share one delivery run
    delayedAfterMinutes: 5, // An order this late is shown as delayed
    locationStaleSeconds: 300, // A rider position older than this is not trusted
    offlineAfterMinutes: 10, // A silent online rider is switched to offline after this long
  },
  payments: {
    payLinkMinutes: 120, // How long a cash order's pay link stays valid
    refundPhotoRequired: true, // A refund request needs photos
    maxRefundPhotos: 3, // Photos allowed on a refund request
  },
  stock: {
    zonePriceConflictMode: "block", // What happens when one zone's warehouses price a product differently
    lowStockGrams: 5000, // Loose stock below this many grams counts as low
    lowStockUnits: 5, // Packaged stock below this many units counts as low
  },
  orders: {
    paymentWindowMinutes: 15, // Time a customer has to finish an online payment
    otpMaxTries: 5, // Wrong delivery OTP entries before it locks
    slaConfirmMinutes: 5, // Minutes allowed to confirm an order
    slaPackMinutes: 15, // Minutes allowed to pack an order
    slaAssignMinutes: 5, // Minutes allowed to assign a rider
    quoteValiditySeconds: 300, // How long a price quote can be used
    maxSplitsPerOrder: 2, // Most warehouses one order may be split across
  },
  media: {
    maxImageBytes: 5_242_880, // Largest photo upload
    maxVoiceSeconds: 10, // Longest voice note
    maxVoiceBytes: 512_000, // Largest voice note upload
    unattachedHours: 24, // Uploads nobody attached are deleted after this long
    maxPendingPerUser: 50, // Uploads one person may have waiting to be finished
    orderMediaRetentionDays: 7, // Days order photos and voice notes are kept after the order ends
    evidenceRetentionDays: 90, // Days refund and failed-delivery photos are kept
  },
  tax: {
    taxInclusive: true, // Shelf prices already include GST
  },
};
/** The built-in value of a setting that is not editable, or undefined. */
export const fixedValue = (group: string, key: string): SettingValue | undefined => FIXED_VALUES[group]?.[key];
export const fixedValuesOf = (group: string): Readonly<Record<string, SettingValue>> => FIXED_VALUES[group] ?? {};

export const DEFS = new Map(REGISTRY.map(def => [`${def.group}.${def.key}`, def] as const));
export const isGroup = (value: string): value is Group => (GROUPS as readonly string[]).includes(value);
export const defsOf = (group: Group) => REGISTRY.filter(def => def.group === group);

export type SettingValue = number | boolean | string;

/** Why a value is not acceptable, or null. */
export function valueProblem(def: SettingDef, value: unknown): string | null {
  switch (def.type) {
    case "integer": return typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max ? null : `must be a whole number from ${def.min} to ${def.max}`;
    case "number": return typeof value === "number" && Number.isFinite(value) && value >= def.min && value <= def.max ? null : `must be a number from ${def.min} to ${def.max}`;
    case "boolean": return typeof value === "boolean" ? null : "must be true or false";
    case "enum": return typeof value === "string" && def.values.includes(value) ? null : `must be one of ${def.values.join(", ")}`;
  }
}

export interface ScopeRef { type: ScopeType; id: string | null }

/** Problems with a set of changes at one scope: unknown keys, keys not allowed at this scope, bad values. `null` removes the override. */
export function changeProblems(group: Group, scope: ScopeRef, values: Record<string, unknown>): { key: string; message: string }[] {
  const problems: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = DEFS.get(`${group}.${key}`);
    if (!def) { problems.push({ key, message: "Unknown setting" }); continue; }
    if (!def.scopes.includes(scope.type)) { problems.push({ key, message: `Cannot be set at ${scope.type} scope` }); continue; }
    if (value === null) continue;
    const problem = valueProblem(def, value);
    if (problem) problems.push({ key, message: problem });
  }
  return problems;
}

export type Source = ScopeType | "default";
export interface Layer { scope: ScopeType; value: unknown; version: number }

/** The most specific layer wins (warehouse, then zone, then global); otherwise the code default. */
export function resolveKey(def: SettingDef, layers: readonly Layer[]): { value: SettingValue; source: Source; version: number } {
  for (const scope of SCOPE_ORDER) {
    const hit = layers.find(l => l.scope === scope);
    if (hit) return { value: hit.value as SettingValue, source: scope, version: hit.version };
  }
  return { value: def.default, source: "default", version: 0 };
}

/** Cross-key rules a single value cannot express, checked against the values that would apply after the change. */
export function dependencyProblems(effective: Readonly<Record<string, SettingValue>>): { key: string; message: string }[] {
  const problems: { key: string; message: string }[] = [];
  const num = (key: string) => (typeof effective[key] === "number" ? (effective[key] as number) : null);
  const rain = num("rainSurchargeAmount"), cap = num("surchargeCap");
  // A cap of 0 means no limit, so it cannot be exceeded.
  if (rain !== null && cap !== null && cap > 0 && rain > cap) problems.push({ key: "rainSurchargeAmount", message: "Cannot be more than the surcharge cap" });
  const tipMax = num("tipMaxAmount");
  for (const key of ["tipPreset1", "tipPreset2", "tipPreset3"]) {
    const preset = num(key);
    if (preset !== null && tipMax !== null && preset > tipMax) problems.push({ key, message: "Cannot be more than the largest tip" });
  }
  const pack = num("slaPackMinutes"), confirm = num("slaConfirmMinutes");
  if (pack !== null && confirm !== null && pack < confirm) problems.push({ key: "slaPackMinutes", message: "Packing time cannot be shorter than the confirm time" });
  return problems;
}
