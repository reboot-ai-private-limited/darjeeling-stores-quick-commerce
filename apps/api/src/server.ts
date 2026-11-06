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
  } catch { console.error(JSON.stringify({ event: "geography_initialization_failed" })); await disconnectDatabase(); process.exitCode = 1; return; }
  if (config.mockOTP) console.warn(JSON.stringify({ event: "development_mock_otp_enabled" }));
  const appConfig = createAppConfigModule(config.PUBLIC_APP_CONFIG_JSON);
  additionalRoutes.push(...appConfig.routes);
  const app = createApp({ isReady: isDatabaseReady, corsOrigins: config.CORS_ORIGINS, trustProxyHops: config.TRUST_PROXY_HOPS, additionalRoutes, maintenance: appConfig.maintenance });
  const server = app.listen(config.PORT, config.mockOTP ? "127.0.0.1" : "0.0.0.0", () => console.info(JSON.stringify({ event: "server_listening", port: config.PORT })));
  server.on("error", () => { console.error(JSON.stringify({ event: "server_error" })); process.exit(1); });
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void shutdown(server, disconnectDatabase).then(
        () => { console.info(JSON.stringify({ event: "shutdown_complete" })); process.exitCode = 0; },
        () => { console.error(JSON.stringify({ event: "shutdown_failed" })); process.exit(1); },
      );
    });
  }
}
void main();
