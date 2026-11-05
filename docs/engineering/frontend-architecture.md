# Frontend architecture

Status: Implemented placeholder; application flows proposed.
Owner: Web maintainers
Last verified: 2026-11-05, layout/page and package source inspection.
Scope: Existing Next.js application and constraints for future clients.

## Current web application

[Root layout](../../apps/web/src/app/layout.tsx) provides the English-language HTML/body shell. [Home page](../../apps/web/src/app/page.tsx) renders a heading and setup-in-progress text. The app uses Next.js 15, React 19 and App Router.

There is no implemented API client, session store, authentication guard, admin route, data cache, component system or mutation state. The planned storefront and `/admin` share this application; they are not separate deployed apps today.

## Future routing and sessions

Route placement follows App Router under `src/app`. Server-only credentials and database modules stay outside browser imports. A frontend route guard can improve navigation but cannot authorize backend operations; the API must enforce every permission and record scope.

The [foundation plan](../../tasks/plan.md) proposes access tokens, browser refresh cookies and native secure token storage. Cookie attributes, CSRF/origin enforcement and concurrent refresh behavior remain implementation decisions dependent on deployment domains. Do not document a working login until the API and client paths exist and are tested.

## Data and UI state obligations

For each future read or mutation, define loading, empty, stale, success, validation failure, authorization failure and retry behavior. Keep amounts and availability authoritative on the server. A timed-out checkout may have succeeded; retain its idempotency identity rather than submitting an unrelated new order.

The [cart](../customer/10-cart-and-quote.md) and [offline](../delivery/21-offline-and-low-network.md) specifications own future repricing and cache rules. No offline cache or optimistic state implementation exists yet.

## Configuration and verification

There are no application-specific public environment variables today. Any future public build variable becomes visible in distributed JavaScript. API secrets and refresh credentials do not belong there.

Run web typechecking and production build when changing server/client boundaries. Browser interaction, keyboard access, responsive behavior and error-state testing need separate execution evidence. No browser test runner is configured in the repository.
