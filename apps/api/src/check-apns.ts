import { ProviderError } from "./modules/notifications/application/ports.js";
import { apnsAdvice, apnsConfigFromEnv, apnsSetupProblems, createApnsPush } from "./modules/notifications/infrastructure/apns-push.js";

/**
 * Checks the iPhone push settings and, with a device token, sends a real test notification.
 *   pnpm --filter @darjeeling/api apns:check                 (checks the settings and Apple's login with a made-up token)
 *   pnpm --filter @darjeeling/api apns:check <device token>  (also sends "Test from Darjeeling Stores" to that phone)
 * Get a device token from the `device_tokens` collection (the `fcmToken` of a row with platform "ios").
 */
async function main() {
  const problems = await apnsSetupProblems(process.env);
  const config = apnsConfigFromEnv(process.env);
  if (!config || problems.length) {
    console.error("APNs settings are not ready:");
    for (const p of problems.length ? problems : ["No APNS_* settings found. Add APNS_KEY_FILE, APNS_KEY_ID and APNS_TEAM_ID to .env."]) console.error(`  - ${p}`);
    process.exitCode = 1; return;
  }
  console.info(`Settings read: team ${config.teamId}, key ${config.keyId}, app ${config.bundleId}, ${config.sandbox ? "SANDBOX (Xcode builds)" : "PRODUCTION (TestFlight / App Store)"}`);
  const push = createApnsPush(config);
  const token = process.argv[2];
  try {
    await push.send({ token: token ?? "a".repeat(64), title: "Test from Darjeeling Stores", body: "Push is working.", data: { type: "test" }, priority: "high" });
    console.info(token ? "OK: Apple accepted the test notification. It should appear on the phone now." : "OK.");
  } catch (error) {
    if (!(error instanceof ProviderError)) { console.error(error); process.exitCode = 1; return; }
    if (!token && error.code === "BadDeviceToken") {
      console.info("OK: Apple accepted the key, Key ID and Team ID (it only refused the made-up token, as expected).");
      console.info("To prove delivery to a phone, run this again with that phone's device token.");
    } else {
      console.error(`FAILED: ${error.message}`);
      const advice = apnsAdvice(error.code);
      if (advice) console.error(`  → ${advice}`);
      process.exitCode = 1;
    }
  }
}
void main();
