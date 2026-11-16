import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Location from "expo-location";
import { Platform } from "react-native";
import { loadSession } from "./api/http";
import { sendLocation, type LocationPoint } from "./api/rider";

/**
 * Keeps sharing the rider's position while the app is in the background or the phone is locked (for the live map the customer sees).
 * This needs a real build (a development build or the release build). Expo Go cannot do it: there the app only shares its position
 * while it is open on screen, as before, and everything here quietly does nothing.
 */
export const backgroundTrackingSupported = Platform.OS === "android" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

const TASK = "rider-background-location";
/** Positions that failed to send (offline), kept to retry with the next batch. Capped so memory stays small. */
const MAX_UNSENT = 200;
let unsent: LocationPoint[] = [];
type TaskManager = typeof import("expo-task-manager");
let manager: TaskManager | null | undefined;
function tasks(): TaskManager | null {
  if (!backgroundTrackingSupported) return null;
  if (manager === undefined) { try { manager = require("expo-task-manager") as TaskManager; } catch { manager = null; } }
  return manager;
}

// The task must be defined when the app starts (this file is imported by the root layout), because Android can start the app
// in the background just to deliver a position.
const taskManager = tasks();
if (taskManager) {
  taskManager.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    try {
      await loadSession(); // a background start has no session in memory yet
      const points: LocationPoint[] = data.locations.map(p => ({
        location: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracyM: p.coords.accuracy ?? null,
        speedKmh: p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6) : null, at: new Date(p.timestamp).toISOString(),
      }));
      // Points that could not be sent earlier (no signal) go out first, oldest to newest, so the trail has no gap.
      const batch = [...unsent, ...points];
      unsent = [];
      try { await sendLocation(batch); } catch { unsent = batch.slice(-MAX_UNSENT); }
    } catch { /* signed out: nothing to send */ }
  });
}

export type BackgroundPermission = "granted" | "denied" | "unavailable";

export async function backgroundPermission(): Promise<BackgroundPermission> {
  if (!backgroundTrackingSupported) return "unavailable";
  try { return (await Location.getBackgroundPermissionsAsync()).status === "granted" ? "granted" : "denied"; } catch { return "unavailable"; }
}

/** "Allow all the time". Android asks for the normal location permission first and then sends the rider to the phone's settings for this one. */
export async function askBackgroundPermission(): Promise<BackgroundPermission> {
  if (!backgroundTrackingSupported) return "unavailable";
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== "granted") await Location.requestForegroundPermissionsAsync();
    return (await Location.requestBackgroundPermissionsAsync()).status === "granted" ? "granted" : "denied";
  } catch { return "unavailable"; }
}

/** Starts sharing in the background, with the permanent "On shift" notice Android requires for it. Safe to call again. */
export async function startBackgroundTracking(): Promise<void> {
  if (!tasks() || (await backgroundPermission()) !== "granted") return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) return;
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 20, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
      // killServiceOnDestroy: false keeps sharing after the rider swipes the app away; it stops only when the shift ends, a break starts, or they sign out.
      foregroundService: { notificationTitle: "You are on shift", notificationBody: "Sharing your location for deliveries.", notificationColor: "#0F9D1F", killServiceOnDestroy: false },
    });
  } catch { /* the phone refused or the build has no background location: the open app still shares its position */ }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!tasks()) return;
  try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch { /* already stopped */ }
}
