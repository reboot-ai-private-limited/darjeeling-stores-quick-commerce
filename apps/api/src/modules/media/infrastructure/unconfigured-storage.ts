import { AppError } from "../../catalog/catalog.public.js";
import type { StorageProvider } from "../application/ports.js";

const off = () => new AppError("SERVICE_UNAVAILABLE", "File storage is not configured on this server");

/** Used when no storage credentials are set: every operation that needs the store answers 503 instead of pretending to work. */
export const unconfiguredStorage: StorageProvider = {
  name: "unconfigured",
  createUpload: async () => { throw off(); },
  finalize: async () => { throw off(); },
  publicUrl: () => "",
  signedReadUrl: async () => { throw off(); },
  copy: async () => { throw off(); },
  remove: async () => { throw off(); },
};
