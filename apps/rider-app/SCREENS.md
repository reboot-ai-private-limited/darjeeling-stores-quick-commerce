# Rider App: Screens and Features

Android app for Darjeeling Stores in-house riders, built with Expo (React Native) and Expo Router.
Product spec: `docs/delivery/19-rider-app.md` · API reference: `docs/api/F19-rider-app.md`.

**Status:** all 20 screens below are built and working with **demo data** (`src/data/mock.ts`). Nothing is connected to the backend API yet. See [Not built yet](#not-built-yet).

**Demo credentials:** phone = any 10 digits · login code = `000000` · customer delivery code = `4821`.

---

## 1. The rider's journey

```
Splash → Login (phone) → OTP → Permissions → Start shift ─┐
                                                          ▼
                 ┌──────────────── Home / Orders / Cash / Profile (tabs) ◄──── Sync, History
                 │                          │
                 │            new order rings: Alarm (accept)
                 │                          ▼
                 │                    Order detail
                 │                          ▼
                 │   Pickup checklist → Map & ride → Delivery code → Payment (COD only)
                 │                                         │              │
                 │                                         └──────────────┤
                 │                                                        ▼
                 └────────────── Delivered ◄──────────────────────────────┘
        (any time: "Can't deliver" → Failed delivery form · "Problem" → Report a problem)
```

An order moves through these stages: **assigned → picked up → out for delivery → arrived → delivered** (or **failed**). The Home screen's button always takes the rider to the next step for their current order.

---

## 2. Screens (20)

Route paths are relative to `src/app/`.

### A. Sign-in and setup

#### 1. Splash · `index.tsx`
- Maroon gradient with the Darjeeling Stores "ds." logo, name and "Rider" tag.
- Logo fades and scales in; a thin loader bar fills; then moves on to Login after about 2 seconds.

#### 2. Login (phone) · `login.tsx`
- Phone number field with a fixed **+91** prefix; digits only, 10 maximum.
- A green tick appears when 10 digits are entered; **Send code** stays disabled until then.
- When the keyboard opens, the tall header shrinks to a slim bar (the title fades out) so the field and button stay visible. It expands again when the keyboard closes.
- The form scrolls on small phones; tapping **Send code** closes the keyboard first.
- Shows a demo hint: any 10-digit number, code `000000`.

#### 3. OTP · `otp.tsx`
- Six code boxes with a large custom number pad (also accepts a physical keyboard on the web preview).
- The active box shows a caret. A correct code (`000000`) shows a green tick and moves on to Permissions.
- A wrong code shakes the row, shows "That code isn't right", clears, and lets the rider retry.
- "Resend code in 0:30" countdown. (Resend itself is not wired yet.)

#### 4. Permissions · `permissions.tsx`
- Four cards, each with an on/off switch and a one-line reason: **Location all the time**, **Notifications**, **Full-screen alarm**, **Keep running in background**.
- Progress bar and "N of 4 allowed" counter animate as switches are turned on.
- **Allow everything** turns all four on. **Continue** is enabled only when all four are on.
- *Demo note:* the switches are visual only; the app does not yet request the real Android permissions.

#### 5. Start shift · `start-shift.tsx`
- Lists the rider's stores (Chowrasta Store, Mall Road Store) as selectable cards with a distance chip: green "in range" within **150 m**, amber "outside range" beyond it.
- Choosing a store outside the range shows a warning: the rider can still start, but the manager will be told.
- **Slide to punch in** (disabled until a store is picked) starts the shift and opens the Home tab.
- If the rider reaches the tabs without a shift, the app sends them back here. Likewise without sign-in, back to Login.

### B. Main tabs (floating tab bar: Home · Orders · Cash · Me)

The tab bar is a floating pill with a highlight that slides to the active tab.

#### 6. Home · `(tabs)/index.tsx`
- Greeting by time of day and the rider's first name; a red alert button opens **Report a problem**.
- **Shift card:** which store, a live shift timer (HH:MM:SS) and an **Online / Break** toggle. On break, the rider receives no new orders.
- **Three stat cards** that count up: Delivered today, Cash in hand, To sync.
- **Current delivery card** (when there is an order): order number, customer, distance, ETA, stage ("Go to the store", "Start your ride", "On the way", "At the door") and what to collect (₹ amount or "Prepaid"). Tapping it opens the order. A yellow button below jumps straight to the next step. Shows "N more waiting in your queue" if there are several.
- **Empty state** (no orders): pulsing radar, "Waiting for orders" (or "Enjoy your break"), and a **Simulate a new order** button that rings the alarm for demo purposes.

#### 7. Orders · `(tabs)/orders.tsx`
- Two filters: **Active (n)** and **Completed**.
- Active: a card per order with order number, stage pill (New, Picked up, On the way, At door), customer, address, distance, ETA, bag count and amount or "Prepaid". Tap to open the order. Cards slide away when an order finishes.
- Completed: the latest 8 finished orders, with a tick or cross, customer, area, time and amount.
- Friendly empty state when there are no active orders.

#### 8. Cash · `(tabs)/cash.tsx`
- Large **Cash in hand** card with a counting-up balance, how much was collected, and the reminder to hand it to the store at the end of the shift.
- **Ledger:** each cash collection (+) and deposit at the store (−) with label and time.

#### 9. Profile ("Me") · `(tabs)/profile.tsx`
- Avatar with initials and a green "on shift" dot, name, phone and zone.
- Three quick stats: deliveries today, rating, vehicle.
- Menu: **Delivery history**, **Sync status** (shows how many items are waiting), **Report a problem**.
- **Slide to end shift:** disabled while any order is still active ("Finish your orders first").
- **Sign out.**

### C. Receiving and delivering an order

#### 10. Assignment alarm · `alarm.tsx` (full-screen)
- Appears when a new order is assigned: expanding pulse rings, a bell, and **vibration in a loop** until the rider responds.
- A 120-second countdown ring drains around a number.
- Summary of the order: distance, ride time, bags to carry and amount to collect (or "Prepaid").
- **Slide to accept** opens the order. There is **no reject button**, as the spec requires. **Report a problem** is available instead.
- *Not yet:* nothing happens when the countdown reaches zero.

#### 11. Order detail · `order/[id].tsx`
- **Progress steps:** Assigned → Picked up → On the way → At door.
- **Customer card:** name, phone, **call** and **WhatsApp** buttons, address, landmark, and any delivery note. Orders with a voice note show a play bar with a moving waveform (UI only for now).
- **Items:** quantity, name and size for each product, with item and bag totals.
- **Payment banner:** yellow "Collect ₹X, cash or UPI at the door" or green "Already paid, do not collect any money".
- **Main action** depends on the stage: *Pick up at the store*, *Start the ride*, *Continue to customer*, or *Enter delivery code*.
- Secondary buttons: **Can't deliver** (opens the failed-delivery form) and **Problem**.

#### 12. Pickup checklist · `order/pickup.tsx`
- Tap each item to tick it off (struck through when done) and **count the bags** with a − / + counter that must match the packing slip.
- A progress bar shows how many checks are complete.
- **Slide to confirm pickup** unlocks only when every item is ticked and the bag count is right. It marks the order as picked up and opens the map.

#### 13. Map and ride · `order/ride.tsx`
- A stylised map with a route that draws itself and a rider dot that moves along it. *(A drawing, not live map tiles.)*
- Bottom sheet: ETA, distance, bags, the customer's name and landmark.
- **Open Google Maps** (real navigation to the address) and a **call** button.
- **Slide to start ride**, then **Slide when you arrive**, which tells the system the rider arrived and opens the delivery-code screen.

#### 14. Delivery code · `order/arrived.tsx`
- The rider enters the 4-digit code the customer shows in their app, using the big number pad.
- Wrong code: the row shakes with "Wrong code. Ask the customer again." Correct code (`4821` in the demo): a green tick.
- Cash-on-delivery orders continue to **Payment**; prepaid orders are completed right away and go to **Delivered**.

#### 15. Payment (cash on delivery only) · `order/payment.tsx`
- The **amount due** in large type, counting up, with "Collect exactly ₹X".
- Slider toggle between **Cash** and **UPI QR**. Cash shows a "take cash and count it" panel; UPI shows a QR code for the customer to scan. *(The QR is a placeholder pattern; a real UPI QR will come from the payments API.)*
- **Slide to confirm** (cash collected / UPI received) completes the delivery. Cash is added to the rider's cash in hand and ledger.

#### 16. Delivered · `order/delivered.tsx`
- Celebration screen: a green tick draws itself, confetti falls, a haptic buzz plays.
- Summary: deliveries today, payment method, and cash added to the balance.
- **Next delivery** if another order is waiting, otherwise **Back to home**.

#### 17. Failed delivery · `order/failed.tsx`
- Pick one reason: customer not reachable, refused the order, wrong or incomplete address, nobody at the address, or asked to reschedule.
- A **photo of the door** is required (simulated by a toggle for now) and a note is optional.
- **Report failed delivery** records it in history and returns the rider to Home. A confirmation tells them to bring the order back to the store.

#### 18. Report a problem · `problem.tsx` (slides up as a sheet)
- Choose a reason (bike trouble, accident or injury, road blocked, item missing or damaged, customer is rude, other) and add an optional note.
- **Alert the store** shows a "Store notified" confirmation. *(Demo only: nothing is sent yet.)* Reachable from Home, Alarm, Order detail and Profile.

### D. Supporting screens

#### 19. Delivery history · `history.tsx`
- Summary: delivered count, failed count, total cash-order value.
- List of past deliveries: order number, customer, area, time, amount, and a COD / PREPAID / FAILED label.

#### 20. Sync status · `sync.tsx`
- Shows "All caught up" or how many items are waiting to upload (deliveries finished are queued here, as they will be when working offline).
- **Sync now** runs a short spinning animation and clears the queue. *(Simulated.)*

#### How screens change · `_layout.tsx` and `(tabs)/_layout.tsx`
Not a screen, but it controls the transitions between them:
- Forward steps slide in from the right; the alarm rises from the bottom; the problem sheet slides up; splash, tabs and delivered cross-fade.
- The alarm, tabs and delivered screens cannot be dismissed by swiping back.

---

## 3. Design and motion

- **Brand:** deep maroon `#401815`, tea-leaf yellow `#ffc933`, warm cream background, red for alerts, green for success. Large rounded cards and touch targets sized for gloved or one-handed use.
- **Slide-to-confirm** is used for every action that matters (punch in, pickup, start ride, arrived, payment, end shift, accept order), so nothing is triggered by accident.
- **Motion rules:** one calm ease-out for everything; **no bouncing or springy overshoot**, and no idle bobbing. Content fades in one block after another. Numbers count up. Buttons shrink slightly while pressed.
- **Haptics** on taps and confirmations (phones only).
- **Alarm effects:** pulse rings and vibration are the only looping effects, because they are functional.

---

## 4. Code map

| Path | What it holds |
|---|---|
| `src/app/` | One file per screen (file-based routes) |
| `src/components/ui.tsx` | Screen shell, header, buttons, cards, chips, pills, press effect |
| `src/components/SwipeButton.tsx` | Slide-to-confirm control |
| `src/components/OtpPad.tsx` | Code boxes and number pad |
| `src/components/MapCanvas.tsx` | Animated map drawing |
| `src/components/effects.tsx` | Pulse rings, success tick, confetti, count-up |
| `src/components/TabBar.tsx`, `Switch.tsx` | Floating tab bar, toggle switch |
| `src/state/store.tsx` | In-memory app state: sign-in, shift, orders, cash, history, sync |
| `src/data/mock.ts` | Demo rider, stores, orders, ledger, history, reason lists |
| `src/theme.ts`, `src/motion.ts` | Colours, type, shadows; the shared animation curve |

## 5. Running it

```
cd apps/rider-app
npm install
npx expo start          # scan the QR code with Expo Go on an Android phone
npx expo start --web    # browser preview
```

On Home, tap **Simulate a new order** to walk through the whole flow.

---

## 6. Not built yet

Compared with the spec (`docs/delivery/19-rider-app.md`):

| Item | Status |
|---|---|
| Real login against the API (OTP via `/auth/request-otp`, session storage) | Not connected; demo accepts any number |
| Live assignments, shifts, pickup, deliver, failed, problem, cash and history calls (`/rider/...`) | Not connected; all data is local demo data |
| Real Android permission requests | Switches are visual only |
| Push notification (FCM) and the true full-screen alarm over the lock screen (Notifee) | Needs a development build, not Expo Go |
| Background location pings (about every 10 s on an order, 60 s idle) | Not built |
| Offline mode: pickup bundle, local outbox, offline code check, local UPI QR | Not built; the Sync screen is a simulation |
| Real map tiles and turn-by-turn routing | Map is a drawing; "Open Google Maps" provides navigation |
| Real UPI QR from the payments API | Placeholder pattern |
| Camera for failed-delivery proof and profile photo | Simulated toggle |
| Voice-note playback | Play bar is visual only |
| Switch store mid-shift; resume from break as a separate action | Not built (Break toggles on and off) |
| Alarm timeout behaviour and "already paid" server check | Not built |
| Force-update and maintenance screens | Not built |
| Multi-stop batches (several orders on one ride) | The UI handles orders one at a time |
