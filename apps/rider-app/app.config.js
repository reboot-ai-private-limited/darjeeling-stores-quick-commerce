const fs = require("fs");

/**
 * Adds push notifications (Firebase) to the app.json settings.
 * - Put the Firebase file for this app at apps/rider-app/google-services.json (Firebase console > Project settings > Your apps > Android).
 * - Expo Go ignores all of this: the app runs there, just without push. A development build or the release build receives push.
 */
module.exports = ({ config }) => {
  // A build service (EAS) can supply the file as the GOOGLE_SERVICES_JSON secret, so it never has to be committed.
  const file = process.env.GOOGLE_SERVICES_JSON || "./google-services.json";
  const hasFirebaseFile = fs.existsSync(file);
  if (!hasFirebaseFile && process.env.EAS_BUILD_PROFILE === "production") {
    throw new Error("google-services.json is missing from apps/rider-app. Download it from the Firebase console, or the release build cannot receive notifications.");
  }
  if (!hasFirebaseFile) console.warn("[rider-app] google-services.json not found: builds will not receive push notifications until you add it.");
  return {
    ...config,
    android: { ...config.android, ...(hasFirebaseFile ? { googleServicesFile: file } : {}) },
    plugins: [
      ...(config.plugins ?? []),
      ["expo-location", {
        locationAlwaysAndWhenInUsePermission: "Darjeeling Rider shares your location during your shift, including when the screen is locked, so customers can follow their delivery.",
        locationWhenInUsePermission: "Darjeeling Rider uses your location to punch you in at the store and to guide your delivery.",
        isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true,
      }],
      // Release builds shrink the code; these rules stop it removing classes the notification and background-work libraries need at start-up.
      ["expo-build-properties", { android: { extraProguardRules: [
        // WorkManager (pulled in by notifications and background location) builds its database by name at start-up; shrinking removed it and the app closed at launch.
        "-keep class androidx.work.** { *; }",
        "-keep class * extends androidx.room.RoomDatabase { *; }",
        "-keep class androidx.startup.** { *; }",
        "-dontwarn androidx.work.**",
      ].join("\n") } }],
      ["expo-notifications", { icon: "./assets/android-icon-monochrome.png", color: "#401815", sounds: ["./assets/sounds/new_delivery.wav"] }],
    ],
  };
};
