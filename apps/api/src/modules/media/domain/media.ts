export type MediaKind =
  | "product_image" | "category_image" | "brand_logo" | "banner" | "rider_photo" | "address_voice" | "address_photo"
  | "order_voice" | "order_photo" | "failed_delivery_photo" | "refund_photo";
export type MediaStatus = "pending" | "processing" | "ready" | "failed" | "deleting" | "deleted";
export type PrincipalKind = "staff" | "customer" | "rider";
export type OwnerType = "product" | "category" | "brand" | "banner" | "rider" | "address" | "order";
export type Resource = "image" | "audio";
export type Access = "public" | "private";

/** Everything the module needs to know about who is calling. Staff carry permission keys and a warehouse scope. */
export interface Principal {
  userId: string; kind: PrincipalKind; role: string; permissions: readonly string[];
  scope: { all: boolean; warehouseIds: readonly string[] };
}

export const WIDTHS = [160, 320, 640, 1080] as const;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const AUDIO_TYPES = ["audio/mp4", "audio/aac", "audio/x-m4a", "audio/m4a"] as const;

export interface MediaSettings {
  maxImageBytes: number; maxVoiceBytes: number; maxVoiceSeconds: number;
  orderMediaRetentionDays: number; evidenceRetentionDays: number;
  /** An upload or an unattached file older than this is cleaned up. */
  unattachedHours: number; maxPendingPerUser: number;
}
export const DEFAULT_SETTINGS: MediaSettings = {
  maxImageBytes: 5 * 1024 * 1024, maxVoiceBytes: 500 * 1024, maxVoiceSeconds: 10,
  orderMediaRetentionDays: 7, evidenceRetentionDays: 90, unattachedHours: 24, maxPendingPerUser: 50,
};

export interface KindRule {
  resource: Resource; access: Access;
  /** Who may request an upload. Empty for files only the server creates (copies onto orders). */
  uploaders: readonly PrincipalKind[];
  /** A staff uploader needs one of these permission keys. */
  staffUpload: readonly string[];
  /** Permission keys that let staff read or manage the file, besides the uploader. */
  staffRead: readonly string[];
  ownerTypes: readonly OwnerType[];
  prefix: string;
  retention: "order" | "evidence" | null;
}

const IMAGE_ADMIN = { resource: "image", uploaders: ["staff"], retention: null } as const;
export const RULES: Record<MediaKind, KindRule> = {
  product_image: { ...IMAGE_ADMIN, access: "public", staffUpload: ["catalog:manage"], staffRead: ["catalog:view"], ownerTypes: ["product"], prefix: "public/products" },
  category_image: { ...IMAGE_ADMIN, access: "public", staffUpload: ["catalog:manage"], staffRead: ["catalog:view"], ownerTypes: ["category"], prefix: "public/categories" },
  brand_logo: { ...IMAGE_ADMIN, access: "public", staffUpload: ["catalog:manage"], staffRead: ["catalog:view"], ownerTypes: ["brand"], prefix: "public/brands" },
  banner: { ...IMAGE_ADMIN, access: "public", staffUpload: ["pricing:manage"], staffRead: ["pricing:manage"], ownerTypes: ["banner"], prefix: "public/banners" },
  rider_photo: { resource: "image", access: "private", uploaders: ["rider", "staff"], staffUpload: ["riders:manage"], staffRead: ["riders:view"], ownerTypes: ["rider"], prefix: "private/riders", retention: null },
  address_voice: { resource: "audio", access: "private", uploaders: ["customer"], staffUpload: [], staffRead: ["orders:view"], ownerTypes: ["address"], prefix: "private/addresses", retention: null },
  address_photo: { resource: "image", access: "private", uploaders: ["customer"], staffUpload: [], staffRead: ["orders:view"], ownerTypes: ["address"], prefix: "private/addresses", retention: null },
  order_voice: { resource: "audio", access: "private", uploaders: [], staffUpload: [], staffRead: ["orders:view"], ownerTypes: ["order"], prefix: "private/orders", retention: "order" },
  order_photo: { resource: "image", access: "private", uploaders: [], staffUpload: [], staffRead: ["orders:view"], ownerTypes: ["order"], prefix: "private/orders", retention: "order" },
  failed_delivery_photo: { resource: "image", access: "private", uploaders: ["rider"], staffUpload: [], staffRead: ["orders:view"], ownerTypes: ["order"], prefix: "private/evidence", retention: "evidence" },
  refund_photo: { resource: "image", access: "private", uploaders: ["customer"], staffUpload: [], staffRead: ["refunds:manage", "orders:view"], ownerTypes: ["order"], prefix: "private/evidence", retention: "evidence" },
};
export const KINDS = Object.keys(RULES) as MediaKind[];
export const OWNER_TYPES: readonly OwnerType[] = ["product", "category", "brand", "banner", "rider", "address", "order"];

