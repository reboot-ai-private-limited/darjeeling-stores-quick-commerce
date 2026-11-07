# Backend wiring (the real server)

`apps/api/src/server.ts` builds the API in this order, and `composition/production.ts` is where Dev 2's modules are connected to the rest.

1. Configuration and the database; the roles are created if missing.
2. Identity: sign-in routes (OTP for customers and riders, password and 2FA for staff), sessions.
3. Geography (cities, localities, zones, warehouses).
4. Admin: settings, dashboard and reports, customers, audit (`composition/admin.ts`).
5. Production wiring (`composition/production.ts`): the catalog, stock, cart, orders, payments, refunds, delivery, tracking, notifications, media and tips modules, with:
   - **Who is signed in.** `createUserResolvers` reads the same session store the sign-in routes write to. It gives the customer, rider and media resolvers; the staff resolver is the one in admin. A blocked, deactivated or deleted account, a revoked or expired session, and a cookie session changing data from an untrusted origin all count as nobody signed in.
   - **Where things are.** `createGeographyPort` answers the zone, warehouse and locality questions from the real collections (a warehouse is open when enabled and not paused; the hours module narrows that with opening hours).
   - **People.** Rider login accounts (`createRiderIdentity`: made ahead of first sign-in, switched off with every session ended), phones and push tokens, who lives in which zone, whether a customer may pay cash, whether a product was ever ordered.
   - **Settings.** Per zone or warehouse settings are read by the cart, pricing, stock and hours modules for the place in question; the rest come from live objects (`composition/live-settings.ts`) that read a copy of the global values refreshed after every save and every 30 seconds.
   - **Secrets.** The delivery-code key and the tracking-link key come from `ORDER_OTP_KEY` and `TRACKING_TOKEN_SECRET`, or are derived from `JWT_SECRET` for that one purpose, so no built-in key is ever used.
   - **Travel time.** Google Routes when `GOOGLE_MAPS_API_KEY` is set (cached per pair of places, two-wheeler), the straight-line estimate whenever there is no answer.
6. Background work starts (`startBackground`): hold release, back-in-stock messages, media cleanup, payment expiry, rain-mode expiry, rider acknowledgement alerts, automatic assignment, silent-rider sweep. It stops, before the database closes, on SIGINT or SIGTERM.

Environment variables are listed in `.env.example`. Customer and rider sign-in need `JWT_SECRET`; without it only the health and public configuration endpoints run.

The end-to-end test of this wiring is `apps/api/test/integration/production.test.ts`.
