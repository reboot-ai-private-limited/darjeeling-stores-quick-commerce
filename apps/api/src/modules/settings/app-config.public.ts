import { z } from "zod";
import type { Route } from "../../platform/routes.js";

const version = z.string().max(32).regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const difference = left[i]! - right[i]!; if (difference) return Math.sign(difference); }
  return 0;
}
const release = z.object({ minSupportedVersion: version.default("0.0.0"), latestVersion: version.default("0.0.0"), downloadUrl: z.url().refine(value => value.startsWith("https://"), "Use an HTTPS download URL").nullable().default(null) }).strict()
  .refine(value => compareVersions(value.minSupportedVersion, value.latestVersion) <= 0, "Latest version must not be older than the minimum");
export const publicAppPolicy = z.object({
  customer: z.object({ android: release.prefault({}), ios: release.prefault({}) }).strict().prefault({}),
  rider: z.object({ android: release.prefault({}) }).strict().prefault({}),
  maintenance: z.object({ active: z.boolean().default(false), message: z.string().trim().max(1000).nullable().default(null) }).strict().prefault({}),
  supportNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().default(null),
}).strict();
const query = z.object({ app: z.enum(["customer", "rider"]), platform: z.enum(["android", "ios"]), version }).strict()
  .refine(value => value.app !== "rider" || value.platform === "android", "The rider app supports Android only");
export function createAppConfigModule(input: unknown = {}) {
  const policy = publicAppPolicy.parse(input);
  const routes: Route[] = [{ method: "get", path: "/app/config", handler: (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid app configuration query", requestId: res.getHeader("X-Request-Id") } });
    const { app, platform, version: current } = parsed.data;
    const release = app === "rider" ? policy.rider.android : policy.customer[platform];
    return res.json({ data: { ...release, forceUpdate: compareVersions(current, release.minSupportedVersion) < 0, maintenance: policy.maintenance, supportNumber: policy.supportNumber } });
  } }];
  return { routes, maintenance: policy.maintenance };
}
