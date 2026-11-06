/**
 * Login accounts for riders (F01). Dev 1 owns users, roles and sessions; rider management (Dev 2) asks for a rider's account to
 * be created, renamed, switched off or on only through this interface. Switching an account off also ends its sessions.
 */
export interface RiderIdentity {
  /** Creates the login (role `rider`) for a phone so it can sign in with `app: "rider"`. */
  register(input: { name: string; phone: string }): Promise<{ ok: true; userId: string } | { ok: false; reason: "phone_used" }>;
  rename(userId: string, name: string): Promise<void>;
  /** `false` blocks login and revokes every session; `true` allows it again. */
  setActive(userId: string, active: boolean): Promise<void>;
}
