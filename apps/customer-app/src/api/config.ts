import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the API lives.
 * - Set EXPO_PUBLIC_API_URL (for example http://192.168.1.8:4000) to point at a specific server.
 * - Otherwise, in development, we use the address of the PC running Expo: your phone already reaches that PC to load the app,
 *   and the API runs on the same PC at port 4000 (the API must be started with API_HOST=0.0.0.0 so a phone can reach it).
 */
function devHost(): string {
  const hostUri = Constants.expoConfig?.hostUri; // for example "192.168.1.8:8081"
  if (hostUri) return hostUri.split(":")[0]!;
  return Platform.OS === "android" ? "10.0.2.2" : "localhost"; // Android emulator reaches the PC at 10.0.2.2
}

export const API_ORIGIN = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "") ?? `http://${devHost()}:4000`;
export const API_URL = `${API_ORIGIN}/api/v1`;
