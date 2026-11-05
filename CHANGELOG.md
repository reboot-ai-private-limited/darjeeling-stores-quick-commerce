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

### Limitations

- Customer and rider applications remain reserved directories; web is a placeholder.
- Business authentication, permissions, catalog, ordering and delivery remain planned.
- Production hosting, CI release automation, backups and restore verification are not established by this scaffold.