/** Kinds whose copy on an order is deleted a fixed time after the order ends. */
export const ORDER_COPY_KINDS: readonly MediaKind[] = ["order_voice", "order_photo"];
export const EVIDENCE_KINDS: readonly MediaKind[] = ["failed_delivery_photo", "refund_photo"];

/** Which address file becomes which order file when an order is placed. */
export const ORDER_COPY_OF: Partial<Record<MediaKind, MediaKind>> = { address_voice: "order_voice", address_photo: "order_photo" };

/** Customers may delete these themselves; nothing else. */
export const CUSTOMER_DELETABLE: readonly MediaKind[] = ["address_voice", "address_photo"];

export const hasAny = (p: Principal, keys: readonly string[]) => p.permissions.includes("*") || keys.some(k => p.permissions.includes(k));

export function canUpload(p: Principal, rule: KindRule): boolean {
  if (!rule.uploaders.includes(p.kind)) return false;
  return p.kind !== "staff" || hasAny(p, rule.staffUpload);
}

export function maxBytesFor(rule: KindRule, s: MediaSettings): number { return rule.resource === "audio" ? s.maxVoiceBytes : s.maxImageBytes; }

export type RejectReason = "type_not_allowed" | "too_large" | "too_long";

/** Checks what the client says about its file; the real file is checked again once it is uploaded. */
export function checkDeclared(rule: KindRule, input: { contentType: string; sizeBytes: number; durationSec: number | null }, s: MediaSettings): RejectReason | null {
  const allowed: readonly string[] = rule.resource === "audio" ? AUDIO_TYPES : IMAGE_TYPES;
  if (!allowed.includes(input.contentType)) return "type_not_allowed";
  if (input.sizeBytes > maxBytesFor(rule, s)) return "too_large";
  if (rule.resource === "audio" && input.durationSec !== null && input.durationSec > s.maxVoiceSeconds) return "too_long";
  return null;
}

/** What the uploaded file really is, as measured by the storage provider. */
export function checkUploaded(rule: KindRule, actual: { bytes: number; durationSec: number | null }, s: MediaSettings): RejectReason | null {
  if (actual.bytes > maxBytesFor(rule, s)) return "too_large";
  // Allow a small measuring tolerance on the length of a voice note.
  if (rule.resource === "audio" && actual.durationSec !== null && actual.durationSec > s.maxVoiceSeconds + 0.5) return "too_long";
  return null;
}

export function storageKey(rule: KindRule, ownerId: string | null, mediaId: string): string {
  return `${rule.prefix}/${ownerId ?? "unassigned"}/${mediaId}`;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

/** Wait before the next attempt to delete: 1, 2, 4... minutes, at most an hour. */
export function deleteBackoffMs(attempts: number): number { return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000; }

export interface StoredRef { provider: string; key: string; resource: Resource; access: Access; format: string | null }
export interface Variant { width: number; key: string; bytes: number | null }

export interface MediaFile {
  id: string; kind: MediaKind; status: MediaStatus; uploadedBy: string; uploaderKind: PrincipalKind;
  ownerType: OwnerType | null; ownerId: string | null; contentType: string;
  declaredBytes: number; declaredDurationSec: number | null;
  bytes: number | null; durationSec: number | null; storage: StoredRef; variants: Variant[];
  uploadExpiresAt: Date; readyAt: Date | null; attachedAt: Date | null; copiedFromId: string | null;
  deleteAfter: Date | null; deleteReason: string | null; deleteRequestedAt: Date | null; nextDeleteAt: Date | null;
  deleteAttempts: number; deleteError: string | null; deletedAt: Date | null; failReason: string | null;
  createdAt: Date; updatedAt: Date;
}
