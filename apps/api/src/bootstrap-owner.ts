import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { loadConfig } from "./config/env.js";
import { createAccessStore } from "./modules/access/access.public.js";
import { createIdentityStore } from "./modules/identity/identity.public.js";
import { createStaffAuthService } from "./modules/identity/staff-auth.public.js";
import { createStaffInput } from "./modules/identity/domain/staff-policy.js";

async function main() {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--file") throw new Error("Usage: bootstrap-owner --file <private-json-file>");
    const config = loadConfig(process.env);
    if (config.mockOTP || !config.JWT_SECRET) throw new Error("Disable mockOTP and configure JWT_SECRET before owner bootstrap");
    const input = createStaffInput.pick({ email: true, name: true, password: true }).parse(JSON.parse(await readFile(process.argv[3]!, "utf8")));
    await mongoose.connect(config.MONGODB_URI);
    await createAccessStore(mongoose.connection).initialize();
    await createIdentityStore(mongoose.connection).initialize();
    const service = createStaffAuthService(mongoose.connection, config.JWT_SECRET, config);
    await service.initialize();
    await service.bootstrap(input);
    console.info("Owner created. Sign in and change the temporary password.");
  } catch {
    console.error("Owner bootstrap failed. Check configuration and the private input file; an existing owner is never replaced.");
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
void main();
