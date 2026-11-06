import { createHash } from "node:crypto";
import { AppError } from "../../catalog/catalog.public.js";
import type { InspectResult, StorageProvider } from "../application/ports.js";
import type { Resource, StoredRef, Variant } from "../domain/media.js";

export interface CloudinaryConfig {
  cloudName: string; apiKey: string; apiSecret: string;
  /** Where public images are served from. Use a custom domain in front of Cloudinary if you have one. */
  deliveryBaseUrl?: string;
  fetch?: typeof fetch; now?: () => Date; timeoutMs?: number;
}

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * Cloudinary signs a request by hashing its parameters, sorted by name and joined as `name=value&...`, followed by the
 * API secret (SHA-1, hex). The file, API key, cloud name and resource type are not part of the signature.
 */
export function cloudinarySign(params: Params, apiSecret: string): string {
  const text = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return createHash("sha1").update(text + apiSecret).digest("hex");
}

/** Reads the standard `CLOUDINARY_URL` (cloudinary://key:secret@cloud) or the three separate variables. */
export function cloudinaryConfigFromEnv(env: NodeJS.ProcessEnv): CloudinaryConfig | undefined {
  const deliveryBaseUrl = env.CLOUDINARY_DELIVERY_URL;
  const url = env.CLOUDINARY_URL;
  if (url) {
    const match = /^cloudinary:\/\/([^:@/\s]+):([^@/\s]+)@([^/\s]+)\/?$/.exec(url);
    if (match) return { apiKey: match[1]!, apiSecret: match[2]!, cloudName: match[3]!, ...(deliveryBaseUrl && { deliveryBaseUrl }) };
  }
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret, ...(deliveryBaseUrl && { deliveryBaseUrl }) } : undefined;
}

const unavailable = (message = "File storage is not available right now") => new AppError("SERVICE_UNAVAILABLE", message);
const resourceType = (resource: Resource) => (resource === "image" ? "image" : "video"); // Cloudinary stores audio as "video"
const deliveryType = (access: StoredRef["access"]) => (access === "public" ? "upload" : "authenticated");
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const FORMATS: Record<Resource, string> = { image: "jpg,png,webp,heic", audio: "m4a,aac,mp4" };
const DEFAULT_FORMAT: Record<Resource, string> = { image: "jpg", audio: "m4a" };

export function createCloudinaryStorage(config: CloudinaryConfig): StorageProvider {
  const { cloudName, apiKey, apiSecret } = config;
  const http = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const timeout = config.timeoutMs ?? 15_000;
  const api = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}`;
  const delivery = (config.deliveryBaseUrl ?? "https://res.cloudinary.com").replace(/\/+$/, "");
  const seconds = () => Math.floor(now().getTime() / 1000);
  const basic = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try { return await http(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch { throw unavailable(); }
  }
  async function form(path: string, params: Params, extra: Record<string, string> = {}): Promise<Response> {
    const signed = { ...params, signature: cloudinarySign(params, apiSecret), api_key: apiKey };
    const body = new URLSearchParams(extra);
    for (const [name, value] of Object.entries(signed)) if (value !== undefined && value !== null) body.set(name, String(value));
    return call(`${api}/${path}`, { method: "POST", body });
  }
  async function readJson(response: Response): Promise<Record<string, unknown>> {
    try { return (await response.json()) as Record<string, unknown>; } catch { return {}; }
  }

  const signedReadUrl: StorageProvider["signedReadUrl"] = async (ref, ttlSeconds) => {
    const timestamp = seconds();
    const params = { public_id: ref.key, format: ref.format ?? DEFAULT_FORMAT[ref.resource], type: deliveryType(ref.access), expires_at: timestamp + ttlSeconds, timestamp };
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: apiKey, signature: cloudinarySign(params, apiSecret) });
    return { url: `${api}/${resourceType(ref.resource)}/download?${query}`, expiresAt: new Date((timestamp + ttlSeconds) * 1000) };
  };

  return {
    name: "cloudinary",

    async createUpload({ key, resource, access, expiresAt }) {
      const signed = { allowed_formats: FORMATS[resource], overwrite: "false", public_id: key, timestamp: seconds(), type: deliveryType(access) };
      const fields = Object.fromEntries(Object.entries(signed).map(([name, value]) => [name, String(value)]));
      fields.api_key = apiKey;
      fields.signature = cloudinarySign(signed, apiSecret);
      return {
        ref: { provider: "cloudinary", key, resource, access, format: null },
        ticket: { url: `${api}/${resourceType(resource)}/upload`, method: "POST", fields, expiresAt },
      };
    },

    async finalize(ref, { widths }): Promise<InspectResult> {
      const response = await call(`${api}/resources/${resourceType(ref.resource)}/${deliveryType(ref.access)}/${encodeKey(ref.key)}`, { headers: { Authorization: basic } });
      if (response.status === 404) return { exists: false, bytes: 0, format: null, durationSec: null, variants: [] };
      if (!response.ok) throw unavailable();
      const info = await readJson(response);
      const variants: Variant[] = ref.access === "public" && ref.resource === "image" ? widths.map(width => ({ width, key: ref.key, bytes: null })) : [];
      return {
        exists: true, bytes: typeof info.bytes === "number" ? info.bytes : 0, format: typeof info.format === "string" ? info.format : null,
        durationSec: typeof info.duration === "number" ? info.duration : null, variants,
      };
    },

    publicUrl(ref, width) {
      return `${delivery}/${encodeURIComponent(cloudName)}/image/upload/c_limit,w_${width},f_webp,q_auto/${encodeKey(ref.key)}.webp`;
    },

    signedReadUrl,

    async copy(source, destKey) {
      const { url } = await signedReadUrl(source, 300);
      const params = { overwrite: "false", public_id: destKey, timestamp: seconds(), type: deliveryType(source.access) };
      const response = await form(`${resourceType(source.resource)}/upload`, params, { file: url });
      const info = await readJson(response);
      if (!response.ok) throw unavailable("The file could not be copied");
      return {
        ref: { provider: "cloudinary", key: destKey, resource: source.resource, access: source.access, format: typeof info.format === "string" ? info.format : source.format },
        bytes: typeof info.bytes === "number" ? info.bytes : 0, durationSec: typeof info.duration === "number" ? info.duration : null,
      };
    },

    async remove(ref) {
      const response = await form(`${resourceType(ref.resource)}/destroy`, { invalidate: "true", public_id: ref.key, timestamp: seconds(), type: deliveryType(ref.access) });
      const result = (await readJson(response)).result;
      // "not found" means it is already gone, which is the goal.
      if (!response.ok || (result !== "ok" && result !== "not found")) throw new Error(`Cloudinary could not delete the file (${response.status})`);
    },
  };
}
