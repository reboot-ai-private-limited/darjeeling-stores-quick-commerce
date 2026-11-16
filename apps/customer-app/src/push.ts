import { isRunningInExpoGo } from "expo";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api/http";

/**
 * Push notifications (Firebase). They need a real build that contains Firebase: a development build or the release build.
 * Expo Go cannot receive them, so there everything here quietly does nothing and the rest of the app works as usual.
 * (iPhones are not set up yet: the server sends through Firebase, which needs extra Apple keys. Android works.)
 */
export const pushSupported = Platform.OS === "android" && !isRunningInExpoGo() && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

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

let currentToken: string | null = null;

/** Asks permission, makes the Android channel, and tells the server this phone's Firebase token. Never throws: push is a bonus. */
export async function registerPush(): Promise<void> {
  const n = notifications();
  if (!n) return;
  try {
    await n.setNotificationChannelAsync("default", { name: "Order updates", importance: n.AndroidImportance.HIGH, sound: "default", vibrationPattern: [0, 250, 250, 250], lightColor: "#FFC933" });
    let permission = await n.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await n.requestPermissionsAsync();
    if (!permission.granted) return;
    // On Android this is the Firebase (FCM) token, which is what the server sends to.
    const token = String((await n.getDevicePushTokenAsync()).data);
    currentToken = token;
    await api("POST", "/devices", { fcmToken: token, platform: "android", app: "customer", appVersion: Constants.expoConfig?.version ?? "0.1.0" });
  } catch { /* no Firebase in this build, offline, or permission refused: the app still works without push */ }
}

/** On sign-out: stop sending this phone's notifications to the account that just left. */
export async function unregisterPush(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (!token || !pushSupported) return;
  try { await api("DELETE", `/devices/${encodeURIComponent(token)}`); } catch { /* the server forgets dead tokens on its own */ }
}

export type PushData = Record<string, unknown>;

/** Shows notifications even while the app is open, and calls `onOpen` when one is tapped (also when the tap started a closed app). */
export function listenForPush(onOpen: (data: PushData) => void): () => void {
  const n = notifications();
  if (!n) return () => undefined;
  try {
    n.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    const tapped = n.addNotificationResponseReceivedListener(response => onOpen((response.notification.request.content.data ?? {}) as PushData));
    void n.getLastNotificationResponseAsync().then(response => { if (response) { onOpen((response.notification.request.content.data ?? {}) as PushData); void n.clearLastNotificationResponseAsync(); } }).catch(() => undefined);
    return () => tapped.remove();
  } catch { return () => undefined; }
}
