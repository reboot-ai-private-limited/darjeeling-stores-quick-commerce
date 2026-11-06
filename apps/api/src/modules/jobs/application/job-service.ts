import { DEFAULT_MAX_ATTEMPTS, PermanentJobError, retryDelayMs, type Job } from "../domain/job.js";
import type { EnqueueInput, HandlerOptions, JobContext, JobDeps, JobHandler, JobQueue } from "./ports.js";

interface Registered { handler: JobHandler; options: HandlerOptions }
interface Recurring { name: string; everyMs: number; type: string }

/**
 * A work queue kept in MongoDB. Work is taken with one atomic update, so two workers never run the same job at once;
 * a worker that dies loses its hold after `leaseMs` and the job is picked up again. That means a handler can run more
 * than once for the same job, so handlers must be safe to repeat (use dedupe keys and check state first).
 */
export function createJobService(deps: JobDeps) {
  const { store, now, newId, workerId } = deps;
  const leaseMs = deps.leaseMs ?? 5 * 60_000;
  const handlers = new Map<string, Registered>();
  const recurring: Recurring[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let stopped = true;

  const queue: JobQueue = {
    async enqueue(input: EnqueueInput) {
      const at = now();
      const { job, duplicate } = await store.insert({
        id: newId(), type: input.type, payload: input.payload ?? {}, status: "pending", runAt: input.runAt ?? at, attempts: 0,
        maxAttempts: input.maxAttempts ?? handlers.get(input.type)?.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, lockedUntil: null, lockedBy: null,
        dedupeKey: input.dedupeKey ?? null, lastError: null, result: null, createdAt: at, updatedAt: at, completedAt: null,
      });
      return { id: job.id, duplicate };
    },
    cancel: idOrDedupeKey => store.cancel(idOrDedupeKey, now()),
  };

  const contextOf = (job: Job): JobContext => ({ id: job.id, type: job.type, payload: job.payload, attempt: job.attempts, maxAttempts: job.maxAttempts });

  /** The owner's callback must never stop the worker, even if it throws. */
  async function reportExhausted(entry: Registered, job: Job, error: Error): Promise<void> {
    try { await entry.options.onExhausted?.(contextOf(job), error); } catch { /* ignored on purpose */ }
  }

  async function execute(job: Job): Promise<void> {
    const entry = handlers.get(job.type)!;
    // A job whose workers keep dying has used up its tries without ever finishing: stop it instead of running it again.
    if (job.attempts > job.maxAttempts) {
      const error = new Error("The worker stopped before this job finished, too many times");
      if (await store.fail(job.id, workerId, error.message, null, now())) await reportExhausted(entry, job, error);
      return;
    }
    try {
      const result = await entry.handler(contextOf(job));
      await store.complete(job.id, workerId, result ?? null, now());
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const last = cause instanceof PermanentJobError || job.attempts >= job.maxAttempts;
      const at = now();
      const saved = await store.fail(job.id, workerId, error.message.slice(0, 500), last ? null : new Date(at.getTime() + retryDelayMs(job.attempts)), at);
      // Only the worker that still holds the job reports the end; one that lost it to a takeover stays quiet.
      if (last && saved) await reportExhausted(entry, job, error);
    }
  }

  /** Puts due recurring tasks on the queue. Several servers can run this: only one wins each slot. */
  async function tick(): Promise<number> {
    let queued = 0;
    for (const task of recurring) {
      const slot = await store.claimSchedule(task.name, now(), task.everyMs);
      if (slot) { await queue.enqueue({ type: task.type, dedupeKey: `${task.name}@${slot.getTime()}` }); queued++; }
    }
    return queued;
  }

  /** One pass: schedule recurring work, then run every job that is due. Returns how many jobs ran. */
  async function runOnce(limit = 50): Promise<number> {
    await tick();
    let ran = 0;
    while (ran < limit) {
      const job = await store.claimNext(now(), leaseMs, workerId, [...handlers.keys()]);
      if (!job) break;
      await execute(job);
      ran++;
    }
    return ran;
  }

  return {
    queue,
    store,

    /** Say what to do for a kind of job. Jobs of kinds nobody registered stay waiting. */
    register(type: string, handler: JobHandler, options: HandlerOptions = {}): void { handlers.set(type, { handler, options }); },

    /** Run `handler` every `everyMs`, once across all servers per interval. */
    async every(name: string, everyMs: number, handler: () => Promise<unknown>, options: HandlerOptions = {}): Promise<void> {
      const type = `recurring:${name}`;
      handlers.set(type, { handler: async () => handler(), options: { maxAttempts: 1, ...options } });
      recurring.push({ name, everyMs, type });
      await store.ensureSchedule(name, everyMs, new Date(now().getTime() + everyMs));
    },

    runOnce,
    tick,
    stats: () => store.counts(),

    /** Start polling. Safe to call twice. Call `stop()` on shutdown. */
    start(pollMs = 2000): void {
      if (!stopped) return;
      stopped = false;
      const loop = () => {
        running = runOnce().then(() => undefined, () => undefined).then(() => { if (!stopped) timer = setTimeout(loop, pollMs); });
      };
      loop();
    },

    /** Stop polling and wait for the job in progress to finish. */
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

export type JobService = ReturnType<typeof createJobService>;
