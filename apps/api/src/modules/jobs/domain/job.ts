export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string; type: string; payload: Record<string, unknown>; status: JobStatus;
  /** Not run before this time. */
  runAt: Date;
  /** Counts every time the job was picked up, including a pick-up after a crash. */
  attempts: number; maxAttempts: number;
  /** While a worker holds the job, until when. After that another worker may take it over. */
  lockedUntil: Date | null; lockedBy: string | null;
  /** Another job with the same key is the same job: enqueuing it again does nothing. */
  dedupeKey: string | null;
  lastError: string | null; result: unknown;
  createdAt: Date; updatedAt: Date; completedAt: Date | null;
}

export const DEFAULT_MAX_ATTEMPTS = 5;

/** Wait before the next try: 30 s, 1 min, 2 min... at most an hour. */
export function retryDelayMs(attempts: number): number { return Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempts - 1)); }

/** Thrown by a handler to stop retrying: the work can never succeed (for example, the message has no recipient). */
export class PermanentJobError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentJobError"; }
}
