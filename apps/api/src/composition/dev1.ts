import { healthRoutes } from "../modules/health/health.public.js";
export function dev1Routes(isReady: () => boolean) { return healthRoutes(isReady); }
