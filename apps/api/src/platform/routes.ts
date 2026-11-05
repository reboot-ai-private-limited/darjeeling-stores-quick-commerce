import type { RequestHandler } from "express";

export type Route = { method: "get" | "post" | "put" | "patch" | "delete"; path: string; handler: RequestHandler };

export function assertUniqueRoutes(routes: readonly Route[]) {
  const keys = new Set<string>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (keys.has(key)) throw new Error(`Duplicate route: ${key}`);
    keys.add(key);
  }
}
