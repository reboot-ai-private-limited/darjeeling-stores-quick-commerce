import { Platform } from "react-native";
import { api, ApiError, clearSession, refreshTokenValue, saveSession } from "./http";

export const toE164 = (digits: string) => `+91${digits.replace(/\D/g, "").slice(-10)}`;

export type Me = { id: string; name: string; phone: string; email: string | null; defaultAddressId?: string | null; codAllowed?: boolean };

export async function requestOtp(digits: string): Promise<void> {
  try {
    await api("POST", "/auth/request-otp", { phone: toE164(digits), app: "customer" }, { auth: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new ApiError("Too many code requests. Please wait a while and try again.", e.status, e.code);
    if (e instanceof ApiError && e.code === "OTP_REQUEST_REJECTED") throw new ApiError("This number can't be used to sign in. Please contact support.", e.status, e.code);
    throw e;
  }
}

/** Returns `{ attemptsLeft }` for a wrong code, or `{ isNewUser }` once signed in. */
export async function verifyOtp(digits: string, otp: string): Promise<{ wrong: true; attemptsLeft?: number } | { wrong?: false; isNewUser: boolean }> {
  try {
    const { data } = await api<{ accessToken: string; refreshToken: string; isNewUser?: boolean }>(
      "POST", "/auth/verify-otp", { phone: toE164(digits), otp, deviceInfo: `${Platform.OS} ${String(Platform.Version)} · customer app` }, { auth: false });
    await saveSession(data);
    return { isNewUser: !!data.isNewUser };
  } catch (e) {
    if (e instanceof ApiError && (e.code === "INVALID_OTP" || e.code === "OTP_MISMATCH")) return { wrong: true, attemptsLeft: Number(e.details?.attemptsLeft) || undefined };
    if (e instanceof ApiError && e.code === "OTP_EXPIRED") throw new ApiError("That code has expired. Go back and request a new one.", e.status, e.code);
    if (e instanceof ApiError && e.code === "OTP_LOCKED") throw new ApiError("Too many wrong codes. Try again in 15 minutes.", e.status, e.code);
    throw e;
  }
}

export const getMe = () => api<Me>("GET", "/me").then(r => r.data);
export const updateMe = (body: { name?: string; email?: string }) => api<Me>("PUT", "/me", body).then(r => r.data);

export async function signOutRemote(): Promise<void> {
  const refreshToken = refreshTokenValue();
  try { if (refreshToken) await api("POST", "/auth/logout", { refreshToken }); } catch { /* signing out locally is enough */ }
  await clearSession();
}
