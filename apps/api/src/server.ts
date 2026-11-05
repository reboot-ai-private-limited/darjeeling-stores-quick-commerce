import { shutdown } from "./shutdown.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase, disconnectDatabase, isDatabaseReady } from "./shared/db/mongo.js";

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(process.env); }
  catch (error) { console.error(error instanceof Error ? error.message : "Invalid configuration"); process.exitCode = 1; return; }
  try { await connectDatabase(config.MONGODB_URI); }
  catch { console.error(JSON.stringify({ event: "database_connection_failed" })); process.exitCode = 1; return; }
  const app = createApp({ isReady: isDatabaseReady, corsOrigins: config.CORS_ORIGINS, trustProxyHops: config.TRUST_PROXY_HOPS });
  const server = app.listen(config.PORT, () => console.info(JSON.stringify({ event: "server_listening", port: config.PORT })));
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
