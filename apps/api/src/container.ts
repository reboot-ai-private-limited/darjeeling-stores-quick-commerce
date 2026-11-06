import { Router } from "express";
import { dev1Routes } from "./composition/dev1.js";
import { dev2Routes } from "./composition/dev2.js";
import { assertUniqueRoutes, type Route } from "./platform/routes.js";

/** `dev2Override` lets tests (and later the real server) supply Dev 2's routes built with real dependencies. */
export function createContainer(isReady: () => boolean, additionalRoutes: Route[] = [], dev2Override?: Route[]) {
  const routes = [...dev1Routes(isReady), ...(dev2Override ?? dev2Routes()), ...additionalRoutes];
  assertUniqueRoutes(routes);
  const router = Router();
  for (const route of routes) router[route.method](route.path, route.handler);
  return { router };
}
