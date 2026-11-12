import type { MediaFile, MediaSettings, MediaStatus, OwnerType, Principal, Resource, Access, StoredRef, Variant, MediaKind } from "../domain/media.js";

/** A file the client uploads directly to the storage provider with this signed request. */
export interface UploadTicket { url: string; method: "POST"; fields: Record<string, string>; expiresAt: Date }

export interface InspectResult {
  exists: boolean; bytes: number; format: string | null; durationSec: number | null; variants: Variant[];
}

/**
 * Everything the media module needs from a file store. Cloudinary is the first implementation; S3 (with CloudFront)
 * is another implementation of this same interface, so nothing outside `infrastructure/` depends on a provider.
 */
export interface StorageProvider {
  readonly name: string;
  /** A signed request the client uses to upload straight to the provider. The file lands at `key`. */
  createUpload(spec: { key: string; resource: Resource; access: Access; contentType: string; maxBytes: number; expiresAt: Date }): Promise<{ ref: StoredRef; ticket: UploadTicket }>;
  /** Called after the client says it finished: confirms the file is there, measures it, and prepares any sizes (S3 resizes here). */
  finalize(ref: StoredRef, kind: { widths: readonly number[] }): Promise<InspectResult>;
  /** Public delivery URL for one width, for files that are public images. */
  publicUrl(ref: StoredRef, width: number): string;
  /** A short-lived link to a private file. */
  signedReadUrl(ref: StoredRef, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  /** Copy a file to a new key (private to private). Returns the new file's reference and measurements. */
  copy(source: StoredRef, destKey: string): Promise<{ ref: StoredRef; bytes: number; durationSec: number | null }>;
  /** Delete the file and every size of it. A file that is already gone counts as deleted. Throws when the provider fails. */
  remove(ref: StoredRef, variants: readonly Variant[]): Promise<void>;
}

export interface UpdateOptions {
  /** Only change the row when it is in one of these statuses. */
  from?: readonly MediaStatus[];
}

export interface MediaStore {
  ensureIndexes(): Promise<void>;
  insert(file: MediaFile): Promise<void>;
  get(id: string): Promise<MediaFile | null>;
  getMany(ids: readonly string[]): Promise<MediaFile[]>;
  /** Conditional update. False when the row does not exist or is not in a status of `from`. */
  update(id: string, patch: Partial<MediaFile>, options?: UpdateOptions): Promise<boolean>;
  /** Uploads still waiting for their file, not counting ones whose upload window has passed. */
  countPending(userId: string, now: Date): Promise<number>;
  listByOwner(ownerType: OwnerType, ownerId: string, statuses: readonly MediaStatus[]): Promise<MediaFile[]>;
  findOrderCopy(sourceId: string, orderId: string): Promise<MediaFile | null>;
  setDeleteAfter(ownerType: OwnerType, ownerId: string, kinds: readonly MediaKind[], deleteAfter: Date): Promise<number>;
  listDeleteDue(now: Date, limit: number): Promise<MediaFile[]>;
  /** Rows waiting for their next delete attempt. */
  listDeleteRetries(now: Date, limit: number): Promise<MediaFile[]>;
  listFailedDeletions(limit: number): Promise<MediaFile[]>;
  /** Uploads never finished, and ready files never attached to an owner, older than the cutoff. */
  listStale(cutoff: Date, limit: number): Promise<MediaFile[]>;
}

/** Decides who may read a private file beyond the person who uploaded it. Order and warehouse facts come from other modules. */
export interface AccessPolicy {
  riderCanRead(riderId: string, file: MediaFile): Promise<boolean>;
  staffCanRead(staff: Principal, file: MediaFile): Promise<boolean>;
}

export interface MediaDeps {
  store: MediaStore; storage: StorageProvider; policy: AccessPolicy; settings: MediaSettings;
  now: () => Date; newId: () => string;
}
