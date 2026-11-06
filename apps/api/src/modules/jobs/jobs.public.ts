import { hostname } from "node:os";
import type { Connection } from "mongoose";
import { Types } from "mongoose";
import { createJobService } from "./application/job-service.js";
import { createMongoJobStore } from "./infrastructure/mongo-job-store.js";

export type { JobService } from "./application/job-service.js";
export type { EnqueueInput, HandlerOptions, JobContext, JobHandler, JobQueue } from "./application/ports.js";
export { PermanentJobError } from "./domain/job.js";

export interface JobsModuleOptions {
  connection: Connection;
  /** Names this process in job records. Defaults to the host name and a random suffix. */
  workerId?: string;
  leaseMs?: number;
}

/**
 * Durable background work. Other modules use `service.queue` to enqueue and cancel, and `service.register` / `service.every`
 * to say what a kind of job does. Call `service.start()` once at server start and `await service.stop()` at shutdown.
 */
export function createJobsModule({ connection, workerId, leaseMs }: JobsModuleOptions) {
  const store = createMongoJobStore(connection);
  const service = createJobService({
    store, now: () => new Date(), newId: () => new Types.ObjectId().toHexString(),
    workerId: workerId ?? `${hostname()}-${new Types.ObjectId().toHexString().slice(-6)}`, ...(leaseMs !== undefined && { leaseMs }),
  });
  return { store, service };
}
