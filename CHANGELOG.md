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

### Limitations

- Customer and rider applications remain reserved directories; web is a placeholder.
- Business authentication, permissions, catalog, ordering and delivery remain planned.
- Production hosting, CI release automation, backups and restore verification are not established by this scaffold.
