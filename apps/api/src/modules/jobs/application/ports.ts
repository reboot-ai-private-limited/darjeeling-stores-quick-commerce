import type { Job } from "../domain/job.js";

export interface EnqueueInput {
  type: string; payload?: Record<string, unknown>;
  /** Earliest time to run. Default: now. */
  runAt?: Date; maxAttempts?: number;
  /** Enqueuing the same key again returns the first job instead of making a second one. */
  dedupeKey?: string;
}

/** What other modules use: put work on the queue and take it back. */
export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<{ id: string; duplicate: boolean }>;
  /** Cancels a job that has not started, by id or by its dedupe key. False when it already ran or does not exist. */
  cancel(idOrDedupeKey: string): Promise<boolean>;
}

export interface JobContext { id: string; type: string; payload: Record<string, unknown>; attempt: number; maxAttempts: number }
export type JobHandler = (job: JobContext) => Promise<unknown>;
export interface HandlerOptions {
  maxAttempts?: number;
  /** Called once when the last try has failed, so the owner can mark its own record as failed. */
  onExhausted?(job: JobContext, error: Error): Promise<void> | void;
}

export interface JobStore {
  ensureIndexes(): Promise<void>;
  /** Inserts the job, or returns the existing one with the same dedupe key. */
  insert(job: Job): Promise<{ job: Job; duplicate: boolean }>;
  get(id: string): Promise<Job | null>;
  /** Atomically takes the next job that is due (or whose worker's hold has run out) and holds it for `leaseMs`. */
  claimNext(now: Date, leaseMs: number, workerId: string, types: readonly string[]): Promise<Job | null>;
  complete(id: string, workerId: string, result: unknown, at: Date): Promise<boolean>;
  /** Puts the job back for another try at `retryAt`, or marks it failed when `retryAt` is null. */
  fail(id: string, workerId: string, error: string, retryAt: Date | null, at: Date): Promise<boolean>;
  cancel(idOrDedupeKey: string, at: Date): Promise<boolean>;
  counts(): Promise<Record<string, number>>;
  /** Moves a recurring schedule on by one interval if it is due, returning the slot that was claimed. Only one caller wins. */
  claimSchedule(name: string, now: Date, intervalMs: number): Promise<Date | null>;
  ensureSchedule(name: string, intervalMs: number, firstRunAt: Date): Promise<void>;
}

export interface JobDeps {
  store: JobStore; now: () => Date; newId: () => string; workerId: string;
  /** How long a worker holds a job before another may take it over. */
  leaseMs?: number;
}
