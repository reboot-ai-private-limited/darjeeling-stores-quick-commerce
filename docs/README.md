# Documentation index

This repository contains a working backend foundation and a placeholder web page. The customer and rider directories contain planning notes, not runnable mobile applications. Authentication, catalog, checkout and delivery remain product designs unless an implementation reference explicitly says otherwise.

## Reading paths

| Reader | Read in order | Result |
| --- | --- | --- |
| New developer | [Root README](../README.md), [development setup](engineering/setup-development.md), [layout](engineering/monorepo-layout.md), [testing](engineering/testing.md) | Run the existing applications and choose the correct check |
| Feature author | [Product design](00-overview.md), owning feature specification below, [architecture](architecture/overview.md), [module anatomy](engineering/module-anatomy.md), [coding standards](engineering/coding-standards.md) | Identify rules, owners, contracts and acceptance cases before implementation |
| API consumer | [API reference](api/README.md), [frontend architecture](engineering/frontend-architecture.md) | Understand existing endpoints and distinguish future session behavior |
| Operator | [Build and deployment](engineering/build-and-deploy.md), [runbooks](runbooks/README.md) | Understand artifacts and remaining deployment prerequisites |
| Planner | [Team split](engineering/team-split.md), [Foundation plan](../tasks/plan.md), [execution checklist](../tasks/todo.md), [Dev 1](../dev1.md), [Dev 2](../dev2.md) | Find who owns what, active work and the contracts between the two developers |

## Current implementation references

- [System architecture](architecture/overview.md): runtime processes, request flow and failure boundaries.
- [Module dependencies](architecture/module-dependencies.md): import direction and checker limitations.
- [Persistence](architecture/data-model.md): existing connection behavior and planned business records.
- [Integrations](architecture/integrations.md): current dependency versus proposed providers.
- [Engineering handbook](engineering/README.md): setup, conventions, testing and releases.
- [Health and readiness](features/health-and-readiness.md): the implemented reference capability.
- [Decision records](decisions/README.md): recorded choices, consequences and revisit conditions.

## Product and feature design

The [existing overview](00-overview.md) owns product goals, intended phases and the complete F01–F25 feature index. The [existing data-model design](01-data-model.md) owns proposed collections and business units. These are design documents, not evidence that all features run.

| Area | Existing authoritative specifications |
| --- | --- |
| Foundation | [Authentication](foundation/01-authentication.md), [permissions](foundation/02-roles-and-permissions.md), [geography](foundation/03-zones-and-warehouses.md) |
| Catalog | [Master catalog](catalog/04-master-catalog.md), [stock and pricing](catalog/05-warehouse-stock-and-pricing.md), [import](catalog/06-product-import-and-admin-tree.md), [availability subscriptions](catalog/07-notify-me.md) |
| Customer | [Discovery](customer/08-discovery-and-location.md), [addresses](customer/09-addresses.md), [cart and quote](customer/10-cart-and-quote.md), [fees](customer/11-delivery-fees-and-surcharges.md), [coupons](customer/12-coupons-and-offers.md) |
| Orders | [Placement](orders/13-order-placement-and-split-orders.md), [lifecycle](orders/14-order-lifecycle-and-packing.md), [payments](orders/15-payments.md), [cancellation](orders/16-cancellations-and-refunds.md), [hours](orders/17-hours-preorders-and-ops-mode.md) |
| Delivery | [Dispatch](delivery/18-dispatch-and-assignment.md), [rider app](delivery/19-rider-app.md), [tracking](delivery/20-eta-and-live-tracking.md), [offline](delivery/21-offline-and-low-network.md), [cash](delivery/22-rider-cash-and-settlement.md) |
| Platform | [Notifications](platform/23-notifications.md), [media](platform/24-media-storage.md), [administration](platform/25-admin-panel-settings-and-reports.md) |

## Source of truth and status

Executable behavior is defined by source, manifests and tests. Current references explain that behavior. Product specifications define intended rules. Plans define delivery order; they do not replace references. Keep active task tracking in `tasks/`; do not create a second backlog under this directory.

Use Proposed for unapproved or unfinished designs; Accepted for agreed decisions; Implemented for behavior present in code; Deprecated for behavior scheduled for replacement; Superseded for historical documents with a replacement link. Verification is separate: a source comparison does not prove a deployment or restore procedure works.

New feature, decision and operational documents can start from [templates](templates/README.md). Existing feature documents retain their names and locations to preserve links.
