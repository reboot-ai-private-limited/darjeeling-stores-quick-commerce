# Admin design system

## Surface and direction

Mode: Operate. Scope: `/admin`. User-selected direction: Minimal light workspace.

Use white navigation, a subtly tinted light content surface, fine neutral borders and a muted green selected state. Avoid decorative graphs, fabricated metrics and loading skeletons when no request is running. Availability is communicated as an honest empty state, not an error or a spinner.

## Typography and layout

Use the platform sans-serif stack for familiarity, with a fixed 28px desktop page title, 22px empty-state title and compact navigation. Maintain a 256px desktop sidebar, 73px toolbar and a bounded content width. Group navigation by Workspace, Organization and Administration.

Use one bordered workspace panel and flat setup rows. Do not nest decorative cards. Keep supporting prose short and text wrapping natural. Use consistent authored SVG icons at 18px with 1.6px strokes; no Unicode icon substitutes.

## Interaction and state

Only Overview is enabled. Disabled sections visibly say Soon with an accessible Coming soon label. No fake profile or sign-in action is provided. Warehouse selection stays disabled until real services exist. Native details/summary provides the explanation of unavailable features.

At mobile widths navigation becomes a toggleable sidebar with an explicit dismiss backdrop. Focus rings and a skip link remain visible on keyboard use. Restrict motion to a short selected-control hover transition; respect reduced motion.

## Implementation

Tokens and responsive rules live in `apps/web/src/app/admin/admin.css`; the shell lives in `apps/web/src/app/admin/page.tsx`. No additional UI dependency, external font or illustration is required for this scope.
