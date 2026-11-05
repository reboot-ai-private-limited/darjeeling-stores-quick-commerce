# Product

## Platform

web

## Users and purpose

Darjeeling Stores owners and staff use the admin workspace to operate the business. The user requested an admin panel, explicitly excluding storefront work from this surface.

## Current capabilities and constraints

The current admin application is an empty UI shell at `/admin`. The root redirects there. Only Overview is enabled; unfinished sections remain disabled. Authentication and business APIs are not implemented. The user explicitly requested removal of all sample data; do not invent customers, staff, metrics, warehouses or authenticated identities.

## Evidence

Product requirements live in `docs/platform/25-admin-panel-settings-and-reports.md` and the existing foundation specifications. Current source is the authority for implemented behavior. The backend exposes health/readiness, not admin operations.

## Confirmed design preference

The user selected “Minimal light workspace” during the redesign interview. Visual rules belong in DESIGN.md. No other product claims or operating values were supplied by this redesign request.
