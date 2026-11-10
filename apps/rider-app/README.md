# Darjeeling Rider (Android)

Expo (React Native) app for in-house riders. Spec: `docs/delivery/19-rider-app.md`, API: `docs/api/F19-rider-app.md`.

This app is a standalone npm project (it is excluded from the pnpm workspace in `pnpm-workspace.yaml`, because Metro and
pnpm's symlinked `node_modules` don't mix well).

## Run it

```
cd apps/rider-app
npm install
npx expo start          # scan the QR code with Expo Go on an Android phone
npx expo start --web    # quick preview in a browser
```

Demo mode (current): all data is mock data from `src/data/mock.ts`.
Phone: any 10 digits · login code `000000` · delivery code `4821`.
On Home, tap **Simulate a new order** to ring the assignment alarm and walk the whole delivery flow.

## Structure

- `src/app/` file-based routes (Expo Router). `(tabs)/` is Home, Orders, Cash, Profile.
- `src/components/` design system: `ui.tsx` (buttons, cards, headers), `SwipeButton`, `OtpPad`, `MapCanvas`, `effects` (pulse rings, success check, confetti), `TabBar`, `Switch`.
- `src/state/store.tsx` in-memory app state (shift, orders, cash, history). Replace with API calls later.
- `src/theme.ts` brand colours, type and shadows.

## Not built yet (needs a development build, not Expo Go)

Assignment push (FCM), Notifee full-screen alarm, background location, offline SQLite outbox, real map. See `docs/engineering/mobile.md`.
