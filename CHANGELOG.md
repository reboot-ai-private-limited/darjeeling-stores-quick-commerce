# Changelog

## Unreleased

This section records the current working-tree foundation and documentation. It does not assert a published release or deployed availability.

### Added

- Express application factory, process liveness and MongoDB readiness endpoints.
- Validated runtime configuration, generated request IDs, safe HTTP errors, JSON size limits and explicit CORS/proxy settings.
- MongoDB connection lifecycle and bounded shutdown handling.
- Local development replica-set Compose configuration and disposable database/process integration tests.
- Health module composition and backend dependency checks.
- Detailed setup, architecture, API, engineering, decision and operational documentation.

- Brands, food type, extra categories, badge, returnable flag and variant attributes on products, with brand and food-type filters for customers (F04, F08, F16).
- The real server wiring: customers, riders and staff are recognised from their sessions; real zones, warehouses and localities feed every module; rider login accounts are created and switched off through identity; the background jobs start with the server and stop on shutdown; the delivery-code and tracking keys come from the environment or are derived, never built in; every owner-editable setting is read live; Google Routes travel times with a straight-line fallback.
- Rider tips: added at checkout, shared over split deliveries, refunded with a cancelled order, and a per-rider list of what the owner still owes (F10, F19, F22).
- Admin settings with scoped overrides, history and audit; dashboard; nine reports with CSV; customer administration; audit search (F25).

- Customer app: browse, cart, coupons, checkout (cash or online), pre-orders, tracking, cancellation, refund requests and account screens.
- Rider app connected to the real backend.

### Removed

- The audit log: no audit records are written, the `/admin/audit` search and its screen are gone, and the `audit:view` permission no longer exists. Old records stay in the `audit_log` collection until you delete them. Order, stock-price, setting and rider-shift histories that have their own screens are unaffected.
- Staff two-factor authentication: staff sign in with email and password only, the authenticator setup and reset screens and endpoints are gone, and `STAFF_TOTP_KEY` is no longer used. Run `apps/api/.migrate-remove-audit-2fa.ts` once on an existing database to clean up leftover data.

### Limitations

- The rider app and the customer app are built against the real backend but have not been tested on real devices or released. The customer app's notifications list is built from orders (no server inbox); online payment is untested with Razorpay keys.
- The web admin has most screens; the public storefront and tracking page are not built.
- The API covers authentication, permissions, catalog, ordering, payments, refunds and delivery; production hosting and release automation are not set up.
- Production hosting, CI release automation, backups and restore verification are not established by this scaffold.
