import { defineConfig } from "vitest/config";
// KEEP_LOCATION_HISTORY: the tracking tests check the stored position history, which is off in normal runs.
export default defineConfig({ test: { include: ["test/integration/**/*.test.ts"], fileParallelism: false, env: { KEEP_LOCATION_HISTORY: "true" } } });
