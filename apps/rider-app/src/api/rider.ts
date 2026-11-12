import { Platform } from "react-native";
import { api, ApiError, clearSession, refreshTokenValue, saveSession } from "./http";

// ---- Types (see docs/api/F19-rider-app.md and F22-rider-cash-and-settlement.md) ----
export type LatLng = { lat: number; lng: number };
export type RiderWarehouse = { id: string; name: string; location: LatLng };
export type RiderMe = {
  riderId: string; name: string; phone: string; photo: { mediaId: string } | null; zoneId: string;
  warehouses: RiderWarehouse[];
  status: "offline" | "online" | "on_break";
  currentWarehouseId: string | null;
  currentShift: { id: string; startedAt: string; warehouseId: string } | null;
  activeOrderCount: number; pendingSyncCount: number;
  settings: { locationPingSecondsOnOrder: number; locationPingSecondsIdle: number; ackTimeoutSeconds: number; deliveryOtpEnabled: boolean; maxActiveOrders: number };
};

export type OrderStatus = "ASSIGNED" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "ARRIVED" | "DELIVERED" | "FAILED_DELIVERY" | string;
export type Stage = "assigned" | "picked_up" | "out_for_delivery" | "arrived" | "delivered" | "failed";
export const stageOf = (status: OrderStatus): Stage => (
  status === "PICKED_UP" ? "picked_up" : status === "OUT_FOR_DELIVERY" ? "out_for_delivery" : status === "ARRIVED" ? "arrived"
    : status === "DELIVERED" ? "delivered" : status === "FAILED_DELIVERY" ? "failed" : "assigned"
);

/** An order as it appears in the assignments feed. */
export type FeedOrder = {
  id: string; orderNo: string; groupId: string; status: OrderStatus;
  warehouse: RiderWarehouse; customerName: string; locality: string; itemCount: number;
  amountDue: number; paymentStatus: string; promisedAt: string | null;
};
export type Assignment = {
  id: string; status: string; assignedAt: string; ackDeadlineAt: string | null;
  batch?: { id: string; stops: { seq: number; type: "pickup" | "drop"; warehouseId?: string; orderIds: string[]; status: string }[] };
  orders: FeedOrder[];
};
export type AssignmentEvent = { event: "assigned" | "reassigned_away" | "cancelled" | "payment_paid" | "updated" | string; assignment: Assignment };

/** One live order the rider is working on (an order plus the assignment it belongs to). */
export type ActiveOrder = FeedOrder & { assignmentId: string; acknowledged: boolean; ackDeadlineAt: string | null; alreadyPaid: boolean };

export type OrderDetail = {
  id: string; orderNo: string; groupId: string; status: OrderStatus;
  warehouse: RiderWarehouse;
  items: { name: string; variantLabel: string | null; qty: number; status: string }[];
  bagCount: number | null;
  customer: { name: string; phone: string };
  address: { line1: string; landmark: string | null; locality: string; location: LatLng | null; locationAccuracyM: number | null; deliveryNotes: string | null };
  voiceNote: { mediaId: string; durationSec: number; expired: boolean } | null;
  housePhoto: { mediaId: string } | null;
  paymentMethod: string; paymentStatus: string; amountDue: number; alreadyPaid: boolean; otpRequired: boolean;
  promisedAt: string | null; batchStop?: { seq: number; of: number };
};

export type CashEntry = { id: string; type: "collected" | "deposit" | "adjustment" | string; amount: number; orderNo?: string | null; warehouseId?: string; at: string };
export type CashSummary = {
  cashInHand: number; deliveredToday: number;
  byWarehouse: { warehouseId: string; warehouseName: string; amount: number }[];
  pendingUpi: { orderId: string; orderNo: string; amount: number; status: string }[];
  entries: CashEntry[];
};
export type HistoryItem = { orderId: string; orderNo: string; status: string; deliveredAt: string | null; amountDue: number; collectionMethod: string | null; deliveredOffline?: boolean };

/** The login screen takes 10 digits; the API wants E.164. */
export const toE164 = (digits: string) => `+91${digits.replace(/\D/g, "").slice(-10)}`;

