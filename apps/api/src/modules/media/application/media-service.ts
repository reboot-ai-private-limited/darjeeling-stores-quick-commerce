import { randomUUID } from "node:crypto";
import { AppError, conflict, forbidden, notFound, validation } from "../../catalog/catalog.public.js";
import {
  CUSTOMER_DELETABLE, EVIDENCE_KINDS, ORDER_COPY_KINDS, ORDER_COPY_OF, RULES, WIDTHS, addDays, canUpload, checkDeclared, checkUploaded,
  deleteBackoffMs, hasAny, maxBytesFor, storageKey,
  type MediaFile, type MediaKind, type MediaStatus, type OwnerType, type Principal, type RejectReason,
} from "../domain/media.js";
import { DuplicateMediaError } from "./errors.js";
import type { AuditEntry, MediaDeps } from "./ports.js";

const UPLOAD_TTL_MS = 15 * 60_000;
const SIGNED_URL_SECONDS = 300;
const LIVE: readonly MediaStatus[] = ["pending", "processing", "ready", "failed"];

export interface UploadRequest {
  kind: MediaKind; contentType: string; sizeBytes: number; durationSec: number | null; ownerRef: { type: OwnerType; id: string } | null;
}
/** Who is acting and for which request. Background work passes `null` and is recorded as the system. */
export interface Actor { principal: Principal; requestId: string }

const rejected = (reason: RejectReason | "too_many_pending", message: string) => new AppError("UPLOAD_REJECTED", message, { reason });
const REJECT_MESSAGE: Record<RejectReason, string> = {
  type_not_allowed: "This file type is not allowed", too_large: "The file is too large", too_long: "The recording is too long",
};

