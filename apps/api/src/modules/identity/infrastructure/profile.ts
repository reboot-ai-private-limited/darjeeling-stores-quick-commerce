import type { ClientSession, Connection, Types } from "mongoose";

export type IdentityUser = {
  _id: Types.ObjectId; kind: "staff" | "customer" | "rider"; roleId: Types.ObjectId; status: string; name: string;
  email?: string; phone?: string; scope?: { all: boolean; warehouseIds: Types.ObjectId[] };
  devMockAccount?: boolean; credentialRevision?: number; defaultAddressId?: Types.ObjectId | null; codAllowed?: boolean;
  notificationPrefs?: { promoPush: boolean; promoWhatsApp: boolean; cartReminders: boolean };
  deletionRequest?: { reason: string | null; requestedAt: Date }; lastLoginAt?: Date; createdAt?: Date; updatedAt?: Date;
};
export async function readProfile(connection: Connection, userId: Types.ObjectId, allowDevelopmentAccounts = false, session?: ClientSession) {
  const options = session ? { session } : {};
  const user = await connection.collection<IdentityUser>("users").findOne({ _id: userId, status: "active" }, options);
  if (!user || (user.devMockAccount && !allowDevelopmentAccounts)) return null;
  const role = await connection.collection("roles").findOne({ _id: user.roleId }, options);
  if (!role) return null;
  return { id: String(user._id), kind: user.kind, name: user.name, phone: user.phone ?? null, email: user.email ?? null,
    role: String(role.name), status: user.status, permissions: role.permissions as string[],
    scope: user.kind === "staff" ? { all: user.scope?.all === true, warehouseIds: (user.scope?.warehouseIds ?? []).map(String) } : { all: false, warehouseIds: [] },
    defaultAddressId: user.defaultAddressId ? String(user.defaultAddressId) : null, codAllowed: user.codAllowed ?? true,
    notificationPrefs: user.notificationPrefs ?? { promoPush: false, promoWhatsApp: false, cartReminders: false } };
}
