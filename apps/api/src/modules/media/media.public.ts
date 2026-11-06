import type { Connection } from "mongoose";
import { Types } from "mongoose";
import type { MediaPort } from "../catalog/catalog.public.js";
import { createMediaService } from "./application/media-service.js";
import type { AccessPolicy, StorageProvider } from "./application/ports.js";
import { DEFAULT_SETTINGS, type MediaSettings } from "./domain/media.js";
import { cloudinaryConfigFromEnv, createCloudinaryStorage } from "./infrastructure/cloudinary-storage.js";
import { createMongoMediaStore } from "./infrastructure/mongo-media-store.js";
import { unconfiguredStorage } from "./infrastructure/unconfigured-storage.js";
import { mediaRoutes, noPrincipals, type PrincipalResolver } from "./interface/routes.js";

export type { MediaService } from "./application/media-service.js";
export type { AccessPolicy, StorageProvider, UploadTicket } from "./application/ports.js";
export type { MediaFile, MediaKind, MediaSettings, OwnerType, Principal } from "./domain/media.js";
export { cloudinaryConfigFromEnv, cloudinarySign, createCloudinaryStorage, type CloudinaryConfig } from "./infrastructure/cloudinary-storage.js";
export { unconfiguredStorage } from "./infrastructure/unconfigured-storage.js";
export { mediaRoutes, noPrincipals, type PrincipalResolver } from "./interface/routes.js";

/**
 * Until the orders and dispatch modules exist, a rider cannot be shown to be assigned to an order, and a scoped staff
 * member cannot be tied to an order's warehouse. So riders see only their own uploads and only all-scope staff read others' private files.
 */
export const defaultAccessPolicy: AccessPolicy = {
  riderCanRead: async () => false,
  staffCanRead: async staff => staff.scope.all,
};

/** The storage named by environment variables: Cloudinary when its credentials are present, otherwise "not configured". */
export function storageFromEnv(env: NodeJS.ProcessEnv): StorageProvider {
  const cloudinary = cloudinaryConfigFromEnv(env);
  return cloudinary ? createCloudinaryStorage(cloudinary) : unconfiguredStorage;
}

export interface MediaModuleOptions {
  connection: Connection;
  /** Where files live. Cloudinary today; an S3 implementation of `StorageProvider` can replace it without other changes. */
  storage?: StorageProvider;
  /** Resolves the logged-in customer, rider or staff member. Until the identity session is connected, nobody is logged in (401). */
  principal?: PrincipalResolver;
  policy?: AccessPolicy;
  settings?: Partial<MediaSettings>;
}

/** Builds media storage (F24). Call `store.ensureIndexes()` once after the database connects. */
export function createMediaModule(options: MediaModuleOptions) {
  const { connection, storage = unconfiguredStorage, principal = noPrincipals, policy = defaultAccessPolicy } = options;
  const store = createMongoMediaStore(connection);
  const service = createMediaService({
    store, storage, policy, settings: { ...DEFAULT_SETTINGS, ...options.settings }, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
  });
  /** What the catalog module asks of media: look up images, claim one for a product, delete one. */
  const catalogPort: MediaPort = {
    describe: mediaId => service.describe(mediaId),
    urls: mediaIds => service.urls(mediaIds),
    remove: (mediaId, reason) => service.removeInternal(mediaId, reason),
    claim: (mediaId, owner) => service.attach(mediaId, owner),
  };
  return { store, service, catalogPort, routes: mediaRoutes(service, principal) };
}
