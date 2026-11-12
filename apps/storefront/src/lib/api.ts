import { isBrowser } from "./storage";
import type {
  Address,
  AddressInput,
  BrandInfo,
  Category,
  CheckoutData,
  CouponRow,
  HomeData,
  Locality,
  OrderGroup,
  OrderSummary,
  PreorderSlot,
  Product,
  Quote,
  StoreStatus,
  User,
  Zone,
} from "./types";

const SERVER_ORIGIN = process.env.API_INTERNAL_ORIGIN ?? "http://127.0.0.1:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The access cookie only lives for a short time (30 minutes). The refresh cookie lasts days, so when a call comes back
 * 401 we ask for a fresh access cookie once and repeat the call. Calls made at the same moment share one refresh.
 */
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { Accept: "application/json", "X-CSRF-Token": "1" },
    credentials: "include",
    cache: "no-store",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Universal API fetcher for both Server Components and Client Components.
 */
export async function apiFetch<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  customHeaders?: Record<string, string>,
  revalidate = 0,
  retried = false
): Promise<T> {
  const url = isBrowser
    ? `/api/v1${path.startsWith("/") ? path : `/${path}`}`
    : `${SERVER_ORIGIN}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-CSRF-Token": "1",
    ...customHeaders,
  };

  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const requestInit: RequestInit & { next?: { revalidate: number } } = {
    method,
    headers,
    credentials: "include", // sends and receives cookies
    cache: revalidate > 0 ? "default" : "no-store",
  };

  if (body !== undefined) {
    requestInit.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  if (revalidate > 0) {
    requestInit.next = { revalidate };
  }

  const res = await fetch(url, requestInit);

  // Expired access cookie: renew it and try once more (never for the sign-in calls themselves).
  if (res.status === 401 && isBrowser && !retried && !path.startsWith("/auth/") && (await refreshSession())) {
    return apiFetch<T>(method, path, body, customHeaders, revalidate, true);
  }

  const contentType = res.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const code = data?.error?.code ?? (res.status === 401 ? "UNAUTHORIZED" : "API_ERROR");
    const message = data?.error?.message ?? res.statusText ?? "Request failed";
    throw new ApiError(res.status, code, message, data?.error?.details);
  }

  return (data?.data ?? data) as T;
}

/** Server-side catalog fetcher (safely returns null on failure so SSR can render honest empty states) */
export async function serverApi<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    return await apiFetch<T>("GET", path, undefined, undefined, revalidate);
  } catch {
    return null;
  }
}

// ----------------- API → storefront shape -----------------
// The API (shared with the mobile app) returns images as { urls: { "320": … } }, brand as an object, categories with
// `children`, banners with `image`/`link`, etc. These mappers convert that into the flatter shapes the components use.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;
const pickUrl = (urls: Record<string, string> | undefined, ...sizes: string[]) => {
  if (!urls) return "";
  for (const s of sizes) if (urls[s]) return urls[s]!;
  return Object.values(urls)[0] ?? "";
};

function mapProduct(p: Raw, category?: { id: string; name: string }): Product {
  const variants = (p.variants ?? []).map((v: Raw) => ({
    variantId: v.variantId,
    sku: v.sku ?? "",
    label: v.label,
    unit: v.label,
    price: v.price,
    mrp: v.mrp,
    discountPercent: v.discountPercent ?? 0,
    available: !!v.available,
    stockQty: v.available ? v.maxQty ?? 0 : 0,
    maxQty: v.maxQty ?? 0,
  }));
  const out: Raw = {
    id: p.id,
    name: p.name,
    subtitle: p.subtitle ?? null,
    brand: typeof p.brand === "string" ? p.brand : p.brand?.name ?? null,
    foodType: p.foodType ?? null,
    category: category ?? p.category ?? { id: p.categoryId ?? "", name: "" },
    subCategory: p.subCategory ?? null,
    variants,
    images: (p.images ?? []).map((im: Raw, i: number) => ({ id: im.mediaId ?? String(i), url: pickUrl(im.urls, "640", "320", "1080", "160"), sortOrder: i })),
    badges: p.badges ?? (p.badge ? [p.badge] : []),
    tags: p.tags ?? [],
    availability: p.availability ?? (p.available ? "in_stock" : "out_of_stock"),
  };
  if (p.description) out.description = p.description;
  if (p.highlights?.length) out.highlights = p.highlights;
  if (p.categoryId && !out.category.id) out.category = { id: p.categoryId, name: out.category.name };
  if (p.keyInfo?.length) out.keyInfo = p.keyInfo;
  if (p.infoSections?.length) out.sections = p.infoSections.map((x: Raw) => ({ title: x.title, content: x.body }));
  if (p.nutrition?.rows?.length) out.nutrition = p.nutrition.rows.map((r: Raw) => ({ label: r.name, value: `${r.amount} ${r.unit}` }));
  return out as Product;
}

function mapCategory(c: Raw): Category {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    imageUrl: c.imageUrl ?? null,
    subcategories: (c.children ?? c.subcategories ?? []).map((x: Raw) => ({ id: x.id, name: x.name })),
  };
}

function mapStatus(s: Raw): StoreStatus {
  return {
    accepting: s.accepting ?? true,
    nextOpenAt: s.nextOpenAt ?? s.opensAt ?? null,
    etaMinMinutes: s.etaMinMinutes ?? s.eta?.minMinutes ?? 10,
    etaMaxMinutes: s.etaMaxMinutes ?? s.eta?.maxMinutes ?? 15,
    notice: s.notice ?? s.pauseMessage ?? s.notices?.[0]?.label ?? null,
    paused: s.paused,
    freeDeliveryAbove: s.freeDeliveryAbove ?? null,
    smallOrderFee: s.smallOrderFee,
    minOrder: s.minOrder,
  };
}

function mapBanner(b: Raw) {
  const link = b.link as { type?: string; id?: string; url?: string } | null;
  const linkType = link?.type === "category" ? "category" : link?.type === "product" ? "product" : "external";
  const linkValue = link?.type === "category" ? link.id ?? "" : link?.type === "product" ? `/product/${link.id}` : link?.url ?? "";
  return { id: b.id, title: b.title, imageUrl: b.imageUrl ?? pickUrl(b.image?.urls, "1080", "640", "320"), linkType, linkValue } as HomeData["banners"][number];
}

// ----------------- Discovery & Catalog API -----------------

export async function resolveLocation(point: { lat: number; lng: number } | { localityId: string }) {
  return apiFetch<{
    deliverable: boolean;
    zone?: Zone;
    paused?: boolean;
    reopenAt?: string | null;
  }>("POST", "/location/resolve", point);
}

export async function getCities() {
  return apiFetch<{ id: string; name: string }[]>("GET", "/cities");
}

export async function getLocalities(cityId: string): Promise<Locality[]> {
  return apiFetch<Locality[]>(
    "GET",
    `/localities?cityId=${encodeURIComponent(cityId)}`
  );
}

export async function getStoreStatus(zoneId: string): Promise<StoreStatus> {
  return mapStatus(await apiFetch<Raw>("GET", `/store/status?zoneId=${encodeURIComponent(zoneId)}`));
}

export async function getHomeData(zoneId: string): Promise<HomeData> {
  const h = await apiFetch<Raw>("GET", `/catalog/home?zoneId=${encodeURIComponent(zoneId)}`);
  return {
    banners: (h.banners ?? []).map(mapBanner),
    categories: (h.categories ?? []).map(mapCategory),
    sections: (h.sections ?? []).map((sec: Raw) => ({
      id: sec.categoryId,
      title: sec.title,
      subtitle: sec.subtitle ?? null,
      products: (sec.products ?? []).map((p: Raw) => mapProduct(p, { id: sec.categoryId, name: sec.title })),
    })),
    status: mapStatus(h.status ?? {}),
    notices: (h.notices ?? []).map((n: Raw) => ({ kind: n.kind ?? n.type, label: n.label })),
  };
}

export async function getCategories(zoneId: string) {
  return (await apiFetch<Raw[]>("GET", `/catalog/categories?zoneId=${encodeURIComponent(zoneId)}`)).map(mapCategory);
}

export async function getCategoryProducts(
  zoneId: string,
  categoryId: string,
  subCategoryId?: string,
  sort?: string
) {
  const query = new URLSearchParams({ zoneId, categoryId });
  if (subCategoryId) query.set("subCategoryId", subCategoryId);
  if (sort) query.set("sort", sort);
  return (await apiFetch<Raw[]>("GET", `/catalog/products?${query.toString()}`)).map((p) => mapProduct(p));
}

export async function getProduct(productId: string, zoneId?: string): Promise<Product> {
  const query = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : "";
  return mapProduct(await apiFetch<Raw>("GET", `/catalog/products/${encodeURIComponent(productId)}${query}`));
}

export async function searchCatalog(zoneId: string, query: string): Promise<Product[]> {
  return (await apiFetch<Raw[]>(
    "GET",
    `/catalog/search?zoneId=${encodeURIComponent(zoneId)}&q=${encodeURIComponent(query)}`
  )).map((p) => mapProduct(p));
}

export async function getBrands(zoneId: string): Promise<BrandInfo[]> {
  return apiFetch<BrandInfo[]>("GET", `/catalog/brands?zoneId=${encodeURIComponent(zoneId)}`);
}

/** The API takes the phone and either a locality id or a map position. */
export async function submitWaitlist(phone: string, where: { localityId: string } | { lat: number; lng: number }) {
  return apiFetch<{ ok: boolean }>("POST", "/waitlist", { phone, ...("localityId" in where ? { localityId: where.localityId } : { location: { lat: where.lat, lng: where.lng } }) });
}

export async function submitNotifyMe(zoneId: string, productId: string, variantId?: string) {
  return apiFetch<{ ok: boolean }>("POST", "/notify-me", { zoneId, productId, ...(variantId ? { variantId } : {}) });
}

// ----------------- Auth & Profile API -----------------

export async function requestOtp(phone: string) {
  return apiFetch<{ message: string; expiresInSeconds?: number }>("POST", "/auth/request-otp", {
    phone,
    app: "customer",
  });
}

export async function verifyOtp(phone: string, code: string) {
  return apiFetch<{ user: User; isNewUser: boolean }>("POST", "/auth/verify-otp", { phone, otp: code, deviceInfo: "web · storefront" });
}

export async function getMe(): Promise<User> {
  return apiFetch<User>("GET", "/me");
}

export async function updateProfile(data: { name?: string; email?: string }): Promise<User> {
  return apiFetch<User>("PUT", "/me", data);
}

export async function signOutRemote(): Promise<void> {
  try {
    await apiFetch("POST", "/auth/logout");
  } catch {
    /* swallow sign out errors */
  }
}

// ----------------- Cart & Quote API -----------------

/** The server wants a rising revision number with every cart upload; counting up from the time in seconds keeps it valid. */
let cartRev = Math.floor(Date.now() / 1000);

const syncKey = (items: { variantId: string; qty: number }[], addressId?: string | null) => `${addressId ?? ""}|${items.map((i) => `${i.variantId}:${i.qty}`).sort().join(",")}`;
let lastSynced: { key: string; at: number } | null = null;

/**
 * Uploads the cart unless this very cart (and address) was uploaded a moment ago. The cart screens call it in the background,
 * so by the time checkout asks for a quote the slow part is already done.
 */
export async function ensureCartSynced(items: { productId: string; variantId: string; qty: number }[], addressId?: string | null) {
  const key = syncKey(items, addressId);
  if (lastSynced && lastSynced.key === key && Date.now() - lastSynced.at < 120_000) return null;
  const res = await syncCartRemote(items, addressId);
  lastSynced = { key, at: Date.now() };
  return res;
}

/** Sends the whole cart. The server prices it, trims what it cannot sell, and every quote is built from this copy. */
export async function syncCartRemote(
  items: { productId: string; variantId: string; qty: number }[],
  addressId?: string | null
) {
  const send = () =>
    apiFetch<{
      cart: { zoneId: string; clientRev: number; items: { productId: string; variantId: string; qty: number; unitPrice: number; maxQty: number; available: boolean }[]; itemsSubtotal: number; freeDelivery: { threshold: number; remaining: number } | null };
      corrections: { productId: string; variantId: string; reason: string; qty: number }[];
      zoneChange: unknown;
    }>("PUT", "/cart", { clientRev: ++cartRev, ...(addressId ? { addressId } : {}), items });

  let res = await send();
  // The server ignores an upload whose revision is older than the one it holds (another device, a different clock) and answers with
  // its own cart instead. Move past its revision and send again, so the cart on screen is the one that counts.
  if (res.cart.clientRev > cartRev) {
    cartRev = res.cart.clientRev;
    res = await send();
  }
  return res;
}

export async function listCoupons(zoneId: string, subtotalPaise: number): Promise<CouponRow[]> {
  return apiFetch<CouponRow[]>(
    "GET",
    `/coupons/available?zoneId=${encodeURIComponent(zoneId)}&subtotal=${subtotalPaise}`
  );
}

export async function getTipOptions(zoneId: string) {
  return apiFetch<{ enabled: boolean; presets: number[]; max: number }>(
    "GET",
    `/tips/options?zoneId=${encodeURIComponent(zoneId)}`
  );
}

export async function getPreorderSlots(zoneId: string): Promise<PreorderSlot[]> {
  return apiFetch<PreorderSlot[]>(
    "GET",
    `/preorder/slots?zoneId=${encodeURIComponent(zoneId)}`
  );
}

export async function createQuote(input: {
  addressId: string;
  paymentMethod: "cod" | "online";
  tipAmount: number;
  acceptZoneChange?: boolean;
  scheduledWindow?: { start: string; end: string } | null;
}): Promise<Quote> {
  // The coupon lives on the server cart (applied with POST /cart/coupon), so it is not sent here: a null would remove it.
  return apiFetch<Quote>("POST", "/quotes", { ...input, scheduledWindow: input.scheduledWindow ?? null, acceptZoneChange: !!input.acceptZoneChange });
}

// ----------------- Orders & Payments API -----------------

export async function placeOrder(
  input: {
    quoteId: string;
    paymentMethod: "cod" | "online";
    deliveryNotes?: string | null;
  },
  idempotencyKey: string
): Promise<{ group: OrderGroup; payment: CheckoutData | null }> {
  return apiFetch<{ group: OrderGroup; payment: CheckoutData | null }>("POST", "/orders", input, {
    "Idempotency-Key": idempotencyKey,
  });
}

export async function getOrderGroup(groupId: string): Promise<OrderGroup> {
  return apiFetch<OrderGroup>("GET", `/order-groups/${encodeURIComponent(groupId)}`);
}

export async function listOrders(status: "active" | "past"): Promise<{ items: OrderSummary[] }> {
  const res = await apiFetch<OrderSummary[] | { items: OrderSummary[] }>(
    "GET",
    `/orders?status=${status}&limit=15`
  );
  if (Array.isArray(res)) return { items: res };
  return res;
}

export async function retryPayment(groupId: string): Promise<CheckoutData> {
  return apiFetch<CheckoutData>("POST", "/payments/retry", { groupId });
}

export async function verifyPayment(
  groupId: string,
  razorpayData: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }
) {
  return apiFetch<{ state: string }>("POST", "/payments/verify", {
    groupId,
    ...razorpayData,
  });
}

export async function getPaymentStatus(groupId: string) {
  return apiFetch<{ groupId: string; paymentStatus: string; state: string }>(
    "GET",
    `/order-groups/${encodeURIComponent(groupId)}/payment`
  );
}

export async function cancelOrder(childOrderId: string, reason: string) {
  return apiFetch<{ ok: boolean }>(
    "POST",
    `/orders/${encodeURIComponent(childOrderId)}/cancel`,
    { reason }
  );
}

export async function reorder(childOrderId: string) {
  return apiFetch<{
    cart: { items: { productId: string; variantId: string; qty: number; name: string; variantLabel: string; unitPrice: number; maxQty: number; available: boolean; imageUrl?: string | null }[] };
    corrections: { productId: string; variantId: string; reason: string; qty: number }[];
  }>("POST", `/orders/${encodeURIComponent(childOrderId)}/reorder`);
}

// ----------------- Addresses API -----------------

export async function getAddresses(): Promise<Address[]> {
  return apiFetch<Address[]>("GET", "/addresses");
}

export async function createAddress(data: AddressInput): Promise<Address> {
  return apiFetch<Address>("POST", "/addresses", data);
}

export async function updateAddress(id: string, data: Partial<AddressInput>): Promise<Address> {
  return apiFetch<Address>("PUT", `/addresses/${encodeURIComponent(id)}`, data);
}

export async function setDefaultAddress(id: string): Promise<Address> {
  return apiFetch<Address>("POST", `/addresses/${encodeURIComponent(id)}/default`);
}

export async function deleteAddress(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("DELETE", `/addresses/${encodeURIComponent(id)}`);
}

// ----------------- Media Upload API -----------------

export type MediaKind = "address_photo" | "address_voice" | "refund_photo";

export async function uploadMedia(
  kind: MediaKind,
  fileBlob: Blob,
  fileName: string,
  contentType: string,
  extra: { durationSec?: number; ownerRef?: { type: string; id: string } } = {}
): Promise<string> {
  const ticket = await apiFetch<{
    mediaId: string;
    upload: { url: string; method?: string; fields?: Record<string, string> };
  }>("POST", "/media/upload-url", {
    kind,
    contentType,
    sizeBytes: fileBlob.size,
    ...extra,
  });

  const form = new FormData();
  if (ticket.upload.fields) {
    Object.entries(ticket.upload.fields).forEach(([k, v]) => form.append(k, v));
  }
  form.append("file", fileBlob, fileName);

  const res = await fetch(ticket.upload.url, {
    method: ticket.upload.method ?? "POST",
    body: form,
  });

  if (!res.ok) {
    throw new ApiError(res.status, "UPLOAD_FAILED", "The file could not be uploaded. Please try again.");
  }

  await apiFetch("POST", "/media/complete", { mediaId: ticket.mediaId });
  return ticket.mediaId;
}

export async function getMediaUrl(mediaId: string): Promise<string> {
  const res = await apiFetch<{ url: string }>("GET", `/media/${encodeURIComponent(mediaId)}/url`);
  return res.url;
}

/** Human-readable error message mapper matching customer mobile app */
export function friendlyErrorMessage(code?: string, fallback = "Something went wrong. Please try again."): string {
  switch (code) {
    case "OUT_OF_ZONE":
      return "We don't deliver to this address yet. Please pick another address.";
    case "ZONE_PAUSED":
      return "Deliveries in your area are temporarily paused. Please check back shortly.";
    case "STORE_CLOSED":
      return "The store is closed right now. You can pre-order for the morning!";
    case "ITEM_UNAVAILABLE":
    case "INSUFFICIENT_STOCK":
      return "Some items sold out. Please review your cart.";
    case "MIN_ORDER_NOT_MET":
      return "The minimum order amount has not been reached. Please add a few more items.";
    case "COD_NOT_ALLOWED":
      return "Cash on Delivery is unavailable for this order. Please pay online.";
    case "COUPON_INVALID":
      return "This coupon cannot be applied to your current order.";
    case "PAYMENT_EXPIRED":
      return "Payment window expired. Your items have been returned to the store.";
    case "UNAUTHORIZED":
      return "Please sign in to proceed.";
    default:
      return fallback;
  }
}
