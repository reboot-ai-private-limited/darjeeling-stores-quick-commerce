# darjeeling-stores-quick-commerce

Quick-commerce system for Darjeeling Stores: customer app, rider app and admin panel, with zone-based multi-warehouse catalog, split orders, offline-first delivery and settings-driven delivery fees.

Start here: [docs/00-overview.md](docs/00-overview.md) (architecture, roadmap, decisions, feature index).

| Folder | Features |
|---|---|
| [docs/foundation](docs/foundation) | F01 Authentication · F02 Roles & permissions · F03 Zones & warehouses |
| [docs/catalog](docs/catalog) | F04 Master catalog · F05 Warehouse stock & pricing · F06 Import & admin tree · F07 Notify Me |
| [docs/customer](docs/customer) | F08 Discovery & location · F09 Addresses · F10 Cart & quote · F11 Fees & surcharges · F12 Coupons & offers |
| [docs/orders](docs/orders) | F13 Placement & split orders · F14 Lifecycle & packing · F15 Payments · F16 Cancellations & refunds · F17 Hours & pre-orders |
| [docs/delivery](docs/delivery) | F18 Dispatch · F19 Rider app · F20 ETA & tracking · F21 Offline · F22 Rider cash |
| [docs/platform](docs/platform) | F23 Notifications · F24 Media storage · F25 Admin, settings & reports |

Shared: [docs/01-data-model.md](docs/01-data-model.md).

## Development setup

Prerequisites: Node.js 22 or later and pnpm 12.6.0. Install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm build` once to build the shared package. Start the API with `pnpm --filter @darjeeling/api dev` and the web app in a second terminal with `pnpm --filter @darjeeling/web dev`. The web app runs at http://localhost:3000 and the API health endpoint at http://localhost:4000/api/v1/health. Set `PORT` in the environment to change the API port.

Run `pnpm build`, `pnpm typecheck`, and `pnpm test` from the root. The health endpoint checks that the HTTP process is running; it does not check a database. The Expo app directories are reserved for future implementation. See [dev1.md](dev1.md) and [dev2.md](dev2.md) for the work sequence.
