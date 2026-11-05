import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  mockOTP: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/\S+$/, "must be a MongoDB URI"),
  CORS_ORIGINS: z.string().default("").transform(value => value.split(",").map(origin => origin.trim()).filter(Boolean)).refine(origins => origins.every(origin => {
    try { const url = new URL(origin); return ["http:", "https:"].includes(url.protocol) && url.origin === origin; } catch { return false; }
  }), "must be comma-separated HTTP origins"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
}).superRefine((config, context) => {
  if (config.mockOTP && config.NODE_ENV !== "development") context.addIssue({ code: "custom", path: ["mockOTP"], message: "Mock OTP requires development mode" });
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(issue => issue.path.join(".")))].join(", ")}`);
  return result.data;
}
