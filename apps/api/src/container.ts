import { createHealthRouter } from "./modules/health/health.public.js";

export function createContainer(isReady: () => boolean) {
  return { healthRouter: createHealthRouter(isReady) };
}
