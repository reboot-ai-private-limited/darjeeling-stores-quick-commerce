# Practical SOLID principles

SOLID is a set of design heuristics, not a requirement to wrap every function in a class. Use a principle when it reduces a concrete coupling or failure risk. Existing functions provide the examples below.

## Single responsibility

[Environment configuration](../../apps/api/src/config/env.ts) validates process input; [app composition](../../apps/api/src/app.ts) defines HTTP behavior; [server bootstrap](../../apps/api/src/server.ts) starts resources. This lets HTTP tests construct an app without connecting to MongoDB.

Keep transport parsing out of pure business calculations. Split responsibilities when they change for different reasons, rather than because a function exceeds an arbitrary line count. HTTP-wide middleware can remain together while the application is small.

## Open for extension

The health router can receive another readiness function without changing its endpoint implementation. Tests use deterministic true/false functions; production uses the database helper. This is a useful extension seam because it already has two real uses.

Do not introduce a plugin registry or configurable repository factory for a hypothetical second database. A direct function parameter is enough when the dependency is one action.

## Substitution

Any replacement `isReady` function should preserve the meaning expected by the router: a synchronous boolean indicating availability. A replacement that returns a Promise or throws routinely would break that expectation even if forced through a type assertion.

For future repository ports, document missing-record behavior, duplicate conflicts and atomicity. Two adapters with matching method names are not substitutable if one silently overwrites duplicates and the other rejects them.

## Interface segregation

The health module needs only a readiness predicate, not a Mongoose connection object. Supplying the smaller dependency prevents accidental queries and makes test setup simple.

Apply the same reasoning to future provider ports: an OTP action should receive the send capability it uses, not a large provider client exposing unrelated administration methods. Avoid splitting an interface into many one-method files without an actual consumer need.

## Dependency inversion

Health policy is expressed in terms of availability, while the server chooses how availability is measured. [The container](../../apps/api/src/container.ts) connects the components. This avoids importing storage infrastructure into the module.

In future business modules, define a narrow port when persistence/provider access makes the policy hard to test or creates an ownership boundary. Pure calculations and simple constant mappings need no port.

## Review questions

- Does this boundary protect a business rule or make a real dependency replaceable in tests?
- Can callers tell missing data from failure without reading the adapter internals?
- Is validation preserved when code is moved behind a public contract?
- Does the abstraction remove knowledge from the caller, or simply rename the same call?

If an abstraction only forwards arguments and has no ownership or testing purpose, keep the direct code.
