import { Router } from "express";
import { dev1Routes } from "./composition/dev1.js";
import { dev2Routes } from "./composition/dev2.js";
import { assertUniqueRoutes, type Route } from "./platform/routes.js";

export function createContainer(isReady: () => boolean, additionalRoutes: Route[] = []) {
  const routes = [...dev1Routes(isReady), ...dev2Routes(), ...additionalRoutes];
  assertUniqueRoutes(routes);
  const router = Router();
  for (const route of routes) router[route.method](route.path, route.handler);
  return { router };
}
