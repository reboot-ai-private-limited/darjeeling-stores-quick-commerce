import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api/http";

/**
 * Push notifications (Firebase). They need a real build that contains Firebase: a development build or the release build.
 * Expo Go cannot receive them, so there everything here quietly does nothing and the rest of the app works as usual.
 */
export const pushSupported = Platform.OS === "android" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type Notifications = typeof import("expo-notifications");
let loaded: Notifications | null | undefined;
/** The notifications module, loaded only where it works (loading it in Expo Go would print errors). */
function notifications(): Notifications | null {
  if (!pushSupported) return null;
  if (loaded === undefined) {
    try { loaded = require("expo-notifications") as Notifications; } catch { loaded = null; }
  }
  return loaded;
}

/** The sound file is added to the app by the expo-notifications plugin (see app.config.js) and is long enough to ring for ~25 seconds. */
export const ASSIGNMENT_CHANNEL = "new_delivery";
let currentToken: string | null = null;

async function createChannels(n: Notifications) {
  // A new delivery rings like a phone call: loudest level, ringtone sound that also plays in silent-by-default setups, strong buzzing, shown on the lock screen.
  await n.setNotificationChannelAsync(ASSIGNMENT_CHANNEL, {
    name: "New delivery ringing",
    description: "Rings when an order is assigned to you.",
    importance: n.AndroidImportance.MAX,
    sound: "new_delivery.wav",
    enableVibrate: true,
    vibrationPattern: [0, 900, 400, 900, 400, 900, 400, 900],
    enableLights: true,
    lightColor: "#FFC933",
    bypassDnd: true,
    lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: { usage: n.AndroidAudioUsage.NOTIFICATION_RINGTONE, contentType: n.AndroidAudioContentType.SONIFICATION, flags: { enforceAudibility: true, requestHardwareAudioVideoSynchronization: false } },
  });
  await n.setNotificationChannelAsync("default", { name: "Updates", importance: n.AndroidImportance.HIGH, sound: "default", vibrationPattern: [0, 250, 250, 250] });
}

/** Asks permission, makes the Android channels, and tells the server this phone's Firebase token. Never throws: push is a bonus. */
export async function registerPush(): Promise<void> {
  const n = notifications();
  if (!n) return;
  try {
    await createChannels(n);
    let permission = await n.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await n.requestPermissionsAsync();
    if (!permission.granted) return;
    // On Android this is the Firebase (FCM) token, which is what the server sends to.
    const token = String((await n.getDevicePushTokenAsync()).data);
    currentToken = token;
    await api("POST", "/devices", { fcmToken: token, platform: "android", app: "rider", appVersion: Constants.expoConfig?.version ?? "0.1.0" });
  } catch { /* no Firebase in this build, offline, or permission refused: the app still works without push */ }
}

/** For the permissions screen. "unavailable" in Expo Go, where push cannot work (the app is fine without it). */
export async function notificationPermission(): Promise<"granted" | "denied" | "unavailable"> {
  const n = notifications();
  if (!n) return "unavailable";
  try { return (await n.getPermissionsAsync()).granted ? "granted" : "denied"; } catch { return "unavailable"; }
}
export async function askNotificationPermission(): Promise<"granted" | "denied" | "unavailable"> {
  const n = notifications();
  if (!n) return "unavailable";
  try { await registerPush(); return (await n.getPermissionsAsync()).granted ? "granted" : "denied"; } catch { return "unavailable"; }
}

/** On sign-out: stop sending this phone's notifications to the account that just left. */
export async function unregisterPush(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (!token || !pushSupported) return;
  try { await api("DELETE", `/devices/${encodeURIComponent(token)}`); } catch { /* the server forgets dead tokens on its own */ }
}

export type PushData = Record<string, unknown>;

/**
 * Listens while the app is open: `onArrive` runs when a push comes in (to refresh the orders), and tapping any notification
 * (even from a closed app) calls `onOpen`.
 */
export function listenForPush(onArrive: (data: PushData) => void, onOpen: (data: PushData) => void): () => void {
  const n = notifications();
  if (!n) return () => undefined;
  try {
    // Even with the app open, a notification shows as a banner and plays its sound (a new delivery rings the same way).
    n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    const received = n.addNotificationReceivedListener(event => onArrive((event.request.content.data ?? {}) as PushData));
    const tapped = n.addNotificationResponseReceivedListener(response => onOpen((response.notification.request.content.data ?? {}) as PushData));
    // The app was closed and a tap opened it.
    void n.getLastNotificationResponseAsync().then(response => { if (response) { onOpen((response.notification.request.content.data ?? {}) as PushData); void n.clearLastNotificationResponseAsync(); } }).catch(() => undefined);
    return () => { received.remove(); tapped.remove(); };
  } catch { return () => undefined; }
}
