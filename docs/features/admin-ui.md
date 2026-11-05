# Feature: Basic admin interface

Status: Implemented UI shell; backend integration pending
Owner: Web maintainers
Last verified: 2026-11-05, TypeScript and development HTTP smoke checks
Scope: Empty admin workspace without sample business data

## Current behavior

The root route redirects to `/admin`. Only Overview is enabled. Orders, Warehouses, Zones & localities, Staff, Roles & permissions, Settings and Audit log are disabled and labeled Coming soon.

The overview displays an unavailable state. No sample records, metrics, configuration values, warehouse options or fictitious staff identities are present. Warehouse selection is disabled. Mobile navigation can be expanded and closed through its toggle.

The user-selected redesign uses a minimal light workspace with grouped navigation, consistent SVG icons, a focused empty state and flat setup rows. A native disclosure explains feature availability. Mobile navigation has a dismiss backdrop. [Product context](../../PRODUCT.md) and [design rules](../../DESIGN.md) preserve these constraints for subsequent UI work.

## Backend and authentication

The web UI now requires development OTP sign-in before showing the workspace. Phone 9000000001 and code 000000 authenticate the seeded super admin when backend mock mode is explicitly enabled. The UI verifies the returned profile through `/me`, shows the real account name/phone/role and provides logout. The development Next rewrite proxies `/api/v1` to the loopback API on port 4000; no production rewrite is enabled.

The bearer token stays in React memory, expires after the API's stated lifetime and is not written to browser storage. Reloading requires a new sign-in. Production sign-in remains unavailable. Disabled business sections stay disabled; authentication does not imply their APIs exist.

## Sources and verification

The [admin page](../../apps/web/src/app/admin/page.tsx) owns the shell. The [platform specification](../platform/25-admin-panel-settings-and-reports.md) describes the intended complete panel.

Web typechecking and HTTP content checks passed, including removal of sample records and presence of the unavailable state. Browser visual/interaction testing and production build remain unverified.
