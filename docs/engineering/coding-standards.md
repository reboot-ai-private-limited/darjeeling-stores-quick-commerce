# Coding and documentation standards

## Enforced compiler settings

[Shared TypeScript configuration](../../packages/config/tsconfig.json) enables strict checking, unchecked-index protection, exact optional property types and consistent filename casing. `pnpm typecheck` runs package checks. The API uses NodeNext modules and `.js` import specifiers in TypeScript source so emitted code runs as native modules.

Import cycles and configured backend layer violations fail `pnpm check:boundaries`. There is no general ESLint or Prettier command in the root manifest. Do not claim those checks run.

## Runtime contracts

Validate untrusted input where it enters the system. Type declarations do not validate HTTP JSON, provider payloads or environment strings. Current environment validation uses Zod; future route schemas should preserve that distinction between parsed and untrusted data.

Return safe errors with the common request ID. Do not expose stack traces, database messages or secret values. Preserve useful internal diagnostics without recording raw request credentials or private payloads. Current request logs intentionally omit URLs and bodies.

## Names, values and business units

Use names that state meaning and units, such as an amount in paise or a timeout in milliseconds. Follow the existing proposed [data conventions](../01-data-model.md) when business code lands. Use UTC timestamps for storage and explicit business timezone conversion for opening hours and cutoffs.

Do not convert an identifier or number through multiple representations without need. Keep client-visible compatibility in mind when changing DTOs: installed native applications cannot necessarily update at the same time as the server.

## Errors and asynchronous work

Await resource initialization before serving dependent traffic. Bound shutdown and provider operations where a stalled operation would prevent recovery. Do not swallow errors that could lose a payment, stock movement or audit write. Define what remains retryable after partial success.

Use transactions and conditional updates according to the owning invariant; an in-process check followed by a write is not concurrency protection. Add one focused test for new nontrivial logic rather than assertions mirroring implementation details.

## Comments and scope

Explain why a constraint exists when code cannot show it. Avoid commented-out code, speculative options and abstraction layers with no actual consumer. A known shortcut gets `shortcut: <limit>, <when to upgrade>` near the implementation. Do not use that comment to waive validation or a requested behavior.

## Documentation format

Use UTF-8, one H1, kebab-case topic names and fenced examples with a language. Use repository-relative links without unstable line numbers. Keep one authoritative explanation per fact, with a short README quickstart as the deliberate exception.

Designs and plans name status, owner, scope and verification. Use MUST only when a named mechanism actually enforces the requirement. Mark illustrative code and unexecuted procedures explicitly. New behavior, variables, contracts and operational workarounds update their references in the same review.
