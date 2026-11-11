import { Platform } from "react-native";
import { api } from "./http";

export type AppConfig = { minSupportedVersion?: string; latestVersion?: string; forceUpdate?: boolean; downloadUrl?: string; maintenance?: { active: boolean; message: string | null }; supportNumber?: string };
export const getAppConfig = (version: string) =>
  api<AppConfig>("GET", `/app/config?app=customer&platform=${Platform.OS === "ios" ? "ios" : "android"}&version=${encodeURIComponent(version)}`, undefined, { auth: false }).then(r => r.data);

export type Zone = { id: string; name: string; cityId: string };
export type Resolved = { deliverable: boolean; paused?: boolean; zone?: Zone };
export const resolveLocation = (point: { lat: number; lng: number } | { localityId: string }) =>
  api<Resolved>("POST", "/location/resolve", point, { auth: false }).then(r => r.data);
export type City = { id: string; name: string; state: string };
export const getCities = () => api<City[]>("GET", "/cities", undefined, { auth: false }).then(r => r.data);
export type Locality = { id: string; name: string; cityId?: string; location: { lat: number; lng: number }; zoneId?: string | null; travelMinutes?: number };
export const getLocalities = (cityId: string) => api<Locality[]>("GET", `/localities?cityId=${cityId}`, undefined, { auth: false }).then(r => r.data);
export const joinWaitlist = (phone: string, where: { lat: number; lng: number } | { localityId: string }) =>
  api("POST", "/waitlist", { phone, ...("localityId" in where ? { localityId: where.localityId } : { location: where }) }, { auth: false });
