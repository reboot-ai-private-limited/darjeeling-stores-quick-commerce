import { Schema, Types, type ClientSession, type Connection } from "mongoose";
import { z } from "zod";

const identifier = z.string().regex(/^[a-fA-F0-9]{24}$/);
const userInput = z.object({
  kind: z.enum(["staff", "customer", "rider"]),
  roleId: identifier,
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
  phone: z.string().transform(value => value.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)).optional(),
}).strict().superRefine((value, context) => {
  const field = value.kind === "staff" ? "email" : "phone";
  if (!value[field]) context.addIssue({ code: "custom", path: [field], message: `${field} is required for this account type` });
});

const userSchema = new Schema({
  kind: { type: String, enum: ["staff", "customer", "rider"], required: true, immutable: true },
  roleId: { type: Schema.Types.ObjectId, required: true },
  name: { type: String, required: false, default: "", maxlength: 120 },
  email: { type: String },
  phone: { type: String },
  passwordHash: { type: String, select: false },
  mustChangePassword: { type: Boolean, default: false },
  credentialRevision: { type: Number, default: 0 },
  lastLoginAt: { type: Date },
  defaultAddressId: { type: Schema.Types.ObjectId, default: null },
  codAllowed: { type: Boolean, default: true },
  notificationPrefs: {
    promoPush: { type: Boolean, default: false }, promoWhatsApp: { type: Boolean, default: false }, cartReminders: { type: Boolean, default: false },
  },
  deletionRequest: { reason: { type: String, maxlength: 1000 }, requestedAt: { type: Date } },
  twoFactor: {
    enabled: { type: Boolean, default: false },
    requiresEnrollment: { type: Boolean, default: false },
    secretEncrypted: { type: String, select: false },
    recoveryCodeHashes: { type: [String], select: false },
    lastUsedStep: { type: Number },
  },
  status: { type: String, enum: ["active", "blocked", "deactivated", "deletion_requested", "deleted"], default: "active", required: true },
  scope: {
    all: { type: Boolean, default: false },
    warehouseIds: { type: [Schema.Types.ObjectId], default: [] },
  },
}, { timestamps: true, strict: "throw", collection: "users" });

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } });
userSchema.index({ kind: 1, status: 1, _id: 1 });
userSchema.index({ kind: 1, roleId: 1, _id: 1 });

export function createIdentityStore(connection: Connection) {
  const users = connection.model("IdentityUser", userSchema);
  return {
    async initialize(): Promise<void> {
      await users.createIndexes();
    },
    async lockActiveStaff(id: Types.ObjectId, session: ClientSession) {
      return connection.collection("users").findOneAndUpdate({ _id: id, kind: "staff", status: "active" }, { $inc: { authorizationRevision: 1 } }, { session, returnDocument: "after" });
    },
    async isRoleAssigned(roleId: Types.ObjectId, session: ClientSession) {
      return !!await users.exists({ roleId }).session(session);
    },
    async createUser(input: unknown) {
      const parsed = userInput.parse(input);
      const transaction = await connection.startSession();
      let user;
      try { user = await transaction.withTransaction(async () => {
        const role = await connection.collection("roles").findOneAndUpdate({ _id: new Types.ObjectId(parsed.roleId) }, { $inc: { revision: 1 } }, { session: transaction });
        if (!role) throw new Error("Role does not exist");
        const [created] = await users.create([{
        kind: parsed.kind,
        name: parsed.name,
        roleId: new Types.ObjectId(parsed.roleId),
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.phone !== undefined ? { phone: parsed.phone } : {}),
        }], { session: transaction });
        if (!created) throw new Error("User was not created");
        return created;
      }); } finally { await transaction.endSession(); }
      return {
        id: user._id.toString(),
        kind: parsed.kind,
        roleId: parsed.roleId.toLowerCase(),
        name: parsed.name,
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.phone !== undefined ? { phone: parsed.phone } : {}),
        status: "active" as const,
      };
    },
  };
}
