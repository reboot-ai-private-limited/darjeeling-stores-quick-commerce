# Backend module boundaries

The API is a modular monolith. The composition root in `apps/api/src/container.ts` connects module dependencies; `app.ts` owns HTTP middleware and mounts routers. The health module is the initial example: it receives readiness as a function and does not import MongoDB.

Add modules only when implementing their behavior. Business policy must not depend on Express, Mongoose or environment variables. Application actions depend on narrow ports where they need an external dependency; infrastructure implements those ports. HTTP adapters validate and map transport data. Cross-module interactions go through public contracts and the composition root; each module owns its writes. Run `pnpm check:boundaries` for automated API cycle, layer, unresolved-import and module public-contract checks. The documented shared-package resolver exception is checked by TypeScript.

The composition root gathers route declarations from `composition/dev1.ts` and `composition/dev2.ts`, checks duplicate method/path pairs, and registers them. Add each owned route through its composition file. This check detects exact pairs; overlapping parameterized patterns still require review. No fake authentication or domain ports are wired into production.
