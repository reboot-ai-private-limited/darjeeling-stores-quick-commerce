import type { Review } from "../domain/sync.js";

export interface EventClaim { riderId: string; clientEventId: string; seq: number; type: string; orderId: string | null; deviceTime: Date; receivedAt: Date }
export interface EventOutcome { result: "applied" | "duplicate" | "conflict"; reason: string | null; message: string | null }
export type NewReview = Omit<Review, "id" | "status" | "outcome" | "note" | "resolvedBy" | "resolvedAt">;

export interface SyncStore {
  ensureIndexes(): Promise<void>;
  /** Records that this event is being handled. False when the rider already sent it. */
  claim(event: EventClaim): Promise<boolean>;
  finish(riderId: string, clientEventId: string, outcome: EventOutcome): Promise<void>;
  /** Forgets a claim whose handling failed unexpectedly, so a retry can run it. */
  release(riderId: string, clientEventId: string): Promise<void>;
  openReview(review: NewReview): Promise<void>;
  getReview(orderId: string): Promise<Review | null>;
  listReviews(filter: { status?: "open" | "resolved"; warehouseIds?: readonly string[]; from?: Date; to?: Date }, limit: number, beforeId?: string): Promise<Review[]>;
  openCount(warehouseIds?: readonly string[]): Promise<number>;
  closeReview(orderId: string, patch: { outcome: "accepted" | "rejected"; note: string | null; by: string; at: Date }): Promise<boolean>;
  reopenReview(orderId: string): Promise<void>;
}
