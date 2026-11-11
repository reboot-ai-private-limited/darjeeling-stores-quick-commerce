import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Tiny persistent key-value store: secure storage on the phone, localStorage on the web preview. */
export const kv = {
  get: async (key: string): Promise<string | null> => { try { return Platform.OS === "web" ? globalThis.localStorage?.getItem(key) ?? null : await SecureStore.getItemAsync(key); } catch { return null; } },
  set: async (key: string, v: string) => { try { if (Platform.OS === "web") globalThis.localStorage?.setItem(key, v); else await SecureStore.setItemAsync(key, v); } catch { /* storage unavailable */ } },
  del: async (key: string) => { try { if (Platform.OS === "web") globalThis.localStorage?.removeItem(key); else await SecureStore.deleteItemAsync(key); } catch { /* ignore */ } },
};