/** File storage for photos and voice notes (F24). Everything provider-specific is behind `deps.storage`. */
export function createMediaService(deps: MediaDeps) {
  const { store, storage, policy, settings, now, newId } = deps;

  const summary = (file: MediaFile) => ({ mediaId: file.id, status: file.status, kind: file.kind, contentType: file.contentType });

  function urlsOf(file: MediaFile): Record<string, string> | undefined {
    const rule = RULES[file.kind];
    if (rule.access !== "public" || rule.resource !== "image" || file.status !== "ready") return undefined;
    return Object.fromEntries(WIDTHS.map(width => [String(width), storage.publicUrl(file.storage, width)]));
  }

  /** A file that has been deleted reads as gone; one removed on schedule says so, so the app can show "voice note expired". */
  function missing(file: MediaFile | null): never {
    if (file && (file.status === "deleting" || file.status === "deleted") && file.deleteReason === "expired") {
      throw new AppError("NOT_FOUND", "Media not found", { reason: "expired" });
    }
    throw notFound("Media");
  }
  async function visible(id: string): Promise<MediaFile> {
    const file = await store.get(id);
    if (!file || file.status === "deleting" || file.status === "deleted") return missing(file);
    return file;
  }

  async function canView(p: Principal, file: MediaFile): Promise<boolean> {
    const rule = RULES[file.kind];
    if (file.uploadedBy === p.userId) return true;
    if (rule.access === "public" && file.status === "ready") return true;
    if (p.kind === "staff") {
      if (rule.access === "public") return hasAny(p, rule.staffUpload) || hasAny(p, rule.staffRead);
      return hasAny(p, rule.staffRead) && (await policy.staffCanRead(p, file));
    }
    if (p.kind === "rider") return rule.access === "private" && (await policy.riderCanRead(p.userId, file));
    return false;
  }

  function auditFor(actor: Actor | null, action: string, id: string): AuditEntry {
    return {
      actorId: actor?.principal.userId ?? "system", actorRole: actor?.principal.role ?? "system", action, entityId: id,
      requestId: actor?.requestId ?? randomUUID(),
    };
  }

  /** One attempt to remove the stored file. Failure keeps the row `deleting` and schedules a retry with backoff. */
  async function attemptDelete(id: string): Promise<MediaStatus> {
    const file = await store.get(id);
    if (!file) return "deleted";
    if (file.status !== "deleting") return file.status;
    const at = now();
    try {
      await storage.remove(file.storage, file.variants);
      await store.update(id, { status: "deleted", deletedAt: at, variants: [], deleteError: null, nextDeleteAt: null, updatedAt: at }, { from: ["deleting"] });
      return "deleted";
    } catch (error) {
      const attempts = file.deleteAttempts + 1;
      const message = error instanceof Error ? error.message : "Delete failed";
      await store.update(id, {
        deleteAttempts: attempts, deleteError: message.slice(0, 500), nextDeleteAt: new Date(at.getTime() + deleteBackoffMs(attempts)), updatedAt: at,
      }, { from: ["deleting"] });
      return "deleting";
    }
  }

  /** The one way a file is removed: mark it `deleting` with an audit entry, then delete it from storage. */
  async function startDelete(file: MediaFile, reason: string, actor: Actor | null): Promise<MediaStatus> {
    const at = now();
    const started = await store.update(file.id, { status: "deleting", deleteReason: reason, deleteRequestedAt: at, nextDeleteAt: at, updatedAt: at }, {
      from: LIVE, audit: auditFor(actor, "media.delete", file.id),
    });
    if (!started) {
      const current = await store.get(file.id);
      if (!current || current.status !== "deleting") return current?.status ?? "deleted";
    }
    return attemptDelete(file.id);
  }

  async function attach(mediaId: string, owner: { type: OwnerType; id: string }): Promise<void> {
    const file = await store.get(mediaId);
    if (!file || file.status !== "ready") throw notFound("Media");
    if (!RULES[file.kind].ownerTypes.includes(owner.type)) throw validation("This file cannot belong to that kind of owner", { field: "mediaId", kind: file.kind });
    if (file.ownerId !== null && (file.ownerId !== owner.id || file.ownerType !== owner.type)) throw conflict("This file already belongs to something else", { field: "mediaId" });
    if (file.ownerId === owner.id) return;
    await store.update(mediaId, { ownerType: owner.type, ownerId: owner.id, attachedAt: now(), updatedAt: now() }, { from: ["ready"] });
  }

  return {
    // ---------- endpoints ----------
    async requestUpload(p: Principal, input: UploadRequest) {
      const rule = RULES[input.kind];
      if (!canUpload(p, rule)) throw forbidden("You cannot upload this kind of file");
      if (input.ownerRef && !rule.ownerTypes.includes(input.ownerRef.type)) throw validation("ownerRef.type does not fit this kind of file", { field: "ownerRef.type" });
      if (rule.resource === "audio" && input.durationSec === null) throw validation("durationSec is required for voice notes", { field: "durationSec" });
      const reason = checkDeclared(rule, input, settings);
      if (reason) throw rejected(reason, REJECT_MESSAGE[reason]);
      if ((await store.countPending(p.userId, now())) >= settings.maxPendingPerUser) throw rejected("too_many_pending", "Too many unfinished uploads; finish or wait for them to expire");

      const id = newId();
      const at = now();
      const expiresAt = new Date(at.getTime() + UPLOAD_TTL_MS);
      const { ref, ticket } = await storage.createUpload({
        key: storageKey(rule, input.ownerRef?.id ?? null, id), resource: rule.resource, access: rule.access,
        contentType: input.contentType, maxBytes: maxBytesFor(rule, settings), expiresAt,
      });
      await store.insert({
        id, kind: input.kind, status: "pending", uploadedBy: p.userId, uploaderKind: p.kind, ownerType: input.ownerRef?.type ?? null, ownerId: input.ownerRef?.id ?? null,
        contentType: input.contentType, declaredBytes: input.sizeBytes, declaredDurationSec: input.durationSec, bytes: null, durationSec: null,
        storage: ref, variants: [], uploadExpiresAt: expiresAt, readyAt: null, attachedAt: input.ownerRef ? at : null, copiedFromId: null,
        deleteAfter: null, deleteReason: null, deleteRequestedAt: null, nextDeleteAt: null, deleteAttempts: 0, deleteError: null, deletedAt: null, failReason: null,
        createdAt: at, updatedAt: at,
      });
      return { mediaId: id, upload: { url: ticket.url, method: ticket.method, fields: ticket.fields, expiresAt: ticket.expiresAt.toISOString() } };
    },

    async complete(p: Principal, mediaId: string) {
      const file = await store.get(mediaId);
      if (!file || file.uploadedBy !== p.userId) throw notFound("Media");
      if (file.status === "deleting" || file.status === "deleted") return missing(file);
      if (file.status !== "pending") return summary(file);
      // Claim the file so two "complete" calls cannot both process it.
      if (!(await store.update(mediaId, { status: "processing", updatedAt: now() }, { from: ["pending"] }))) return summary((await store.get(mediaId)) ?? file);

      const rule = RULES[file.kind];
      let found;
      try { found = await storage.finalize(file.storage, { widths: WIDTHS }); }
      catch (error) { await store.update(mediaId, { status: "pending", updatedAt: now() }, { from: ["processing"] }); throw error; }
      if (!found.exists) {
        await store.update(mediaId, { status: "pending", updatedAt: now() }, { from: ["processing"] });
        throw conflict("Nothing has been uploaded for this file yet", { reason: "not_uploaded" });
      }
      const reason = checkUploaded(rule, found, settings);
      if (reason) {
        // The provider cannot cap the size of a signed upload, so an oversized or overlong file is removed here.
        await store.update(mediaId, { status: "failed", failReason: reason, bytes: found.bytes, updatedAt: now() }, { from: ["processing"] });
        await storage.remove(file.storage, found.variants).catch(() => undefined);
        throw rejected(reason, REJECT_MESSAGE[reason]);
      }
      const at = now();
      await store.update(mediaId, {
        status: "ready", bytes: found.bytes, durationSec: found.durationSec, variants: found.variants, readyAt: at, updatedAt: at,
        storage: { ...file.storage, format: found.format ?? file.storage.format },
      }, { from: ["processing"] });
      return summary((await store.get(mediaId)) ?? file);
    },

    async get(p: Principal, mediaId: string) {
      const file = await visible(mediaId);
      if (!(await canView(p, file))) throw forbidden("You cannot see this file");
      const urls = urlsOf(file);
      return { ...summary(file), ...(urls && { urls }) };
    },

    /** Public images answer with their largest size and no expiry; private files get a link that works for about five minutes. */
    async readUrl(p: Principal, mediaId: string) {
      const file = await visible(mediaId);
      if (file.status !== "ready") throw notFound("Media");
      if (!(await canView(p, file))) throw forbidden("You cannot see this file");
      if (RULES[file.kind].access === "public") return { url: storage.publicUrl(file.storage, WIDTHS[WIDTHS.length - 1]!), expiresAt: null as string | null };
      const signed = await storage.signedReadUrl(file.storage, SIGNED_URL_SECONDS);
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() as string | null };
    },

    /** A link for a file another module has already checked the caller may see (for example the rider's offline bundle). Null when it is gone. */
    async linkFor(mediaId: string): Promise<{ url: string; expiresAt: string | null } | null> {
      const file = await store.get(mediaId);
      if (!file || file.status !== "ready") return null;
      if (RULES[file.kind].access === "public") return { url: storage.publicUrl(file.storage, WIDTHS[WIDTHS.length - 1]!), expiresAt: null };
      const signed = await storage.signedReadUrl(file.storage, SIGNED_URL_SECONDS);
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    },

    async remove(actor: Actor, mediaId: string): Promise<void> {
      const p = actor.principal;
      const file = await visible(mediaId);
      const rule = RULES[file.kind];
      const own = p.kind === "customer" && file.uploadedBy === p.userId && CUSTOMER_DELETABLE.includes(file.kind);
      const staff = p.kind === "staff" && rule.uploaders.includes("staff") && hasAny(p, rule.staffUpload);
      if (!own && !staff) throw forbidden("You cannot delete this file");
      if (staff && rule.access === "public" && file.ownerId !== null && file.status === "ready") {
        throw conflict("This image is in use; remove it from the product, category or banner instead", { reason: "in_use" });
      }
      await startDelete(file, "deleted_by_user", actor);
    },

    // ---------- admin ----------
    async failedDeletions() {
      return (await store.listFailedDeletions(200)).map(f => ({
        mediaId: f.id, kind: f.kind, status: f.status, attempts: f.deleteAttempts, error: f.deleteError, since: (f.deleteRequestedAt ?? f.updatedAt).toISOString(),
      }));
    },

    async retryDelete(actor: Actor, mediaId: string) {
      const file = await store.get(mediaId);
      if (!file) throw notFound("Media");
      if (file.status !== "deleting") throw conflict("This file is not waiting to be deleted", { reason: "not_deleting" });
      await store.update(mediaId, { nextDeleteAt: now(), updatedAt: now() }, { from: ["deleting"], audit: auditFor(actor, "media.retry_delete", mediaId) });
      return { status: await attemptDelete(mediaId) };
    },

    // ---------- for other modules ----------
    /** A ready public image, in the shape the catalog module needs. */
    async describe(mediaId: string): Promise<{ urls: Record<string, string> } | null> {
      const file = await store.get(mediaId);
      const urls = file ? urlsOf(file) : undefined;
      return urls ? { urls } : null;
    },

    async urls(mediaIds: readonly string[]): Promise<Record<string, Record<string, string>>> {
      const out: Record<string, Record<string, string>> = {};
      for (const file of await store.getMany(mediaIds)) { const urls = urlsOf(file); if (urls) out[file.id] = urls; }
      return out;
    },

    /** Delete a file for a system reason (an image removed from a product, an address deleted...). Safe to repeat. */
    async removeInternal(mediaId: string, reason: string, actor: Actor | null = null): Promise<void> {
      const file = await store.get(mediaId);
      if (file && file.status !== "deleted") await startDelete(file, reason, actor);
    },

    /** Attach a ready file to its owner. Throws when the file is not ready, does not fit the owner, or belongs to another owner. */
    attach,

    /**
     * Checks that a file is the customer's own, finished, and of the right kind, then attaches it to its owner. Returns the
     * length of a voice note. For modules that let a customer pick an uploaded file (an address, a refund request).
     */
    async claimOwned(input: { mediaId: string; userId: string; kind: MediaKind; owner: { type: OwnerType; id: string } }): Promise<{ durationSec: number | null }> {
      const file = await store.get(input.mediaId);
      if (!file || file.status !== "ready" || file.uploadedBy !== input.userId || file.kind !== input.kind) throw notFound("Media");
      await attach(input.mediaId, input.owner);
      return { durationSec: file.durationSec };
    },

    /** Let go of a file an owner had claimed, so it can be used again (for example when saving the owner failed). The file is not deleted. */
    async detach(mediaId: string, owner: { type: OwnerType; id: string }): Promise<void> {
      const file = await store.get(mediaId);
      if (file && file.status === "ready" && file.ownerType === owner.type && file.ownerId === owner.id) {
        await store.update(mediaId, { ownerType: null, ownerId: null, attachedAt: null, updatedAt: now() }, { from: ["ready"] });
      }
    },

    /** Copy an address voice note or photo onto an order at placement. The same source and order give the same copy. */
    async copyToOrder(input: { sourceMediaId: string; orderId: string }): Promise<{ mediaId: string; kind: MediaKind }> {
      const source = await store.get(input.sourceMediaId);
      const destKind = source ? ORDER_COPY_OF[source.kind] : undefined;
      if (!source || source.status !== "ready" || !destKind) throw notFound("Media");
      const existing = await store.findOrderCopy(source.id, input.orderId);
      if (existing) return { mediaId: existing.id, kind: existing.kind };

      const id = newId();
      const at = now();
      const copied = await storage.copy(source.storage, storageKey(RULES[destKind], input.orderId, id));
      try {
        await store.insert({
          ...source, id, kind: destKind, status: "ready", ownerType: "order", ownerId: input.orderId, storage: copied.ref, variants: [],
          bytes: copied.bytes, durationSec: copied.durationSec, readyAt: at, attachedAt: at, copiedFromId: source.id, deleteAfter: null, deleteReason: null,
          deleteRequestedAt: null, nextDeleteAt: null, deleteAttempts: 0, deleteError: null, deletedAt: null, failReason: null, createdAt: at, updatedAt: at,
        });
      } catch (error) {
        if (!(error instanceof DuplicateMediaError)) throw error;
        await storage.remove(copied.ref, []).catch(() => undefined);
        const winner = await store.findOrderCopy(source.id, input.orderId);
        if (winner) return { mediaId: winner.id, kind: winner.kind };
        throw error;
      }
      return { mediaId: id, kind: destKind };
    },

    /** Start the clock on an order's voice note and house photo: deleted `orderMediaRetentionDays` after the order ends. */
    async scheduleOrderMediaExpiry(orderId: string, endedAt: Date): Promise<number> {
      return store.setDeleteAfter("order", orderId, ORDER_COPY_KINDS, addDays(endedAt, settings.orderMediaRetentionDays));
    },
    /** Failed-delivery and refund photos are kept `evidenceRetentionDays` after the order closes. */
    async scheduleEvidenceExpiry(orderId: string, closedAt: Date): Promise<number> {
      return store.setDeleteAfter("order", orderId, EVIDENCE_KINDS, addDays(closedAt, settings.evidenceRetentionDays));
    },

    /** Remove everything an owner has (an address was deleted, an account was closed). Returns how many files were started. */
    async removeForOwner(owner: { type: OwnerType; id: string }, reason: string): Promise<number> {
      const files = await store.listByOwner(owner.type, owner.id, LIVE);
      for (const file of files) await startDelete(file, reason, null);
      return files.length;
    },

    // ---------- background work (run periodically; the jobs module schedules it) ----------
    async sweep(limit = 100): Promise<{ expired: number; retried: number; unattached: number }> {
      const at = now();
      const due = await store.listDeleteDue(at, limit);
      for (const file of due) await startDelete(file, "expired", null);
      const retries = await store.listDeleteRetries(at, limit);
      for (const file of retries) await attemptDelete(file.id);
      const stale = await store.listStale(new Date(at.getTime() - settings.unattachedHours * 3_600_000), limit);
      for (const file of stale) await startDelete(file, "unattached", null);
      return { expired: due.length, retried: retries.length, unattached: stale.length };
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;
