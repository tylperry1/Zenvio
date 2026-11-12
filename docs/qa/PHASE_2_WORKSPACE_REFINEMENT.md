# Phase 2 workspace refinement

## Scope
- Compact billing with Overview, Plans, Usage & credits and Invoices sections.
- Calendar connection spacing and shared desktop/mobile alignment.
- Automatic device time zones in calendar, appointment creation, settings and appointment management. Published weekly hours retain their saved business time zone; they are not silently shifted when a traveler opens the app.
- Per-appointment locations stored before delivery/sync jobs and propagated to calendar downloads, feeds, connected calendars, client portals and assistant context.
- Split weekly hours, quick presets, up to 100 date exceptions, customizable minimum notice, start-time intervals and booking windows up to 365 days. Public booking uses the same rules.
- Refined booking-link cards and unified Offers, Classes, Memberships, Coupons and Orders workspace. Prices are entered in dollars, with exact cent values sent to the existing API.
- Aligned Smart Cards filters; initial selection prefers a published active profile, while explicit archived selections remain available.
- Admin subscription hierarchy groups covered active team seats under their billing owner. Independent subscriptions and explicit plan grants remain separately manageable. Search can find a parent through its team members; pagination counts root groups.

## Migration
072_scheduling_customization.sql is additive. 073_availability_rules_permissions.sql grants authenticated hosts permission to update only the new settings column, under the existing owner RLS policy. Existing weekly hours and booking rules preserve their prior defaults. Existing appointments fall back to their event location; new appointments snapshot it.

## Verification
Local availability validation tests and TypeScript parsing passed. Final CI, migration compatibility, API/security regressions and desktop/mobile screenshot review are required before release. No live provider charges or supplier orders are part of these checks.