// ---- Sign-in ----
export async function requestOtp(digits: string): Promise<void> {
  try {
    await api("POST", "/auth/request-otp", { phone: toE164(digits), app: "rider" }, { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.code === "OTP_REQUEST_REJECTED") throw new ApiError("This number isn't registered as a rider. Ask your manager to add you.", e.status, e.code);
    if (e instanceof ApiError && e.status === 429) throw new ApiError("Too many code requests. Please wait a while and try again.", e.status, e.code);
    throw e;
  }
}

export async function verifyOtp(digits: string, otp: string): Promise<{ attemptsLeft?: number } | null> {
  try {
    const { data } = await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/verify-otp", { phone: toE164(digits), otp, deviceInfo: `${Platform.OS} ${String(Platform.Version)} · rider app` }, { auth: false });
    await saveSession(data);
    return null;
  } catch (e) {
    if (e instanceof ApiError && (e.code === "INVALID_OTP" || e.code === "OTP_MISMATCH")) return { attemptsLeft: Number(e.details?.attemptsLeft) || undefined };
    if (e instanceof ApiError && e.code === "OTP_EXPIRED") throw new ApiError("That code has expired. Go back and request a new one.", e.status, e.code);
    if (e instanceof ApiError && e.code === "OTP_LOCKED") throw new ApiError("Too many wrong codes. Try again in 15 minutes.", e.status, e.code);
    throw e;
  }
}

export async function signOutRemote(): Promise<void> {
  const refreshToken = refreshTokenValue();
  try { if (refreshToken) await api("POST", "/auth/logout", { refreshToken }); } catch { /* signing out locally is enough */ }
  await clearSession();
}

// ---- Profile and shift ----
export const getMe = () => api<RiderMe>("GET", "/rider/me").then(r => r.data);
export const startShift = (warehouseId: string, location: LatLng, accuracyM: number | null) =>
  api<{ shiftId: string; status: string; punchIn: { distanceFromWarehouseM: number; verified: boolean } }>("POST", "/rider/shift/start", { warehouseId, location, accuracyM }).then(r => r.data);
export const startBreak = () => api("POST", "/rider/shift/break");
export const resumeShift = () => api("POST", "/rider/shift/resume");
export const endShift = () => api<{ shiftId: string; hoursWorked: number }>("POST", "/rider/shift/end").then(r => r.data);

// ---- Work feed ----
/** Without `since`: every live assignment. With `since`: only newer events. */
export const getAssignments = (since?: string) =>
  api<AssignmentEvent[]>("GET", `/rider/assignments${since ? `?since=${encodeURIComponent(since)}` : ""}`).then(r => ({ events: r.data ?? [], cursor: (r.meta as { cursor?: string } | undefined)?.cursor }));
export const ackAssignment = (id: string) => api("POST", `/rider/assignments/${id}/ack`);

// ---- One order ----
export const getOrder = (id: string) => api<OrderDetail>("GET", `/rider/orders/${id}`).then(r => r.data);
export const pickup = (id: string, bagCount: number) => api("POST", `/rider/orders/${id}/pickup`, { checklist: { itemsVerified: true, bagCount } });
export const startRide = (id: string) => api("POST", `/rider/orders/${id}/start-ride`);
export const arrived = (id: string, location?: LatLng | null) => api("POST", `/rider/orders/${id}/arrived`, location ? { location } : undefined);
export const verifyDeliveryOtp = async (id: string, otp: string): Promise<{ attemptsLeft?: number } | null> => {
  try { await api("POST", `/rider/orders/${id}/verify-otp`, { otp }); return null; }
  catch (e) {
    if (e instanceof ApiError && e.code === "OTP_MISMATCH") return { attemptsLeft: Number(e.details?.attemptsLeft) || undefined };
    if (e instanceof ApiError && e.code === "OTP_LOCKED") throw new ApiError("Too many wrong codes. Ask your manager for help.", e.status, e.code);
    throw e;
  }
};
export const collectCash = (id: string, amount: number) => api("POST", `/rider/orders/${id}/collect-cash`, { amount, collectedAt: new Date().toISOString() });
export const collectUpi = (id: string, amount: number) => api("POST", `/rider/orders/${id}/collect-upi`, { amount, note: "Paid by UPI at the door", collectedAt: new Date().toISOString() });
export const deliver = (id: string, otp: string | null, location?: LatLng | null, accuracyM?: number | null) =>
  api("POST", `/rider/orders/${id}/deliver`, { ...(otp ? { otp } : {}), deliveredAt: new Date().toISOString(), ...(location ? { location, accuracyM: accuracyM ?? null } : {}) });
export type FailReason = "customer_unreachable" | "wrong_address" | "refused" | "road_blocked" | "weather" | "other";
export const failDelivery = (id: string, reason: FailReason, note: string | null, photoMediaId: string | null) =>
  api("POST", `/rider/orders/${id}/failed`, { reason, ...(note ? { note } : {}), ...(photoMediaId ? { photoMediaId } : {}) });
export type ProblemType = "vehicle_issue" | "road_blocked" | "customer_issue" | "other";
export const reportProblem = (id: string, type: ProblemType, note: string | null) => api("POST", `/rider/orders/${id}/problem`, { type, ...(note ? { note } : {}) });

// ---- Money and history ----
export const getCash = () => api<CashSummary>("GET", "/rider/cash").then(r => r.data);
export const getHistory = (cursor?: string) =>
  api<HistoryItem[]>("GET", `/rider/history?limit=30${cursor ? `&cursor=${cursor}` : ""}`).then(r => ({ items: r.data ?? [], nextCursor: ((r.meta as { nextCursor?: string | null } | undefined)?.nextCursor) ?? null, deliveredToday: Number((r.meta as { deliveredToday?: number } | undefined)?.deliveredToday ?? 0) }));
export const getHistorySummary = () => getHistory().then(h => h.deliveredToday);

// ---- Live location, store switching, tips ----
export type LocationPoint = { location: LatLng; accuracyM: number | null; speedKmh: number | null; at: string };
/** Sends the rider's position. The server answers with how many seconds to wait before the next one. */
export const sendLocation = (points: LocationPoint[]) =>
  api<{ accepted: number; nextPingSeconds: number }>("POST", "/rider/location", { points }).then(r => r.data);
/** The road from `from` to the customer's door: points to draw, the distance and the time. `approximate` means a straight line (no road answer). */
export type RoutePath = { distanceM: number; durationS: number; points: LatLng[]; approximate: boolean; destination: LatLng };
export const getRoute = (orderId: string, from: LatLng) =>
  api<RoutePath>("GET", `/rider/orders/${orderId}/route?lat=${from.lat}&lng=${from.lng}`).then(r => r.data);
export const switchWarehouse = (warehouseId: string) => api("POST", "/rider/shift/switch-warehouse", { warehouseId });

export type Tips = { from: string; to: string; totals: { count: number; total: number; owed: number; paid: number }; items: { orderId: string; orderNo: string; amount: number; deliveredAt: string; status: string; paidAt: string | null }[] };
export const getTips = () => api<Tips>("GET", "/rider/tips").then(r => r.data);

// ---- App version and maintenance (public) ----
export type AppConfig = { minSupportedVersion?: string; latestVersion?: string; forceUpdate?: boolean; downloadUrl?: string; maintenance?: { active: boolean; message: string | null }; supportNumber?: string };
export const getAppConfig = (version: string) =>
  api<AppConfig>("GET", `/app/config?app=rider&platform=android&version=${encodeURIComponent(version)}`, undefined, { auth: false }).then(r => r.data);

// ---- Files ----
export const getMediaUrl = (mediaId: string) => api<{ url: string }>("GET", `/media/${mediaId}/url`).then(r => r.data.url);

/** Uploads a profile photo (private, owned by this rider) and sets it. */
export async function uploadProfilePhoto(riderId: string, fileUri: string, contentType = "image/jpeg"): Promise<string> {
  const blob = await (await fetch(fileUri)).blob();
  const { data: ticket } = await api<{ mediaId: string; upload: { url: string; method?: string; fields?: Record<string, string> } }>("POST", "/media/upload-url", {
    kind: "rider_photo", contentType, sizeBytes: blob.size, ownerRef: { type: "rider", id: riderId },
  });
  const form = new FormData();
  Object.entries(ticket.upload.fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", blob as unknown as Blob, "me.jpg");
  const put = await fetch(ticket.upload.url, { method: ticket.upload.method ?? "POST", body: form });
  if (!put.ok) throw new ApiError("The photo could not be uploaded. Try again.", put.status, "UPLOAD_FAILED");
  await api("POST", "/media/complete", { mediaId: ticket.mediaId });
  await api("PUT", "/rider/profile/photo", { mediaId: ticket.mediaId });
  return ticket.mediaId;
}

/** Uploads a photo taken on the phone as private evidence for an order. Returns the media id to send with the failed-delivery report. */
export async function uploadFailedDeliveryPhoto(orderId: string, fileUri: string, contentType = "image/jpeg"): Promise<string> {
  const blob = await (await fetch(fileUri)).blob();
  const { data: ticket } = await api<{ mediaId: string; upload: { url: string; method?: string; fields?: Record<string, string> } }>("POST", "/media/upload-url", {
    kind: "failed_delivery_photo", contentType, sizeBytes: blob.size, ownerRef: { type: "order", id: orderId },
  });
  const form = new FormData();
  Object.entries(ticket.upload.fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", blob as unknown as Blob, "door.jpg");
  const put = await fetch(ticket.upload.url, { method: ticket.upload.method ?? "POST", body: form });
  if (!put.ok) throw new ApiError("The photo could not be uploaded. Try again.", put.status, "UPLOAD_FAILED");
  await api("POST", "/media/complete", { mediaId: ticket.mediaId });
  return ticket.mediaId;
}
