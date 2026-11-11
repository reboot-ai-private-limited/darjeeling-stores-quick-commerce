import { createAccessStore } from "./modules/access/access.public.js";
import { shutdown } from "./shutdown.js";
import mongoose from "mongoose";
import { createDevOtpRoutes } from "./modules/identity/dev-otp.public.js";
import { createAdministrationRoutes } from "./modules/identity/administration.public.js";
import { createStaffAuthRoutes } from "./modules/identity/staff-auth.public.js";
import { createSessionRoutes } from "./modules/identity/session.public.js";
import { createConsumerRoutes } from "./modules/identity/consumer.public.js";
import { createGeographyModule } from "./modules/geography/geography.public.js";
import { createStaffActorResolver, trustedCookieMutation } from "./modules/identity/session.public.js";
import { createAppConfigModule } from "./modules/settings/app-config.public.js";
import { createAdminModules } from "./composition/admin.js";
import { createProduction } from "./composition/production.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase, disconnectDatabase, isDatabaseReady } from "./shared/db/mongo.js";

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(process.env); }
  catch (error) { console.error(error instanceof Error ? error.message : "Invalid configuration"); process.exitCode = 1; return; }
  try { await connectDatabase(config.MONGODB_URI); }
  catch { console.error(JSON.stringify({ event: "database_connection_failed" })); process.exitCode = 1; return; }
  try { await createAccessStore(mongoose.connection).initialize(); }
  catch { console.error(JSON.stringify({ event: "access_initialization_failed" })); await disconnectDatabase(); process.exitCode = 1; return; }
  let additionalRoutes;
  let dev2: ReturnType<typeof createProduction>["routes"] | undefined;
  let background: { stop(): Promise<void> } | undefined;
  let geographyModule: ReturnType<typeof createGeographyModule> | undefined;
  try { additionalRoutes = !config.JWT_SECRET ? [] : config.mockOTP
    ? await createDevOtpRoutes(mongoose.connection, config.NODE_ENV, config.JWT_SECRET, config.CORS_ORIGINS, config.AUTH_COOKIE_SECURE, config)
    : await createAdministrationRoutes(mongoose.connection, config.JWT_SECRET, config.CORS_ORIGINS, config); }
  catch { console.error(JSON.stringify({ event: "identity_initialization_failed" })); await disconnectDatabase(); process.exitCode = 1; return; }
  try {
    if (config.JWT_SECRET && config.STAFF_TOTP_KEY) additionalRoutes.push(...await createStaffAuthRoutes(mongoose.connection, config.JWT_SECRET, config.STAFF_TOTP_KEY, config.CORS_ORIGINS, config.AUTH_COOKIE_SECURE, config));
    if (config.JWT_SECRET && !config.mockOTP) additionalRoutes.push(...createSessionRoutes(mongoose.connection, config.JWT_SECRET, config.CORS_ORIGINS, config.AUTH_COOKIE_SECURE, config));
    if (config.JWT_SECRET && !config.mockOTP) additionalRoutes.push(...await createConsumerRoutes(mongoose.connection, config.JWT_SECRET, { mode: config.NODE_ENV, mockOTP: false }, config.CORS_ORIGINS, config.AUTH_COOKIE_SECURE, config));
  } catch { console.error(JSON.stringify({ event: "staff_auth_initialization_failed" })); await disconnectDatabase(); process.exitCode = 1; return; }
  try {
    const geography = createGeographyModule({
      connection: mongoose.connection,
      resolveActor: config.JWT_SECRET
        ? createStaffActorResolver(mongoose.connection, config.JWT_SECRET, config, config.mockOTP)
        : () => null,
      validateCsrf: (req) => trustedCookieMutation(req, config.CORS_ORIGINS),
    });
    await geography.ensureIndexes();
    additionalRoutes.push(...geography.routes);
    geographyModule = geography;
  } catch { console.error(JSON.stringify({ event: "geography_initialization_failed" })); await disconnectDatabase(); process.exitCode = 1; return; }
  try {
    if (config.JWT_SECRET) {
      const admin = createAdminModules({
        connection: mongoose.connection, trustedOrigins: config.CORS_ORIGINS,
        resolveStaff: createStaffActorResolver(mongoose.connection, config.JWT_SECRET, config, config.mockOTP),
      });
      await admin.ensureIndexes();
      additionalRoutes.push(...admin.routes);
      // The catalog, orders, payments, delivery and notification modules, connected to the real zones, to every kind of sign-in and to the
      // owner's settings, with their background work (payment expiry, alerts, notifications, cleanup) running.
      const production = createProduction({ connection: mongoose.connection, config: { ...config, JWT_SECRET: config.JWT_SECRET }, geography: geographyModule!, admin });
      dev2 = production.routes;
      background = await production.start();
    }
  } catch (error) { console.error(JSON.stringify({ event: "admin_initialization_failed", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" })); await background?.stop().catch(() => undefined); await disconnectDatabase(); process.exitCode = 1; return; }
  if (config.mockOTP) console.warn(JSON.stringify({ event: "development_mock_otp_enabled" }));
  const appConfig = createAppConfigModule(config.PUBLIC_APP_CONFIG_JSON);
  additionalRoutes.push(...appConfig.routes);
  const app = createApp({ isReady: isDatabaseReady, corsOrigins: config.CORS_ORIGINS, trustProxyHops: config.TRUST_PROXY_HOPS, rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE, additionalRoutes, ...(dev2 && { dev2Routes: dev2 }), maintenance: appConfig.maintenance });
  // The development login (mockOTP) listens on this PC only. `API_HOST=0.0.0.0` is an explicit opt-in for testing the rider app
  // on a phone over Wi-Fi; anyone on that network could then use the 000000 development login, so never set it outside local development.
  const host = process.env.API_HOST?.trim() || (config.mockOTP ? "127.0.0.1" : "0.0.0.0");
  if (config.mockOTP && host !== "127.0.0.1") console.warn(JSON.stringify({ event: "development_mock_otp_exposed_to_network", host }));
  const server = app.listen(config.PORT, host, () => console.info(JSON.stringify({ event: "server_listening", port: config.PORT, host })));
  server.on("error", () => { console.error(JSON.stringify({ event: "server_error" })); process.exit(1); });
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void shutdown(server, async () => { await background?.stop(); await disconnectDatabase(); }).then(
        () => { console.info(JSON.stringify({ event: "shutdown_complete" })); process.exitCode = 0; },
        () => { console.error(JSON.stringify({ event: "shutdown_failed" })); process.exit(1); },
      );
    });
  }
}
void main();
