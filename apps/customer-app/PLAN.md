# Customer App: Plan, Screens and Features

Customer app for Darjeeling Stores: browse a nearby store's catalogue, fill a cart, check out (cash or online), and follow the order to the door.
Android and iOS, built with Expo (React Native) and Expo Router, like the rider app.

**Status (2026-11-11):** all 40 screens are built against the real backend and pass the TypeScript check. Not yet tested on a real phone, and online payment has not been tried with live or test Razorpay keys. The rest of this document is the original plan, kept as the reference for what each screen does.

| Area | State |
|---|---|
| Start-up, welcome, location, outside area, update and maintenance (1-4, 38, 39) | Built |
| Sign-in: phone, code, name (5-7) | Built |
| Home, search, categories, category products, product (8, 9, 11, 12, 14) | Built |
| Cart, coupons, addresses, checkout, payment method, order placed (16-19, 21, 22, 25) | Built |
| Online payment: Razorpay in a WebView, confirming, retry, expired (23, 24) | Built, untested with Razorpay |
| Delivery time and pre-order slots (20), store closed (40) | Built |
| Orders, order detail, live tracking, cancel, report a problem with a photo, refunds, reorder (26-32) | Built |
| Notify-me list (15), account, edit profile, notification settings, help and delete account (33-37) | Built |
| Notifications inbox (10) | Built as an order-updates list from the customer's orders (no server inbox yet); push needs a development build |
| Brand page (13) | Built (a brand's products, found through search) |
| Address voice note and house photo, favourites, share, category filters (veg, brand, price), recent searches, offline banner | Built |
| Needs a development build | Push notifications, native Razorpay SDK |

- Backend reference: `docs/api/` (F01 login, F04/F05 catalogue and stock, F07 notify-me, F08 discovery, F09 addresses, F10 cart and quote, F11 fees, F12 coupons and banners, F13 orders, F14 lifecycle, F15 payments, F16 refunds, F17 hours and pre-orders, F20 tracking, F23 notifications, F24 media).
- Product specs: `docs/customer/` and `docs/orders/`.
- Already built and reusable: the backend for all of the above, the rider app's API layer, theme and UI kit (`apps/rider-app/src`).

---

## 1. Design direction

The reference image shows a fresh, friendly quick-commerce look. We keep its **layout and feel** but use **our brand colours** (maroon, tea-yellow, cream) in place of its green.

### 1.1 What we take from the reference

| Pattern in the reference | How we use it |
|---|---|
| Soft tinted background with large, faint leaf shapes | Warm cream background with a gentle yellow-to-cream gradient at the top of screens and soft leaf/tea-leaf shapes behind hero areas |
| Big hero photography (tomatoes, groceries bag) bleeding off the top edge | Large product and banner images, cut-out style where we have them (Cloudinary images, 1080 px) |
| Rounded white cards with a very soft shadow | The same, with the radius scale from the rider app (16 / 22 / 30) |
| Pill search bar with a filter icon | Same: "Search for tea, snacks, spices…" with a filter button |
| Home header: location pin + address, bell, cart with a count badge | Same, using the saved address; bell opens notifications; cart shows item count |
| Big promo banner with a "10-min delivery" badge and a **Shop Now** pill | Banner carousel from `GET /banners`; first slide is our delivery-time promise from the store status/ETA |
| 4 × 2 category grid, each a soft tinted tile with an illustration | Same, from `GET /catalog/categories` (category images from Cloudinary) |
| "Offers for you" horizontal cards and **View all** links | Coupons and sale items (see 1.4) |
| "Best selling" product cards with a round **+** in the corner | Same; the **+** becomes a − 1 + stepper in place once added |
| Floating dark bar at the bottom: "3 items · Arriving in 10 min" with a progress track and **View cart** | Our floating cart bar, maroon with a yellow button |
| Product screen: big image, thumbnail strip, stepper pill, badges (Fresh produce, 10-min delivery), collapsible "Product details" | Same layout; details come from our product fields (key info, sections, nutrition) |
| Sticky bottom bar: price, strike-through MRP, "25% off" chip, **Add to cart** | Same, from the offering's price, MRP and sale price |
| Cart: "Arriving in 10 minutes" strip, item cards with stepper and trash, **Apply coupon** row, total and **Checkout** | Same |

### 1.2 Colour (brand, not green)

| Role | Value | Use |
|---|---|---|
| Primary | Maroon `#401815` | Primary buttons (Add to cart, Checkout), floating cart bar, selected states |
| Accent | Tea-yellow `#ffc933` | "+" buttons, discount chips, the cart bar's **View cart** button, highlights |
| Background | Cream `#f7f3ea` with a soft `#fff4d1` wash at the top | Screens |
| Surface | White | Cards |
| Success | Leaf green `#1f9d62` | Only for "in stock", "paid" and "delivered" (the one place green stays) |
| Alert | Red `#c62828` | Out of stock, errors, discounts that need attention |
| Text | Ink `#231815`, muted `#7a6f66` | Body and secondary text |

The rider app's `theme.ts` already defines these. The customer app starts from a copy and shares the tokens.

### 1.3 Shape, type and motion

- **Shape:** large radii, circular icon buttons (44 px), pill buttons (56 px high), 16 px side gutters, generous spacing.
- **Type:** system font, heavy weights for titles and prices (800–900), tight letter spacing on large numbers, small muted captions.
- **Motion:** smooth and calm: one ease-out, **no bounce or springs**, no idle bobbing. Screens slide in from the right; sheets rise from the bottom; the cart bar slides up when the first item is added. The "+" turns into the stepper with a short width animation. Prices and the bill count up.
- **Android shadow rule (learned in the rider app):** cards must not fade in. A fade shows the shadow before the card. Use the shared `liftIn` slide-up entrance instead.
- **Slide-to-confirm** is used only for the final **Place order** (and cancel), not for everyday taps.
- **Haptics** on add, remove and checkout.
- **Imagery:** use `expo-image` with a blurred placeholder and cached images; product photos have a soft tinted backdrop circle behind them like the reference.

### 1.4 Reference features the backend does not have yet

The reference image shows a few things our API does not provide. We hide or simplify them until the backend supports them:

| In the reference | In our backend | Plan |
|---|---|---|
| Star rating and "2.1k reviews" | No ratings or reviews | Hide for now |
| Heart (wishlist) | No wishlist | Keep a local favourites list on the phone; sync later if added |
| Share button | n/a | Native share sheet with a text link (product name and store) |
| "Buy 1 Get 1 Free" | Coupons are percent, flat or free delivery only | Show percent / flat / free-delivery offers; sale prices (`salePrice` with dates) give the "25% off" chips |
| "Arriving in 10 min" | Store status and quote ETA | Use the server ETA, never a fixed number |

---

## 2. Technical plan

### 2.1 Stack

- **Expo + Expo Router** (file-based routes), **React Native Reanimated** for motion, **expo-image** for photos, **expo-secure-store** for the session, **expo-location** for the delivery pin, **react-native-maps** (works in Expo Go) for the address picker and tracking.
- Runs in **Expo Go first**, like the rider app. These need a development build and come later: remote push notifications, the native Razorpay SDK, background tasks.
- A standalone npm project at `apps/customer-app` (excluded from the pnpm workspace, same as the rider app).

### 2.2 Reuse from the rider app

Copy first, extract to a shared package later (`packages/mobile-kit` is already planned in `dev2.md`):
- `api/http.ts` (token storage, automatic refresh, 12-second timeout, friendly errors) and `api/config.ts`.
- `theme.ts`, `motion.ts` (`smooth`, `liftIn`), and the UI kit (`Press`, `Button`, `Card`, `Chip`, `Pill`, `Stagger`, `Screen`, `Header`, `OrderGate`-style loading and error gates, `OtpPad`).
- The store pattern (React context, real API only, no demo data).

### 2.3 Folder layout

```
apps/customer-app/
  src/app/            screens (file-based routes)
  src/api/            http.ts, config.ts, catalog.ts, cart.ts, orders.ts, account.ts
  src/components/     ProductCard, CategoryTile, BannerCarousel, Stepper, CartBar, PriceTag, ...
  src/state/          session, location (zone), cart, favourites
  src/theme.ts  src/motion.ts
  PLAN.md             this file
```

### 2.4 Key technical decisions

1. **A "zone" comes first.** The catalogue, prices and stock are per zone and warehouse, so the app resolves the delivery location (`GET /location/resolve`) before showing products. Guests can browse; sign-in is asked at checkout.
2. **Catalogue cache.** Cache categories and products on the phone and refresh with `GET /catalog/changes` (delta since a revision), so Home opens instantly even on weak networks (the F21 goal of "home under 1 second from cache").
3. **The server cart is the truth.** The app keeps a local cart for speed and syncs the whole cart with `PUT /cart` (with a `clientRev` counter). Prices and availability always come back from the server.
4. **A quote before an order.** `POST /quotes` returns the bill and ETA; `POST /orders` places it with an `Idempotency-Key` so a double tap never creates two orders.
5. **Online payment.** Phase 1 ships cash on delivery. Online payment uses Razorpay Standard Checkout inside a `WebView` (works in Expo Go); the native SDK can replace it in the development build. The server's webhook is the final word, and the app polls `GET /order-groups/:id/payment` while "confirming payment".
6. **Split orders.** One checkout can become several child orders (for example from different warehouses). Every order screen handles a group with children.
7. **Money is whole paise** everywhere in the API; one formatting helper.

---

## 3. Screen map

```
Splash ─► Update/Maintenance check ─► Location (permission, pin, area check) ─► Home
Home ─► Search · Category list · Category products · Product · Cart ─► Checkout ─► Order placed ─► Tracking
Bottom tabs: Home · Categories · Orders · Account        (+ floating cart bar above the tabs)
Login (phone → code → name) appears at checkout, or from Account.
```

**About 40 screens**, grouped below. Each lists the features and the backend calls it uses.

---

## 4. Screens and features

### A. Start-up and location

**1. Splash / update check** `GET /app/config`
- Brand animation, restore the saved session, check the minimum version and maintenance flag.
- Blocks with screens 38 and 39 when an update is forced or maintenance is on.

**2. Welcome** (first launch only)
- Three short, image-led slides (10-minute delivery, fresh and local, pay on delivery or online) with **Get started**.

**3. Location permission and pin**
- "Allow location" with a clear reason, or **Enter manually**.
- Map with a draggable pin and an address search; "Use current location".
- Resolves the pin to a zone and store: `GET /location/resolve`, `GET /cities`, `GET /localities`.
- Shows the saved addresses as quick picks when signed in.

**4. Outside delivery area** `POST /waitlist`
- Friendly "We're not here yet" screen with an illustration, and a phone-number form to join the waitlist.

### B. Sign-in

**5. Phone number** `POST /auth/request-otp`
- +91 field, 10-digit validation, clear messages for rate limits.

**6. Code (OTP)** `POST /auth/verify-otp`
- 6-digit number pad, resend timer, wrong-code shake with tries left, auto-submit.
- Secure session storage and silent refresh (`POST /auth/refresh`).

**7. Your name** (first login only) `PUT /me`
- Name (and optional email); then back to where the customer was.

### C. Home

**8. Home** `GET /catalog/home`, `GET /banners`, `GET /store/status`, `GET /coupons/available`
- Header: location pill (tap to change address), bell, cart with a count badge.
- Pill search bar with filter icon.
- **Banner carousel** with the delivery-time promise and promotions; tap opens a category, product or link.
- **Category grid** (4 × 2, "See all" opens screen 12).
- **Offers for you**: horizontal coupon and sale cards.
- **Best selling** and **New launches** rows; **Recently ordered** with one-tap reorder; **Order again**.
- **Store status banner**: closed (with opening time), paused, rain mode, night fee, extra delay.
- **Floating cart bar** appears once the cart has items: item count, ETA, **View cart**.
- Pull to refresh; skeleton-free loading from the cache.

**9. Search** `GET /catalog/search`
- Instant results while typing, recent searches, popular searches, category suggestions.
- "Can't find it?" row (tells the store) and an empty state.

**10. Notifications inbox** (bell)
- Order updates and offers received; read/unread. (Push delivery arrives with the development build.)

### D. Browse

**11. Category list** `GET /catalog/categories`
- Tabs and a tree: main categories with sub-categories, in two-column image tiles.

**12. Category products** `GET /catalog/products`
- Sub-category chips, grid or list, sort (relevance, price, discount), filters (brand, veg / non-veg, price, on offer, in stock).
- Product card: image, name, size, price with MRP strike-through, discount chip, badge (Bestseller, New, Organic), **+** to add.
- Out-of-stock cards are dimmed with **Notify me**.

**13. Brand page** `GET /catalog/brands`
- Brand logo header with that brand's products.

**14. Product detail** `GET /catalog/products/:id`
- Big image on a tinted backdrop, thumbnail strip, swipeable gallery with zoom.
- Title, size selector (variants such as 100 g, 250 g, 500 g), price, MRP, discount chip, food-type mark.
- **Stepper pill** (− n +) and info chips (Fresh, 10-minute delivery) from the product's badge and the store ETA.
- **Product details** (collapsible): key information rows, highlights, nutrition table, extra sections, storage, tags.
- **Notify me** when out of stock `POST /notify-me`.
- "You may also like" row.
- Sticky bottom bar: price, MRP, discount chip, **Add to cart**.
- Heart (local favourites) and Share.

**15. Notify me list** `GET /notify-me`, `DELETE /notify-me/:id`
- Items the customer asked to be told about, with cancel.

### E. Cart and checkout

**16. Cart** `GET /cart`, `PUT /cart`
- "Arriving in 10 minutes" strip (server ETA), item cards with image, size, price, stepper and trash.
- Price changes and "no longer available" items flagged clearly; out-of-stock lines blocked.
- **Apply coupon** row, delivery tip, bill summary (items, discount, delivery fee, surcharges, tax), total, **Checkout**.
- Empty cart illustration with **Start shopping**.

**17. Coupons** `GET /coupons/available`, `POST /cart/coupon`, `DELETE /cart/coupon`
- Bottom sheet: type a code or pick one; greyed coupons explain why (minimum order, first order only, limit reached, expired).

**18. Delivery address** `GET /addresses`
- List with a default marker; pick one for this order; add, edit, delete.

**19. Add or edit address** `POST/PUT/DELETE /addresses`
- Map pin with accuracy, house or flat line, **landmark (required)**, locality, PIN code, contact name and phone, delivery note.
- **Voice note** (up to 10 seconds) and **house photo** (`POST /media/upload-url`, `POST /media/complete`) so the rider can find the door.
- Make default.

**20. Delivery time** `GET /preorder/slots`
- "Deliver now" or, when the store is closed, **pre-order** for a next-morning slot with remaining capacity.

**21. Checkout** `POST /quotes`
- Address and contact, delivery estimate, the full bill breakdown (fees explained in plain words), tip options (`GET /tips/options`), payment method, note to the rider.
- **Place order** (slide to confirm) sends `POST /orders` with an idempotency key.

**22. Payment method**
- **Cash on delivery** (shows the amount to keep ready) or **Pay online** (UPI, card, netbanking via Razorpay).

**23. Online payment** `POST /payments/verify`, `GET /order-groups/:id/payment`
- Razorpay checkout in a web view, then "Confirming your payment…" (polls the server).

**24. Payment failed / retry** `POST /payments/retry`
- Clear reason, **Try again** or **Switch to cash on delivery** where allowed; the order is kept until the payment window ends.

**25. Order placed**
- Success animation, order number, ETA, the delivery code, and **Track order**. Split orders show each part.

### F. Orders and tracking

**26. Orders** `GET /orders`
- **Active** and **Past** tabs; each card shows number, status chip, item thumbnails, total and a one-tap **Reorder** (past orders).

**27. Order detail** `GET /order-groups/:id`, `GET /orders/:id`
- Status timeline (Placed → Confirmed → Packing → Out for delivery → Delivered), items, bill, address, payment status, rider name and call button once assigned.
- For split orders: one card per child order with its own status.
- Actions: **Track**, **Cancel** (before packing), **Reorder**, **Get help**, **Report a problem with an item**, **Pay online** for a COD order (`POST /orders/:id/pay-link`).

**28. Live tracking** `GET /orders/:id/tracking`, public `GET /track/:token`
- Map with the store, the customer's door and the moving rider; ETA pill ("Arriving in 8 min", "updated 20 s ago").
- Progress steps, **rider call** button, and the **delivery code card** (4 digits to read out at the door).
- Share the live tracking link.

**29. Cancel order** `POST /orders/:id/cancel`
- Reason picker and the refund note for prepaid orders; only available before packing starts.

**30. Refund request** `POST /orders/:id/refund-request`
- Pick the missing or damaged item, add a photo (`refund_photo`) and a note.

**31. Refunds** `GET /refunds`, `GET /refunds/:id`
- Status of each refund (requested, approved, paid), amount and method.

**32. Reorder** `POST /orders/:id/reorder`
- Puts a past order's items back in the cart, and tells which items are no longer available.

### G. Account

**33. Account** `GET /me`
- Name, phone, email; shortcuts to the screens below; app version.

**34. Edit profile** `PUT /me`
- Name and email; phone change by code (`POST /me/phone/request-otp`, `POST /me/phone/verify`).

**35. Saved addresses** (screens 18 and 19 from Account).

**36. Notification preferences** `GET/PUT /me/notification-prefs`
- Order updates are always on; promotional messages can be switched off.

**37. Help and support**
- Support phone and WhatsApp (from `/app/config`), FAQs, "Report a problem with an order", terms and privacy.
- **Delete my account** request (`POST /me/delete-request`) with a clear explanation, and **Sign out** (`POST /auth/logout`, removes the push token).

### H. System screens

**38. Update required** — shown when the server's minimum version is higher than the installed one; button opens the download link.

**39. Maintenance** — message from the server and the support number.

**40. Store closed / paused** — opening hours, **Pre-order for tomorrow**, notify me when open.

Plus shared states used everywhere: no internet (offline banner and cached content), loading, empty and error screens with **Try again**, session ended (back to login, cart kept).

---

## 5. Cross-cutting features

- **Cart persistence:** survives app restarts; merges with the server cart after login.
- **Address-aware catalogue:** changing the address switches zone, store, prices and stock; the cart is revalidated and the customer is told what changed (`acceptZoneChange` on the quote).
- **Stock honesty:** quantities are capped to available stock; items that sell out show Notify me.
- **Errors in plain words:** every API error code maps to a short, friendly message.
- **Accessibility:** 44 px touch targets, readable contrast, labels on icon buttons, large-text support.
- **Analytics-ready events** (screen views, add to cart, checkout steps), switched off until a provider is chosen.
- **Localisation-ready strings** (English first; Hindi and Nepali later).
- **Push notifications** (order updates and offers) arrive with the development build; in Expo Go the app refreshes order status by polling.

---

## 6. Delivery plan

| Phase | Goal | Screens |
|---|---|---|
| **0. Foundation** (about 3 days) | Project, theme, UI kit, API layer, session, location and zone | 1, 2, 3, 4, 38, 39 |
| **1. Browse** (about 1 week) | See products on real data, fast and cached | 5, 6, 7, 8, 9, 11, 12, 13, 14 |
| **2. Cart and cash order** (about 1 week) | Place a cash-on-delivery order end to end | 16, 17, 18, 19, 20, 21, 22, 25, 26, 27 |
| **3. Tracking and after-sales** (about 1 week) | Follow, cancel, refund, reorder | 28, 29, 30, 31, 32, 15 |
| **4. Online payment** (about 4 days) | Razorpay checkout, confirmation and retry | 23, 24 |
| **5. Account and polish** (about 1 week) | Account, preferences, help, states, motion, accessibility | 10, 33–37, 40 and every empty/error state |
| **6. Development build** | Push notifications, native payment SDK, release builds | — |

Estimates assume one developer and a working backend (it is).

## 7. Testing

- **Real backend, no mocks:** the demo customer `+919000000002` (login code `000000`, no request limit) already exists in the development database, so repeat sign-ins are easy.
- Demo stores, products, stock and a rider already exist; orders can be placed and assigned with the scripts used for the rider app, or through the customer app itself once Phase 2 is done.
- Check on a real Android phone over USB (`adb`) and in the browser preview; capture screenshots of each screen against the design reference.
- Test weak-network behaviour (airplane mode, slow network), split orders, coupons (valid and invalid), out-of-stock items and closed-store pre-orders.

## 8. Open questions

1. **Ratings, reviews and wishlist:** wanted? They need new backend endpoints.
2. **Offers like "Buy 1 Get 1":** needs a new offer type on the backend; today only percent, flat and free-delivery coupons exist.
3. **Razorpay:** WebView checkout for the first release, or wait for the native SDK in the development build?
4. **Languages:** English only at launch, or Hindi and Nepali too?
5. **iOS:** ship at the same time as Android, or Android first?
6. **Brand assets:** category illustrations, banner artwork and the leaf motifs: supplied by design, or generated in the app's style?
