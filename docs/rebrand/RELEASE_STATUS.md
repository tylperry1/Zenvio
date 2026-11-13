# Zenvio 2.0 rebrand — implementation checkpoint

**Release state: DRAFT. Not approved for production.**

## Baseline and preservation

Implementation was reconciled against GitHub main `470d051958b3c584c3d3eb5c62d5b221ee144b58` (PR #53), rather than releasing the older local checkout. The newer NFC destinations, marketplace feature flag, contact fields, scheduling rules, team permissions, subscription administration, and launch controls were preserved. Source files restored from main are baseline updates, not new rebrand behavior.

No Stripe prices, subscription allocations, AI usage limits, secrets, or existing applied migrations were edited by this rebrand. No deployment or production data mutation was performed. The additive profile-design migration follows the existing migration 075.

The local Git directory is read-only, so the checkout's branch/HEAD cannot be advanced here. The source snapshot has been updated independently. Do not commit the entire apparent local diff against the old HEAD: use the focused change against the main baseline.

## Implemented

- Shared cobalt/midnight tokens, original brand SVGs, compact dark navigation, nested Growth access, consistent surfaces, fields, tables, dialogs, and responsive patterns.
- Product-wide styles covering the existing workspace, scheduling, clients, documents/signing, commerce, team, billing, support, and admin layout systems.
- Public marketing refinements in its existing stylesheet namespace, auth surfaces, booking profiles, digital profiles, and help-center article layout.
- Updated real-data Growth Overview on its existing `/app/growth/overview` route: contacts, attributed bookings, NFC/QR visits, review distribution, campaign attribution, request counts, and recorded workflow activity. Existing Marketing URLs and NFC tools remain intact.
- Shared digital-card and booking profile editor with five theme choices, four layouts, constrained typography/colors, image uploads, section content, FAQ/staff/testimonial/policy/gallery entries, visibility, drag ordering and keyboard ordering, and scaled desktop/tablet/mobile previews.
- Explicit Save draft / Publish design / Share flows. Drafts remain separate from published designs; optimistic revisions reject stale saves. Existing profile visibility, booking rules, contact privacy flags, vCard URLs, QR downloads, consented lead capture, and booked-service links remain authoritative.
- Existing normalized Brand Studio images and storage limits are reused. The CSP is unchanged. Public image access requires a published reference on a visible profile; unrelated private artwork is not exposed.

## Route status

`routes.csv` and `routes.json` inventory every page file and the explicit workspace/admin/marketing subviews. A global visual foundation is not evidence of pixel fidelity on every page. The tracker records partial public/demo browser evidence and keeps authenticated acceptance pending. Detailed observations are in `browser-qa.json`.

| Stage | Code checkpoint | Acceptance |
|---|---|---|
| Foundation | Shared design layer, original logos, responsive rules | Static checks passed; browser review pending |
| Workspace & scheduling | Existing layouts retained and restyled; booking profile renderer/editor integrated | Authenticated scheduling regression pending |
| Growth | Existing modules retained; overview and shared profile editing enhanced | Browser and live-data acceptance pending |
| Documents & commerce | Existing PDF/editor/storefront layouts restyled | Signing, ordering and supplier regression pending |
| Teams, billing, support, admin | Shared chrome and operational components restyled; current-main controls retained | Role and integration browser regression pending |
| Public website | Existing content and routes retained, visual refinements and help layout applied | Desktop/tablet/mobile browser acceptance pending |
| Release QA | Typecheck, automated tests and production build passed | Not production-ready until remaining checks pass |

## Verification evidence

- `npm run typecheck`: passed after excluding the unrelated untracked `integrations/` duplicate tree from the root compiler.
- `npm test`: **315 passed, 0 failed, 0 skipped**, including eight profile-design tests. The additional public-render test verifies tracked Smart Card booking links and contact privacy.
- New tests cover executable style/URL rejection, independent profile defaults, hidden-content preservation while reordering, same-origin image references, authentication and origin checks, foreign-profile rejection, stale-save rollback, draft/publication separation, and private-asset ownership.
- `npm run build`: passed on the reconciled source. Database migrations and production subscription catalog provisioning were skipped because database credentials are not configured here.
- `git diff --check`: passed.
- The local production server resolved the development runtime/CSP conflict without changing the security policy. Public/demo browser checks covered desktop overview/bookings, mobile calendar and clients, sample booking through confirmation, 320px homepage/sign-in, and help search. Detailed viewport and route limits are recorded in `browser-qa.json`. No screenshot fidelity against the three approved references, authenticated end-to-end success, database migration execution, or live provider acceptance is claimed.

The help search `align-items` warning was corrected. Existing compatibility warnings in documents and storefront styles remain nonfatal; this does not constitute browser acceptance.

## Concrete verification blockers

1. The local production server now works. Account services remain unconfigured: `/app` redirects to sign-in, where a visible notice explains accounts are unavailable and Sign in is disabled. Visitor support renders an error. Authenticated Growth, profile editors, database-backed booking, and role-specific regression remain blocked.
2. The browser security policy rejects `file://` navigation. An isolated editor fixture was built but could not be opened; it is not screenshot evidence.
3. No isolated Postgres/auth fixture is configured in this workspace, so migration 076 and real account/role flows have not been integration-tested.
4. Local `.git` writes are denied. Commit/PR evidence must come from an explicitly recorded remote checkpoint, not an invented local commit.

No alternative browser mechanism was used to circumvent the rejected file URL.

## Browser checkpoint

- Desktop demo overview and bookings rendered; list/calendar toggle worked.
- At 390px, calendar and client list fit; opening navigation and selecting Clients closed the drawer and changed the page. Calendar document width was 390px.
- Demo booking selected November 13 at 9:00 AM, accepted sample name/email, and reached confirmation. Sample data was stored only in the browser; no real host notification was sent.
- Tablet booking calendar and slots rendered at 768px. Confirmation document width was 390px on mobile.
- Homepage product preview switched to Contacts. Homepage and disabled sign-in showed no document overflow at 320px.
- Help search for Smart Card filtered to the matching article. Visitor support showed an error.
- Browser screenshots were inspected in tool output; standalone PNG evidence is still outstanding. These observations do not establish fidelity for the three approved reference pages.

## Required before production

1. Run migration 076 against an isolated test database containing the current schema. Verify owner/profile keys, revision conflict behavior, published image references, and account deletion cascades.
2. Stop the development server, run `npm run build`, then serve with `npm run start -- --hostname 127.0.0.1 --port 3100`. Use isolated owner, member, delegated support, and master-admin fixtures for authenticated checks.
3. Capture and inspect actual pages at 1440×1000, 768×1024, and 390×844. Check 320px for overflow. Compare the three approved screenshots directly; the earlier generated reference ZIP does not override them.
4. Walk each route in the tracker, including new admin Billing, Launch, maintenance, NFC destinations, and all explicit query subviews. Inspect focus, menu dismissal, overflow, form validation, tables, dialogs, and error states.
5. Test two profiles in one account and one in a different account: theme changes, hidden sections, reorder, image replacement, save draft, reload, publish, stale-tab conflict, and mobile preview. Verify one profile never changes another.
6. Validate bookings/timezones/conflicts/manual overrides, confirmation details, cancellation/rescheduling, document recipients/signing/audit PDF, commerce flags/orders, team access, subscription controls, calendar integration, email, and visitor/support chat without production side effects.
7. Record actual screenshots and remaining defects in the tracker. Re-run appropriate checks for any fixes. Only then mark the release ready and deploy.

Campaign Studio, Social Studio and bulk sending remain unavailable as in the current-main baseline. This rebrand does not activate unfinished sending/provider workflows.

## Final review corrections

- Customized Smart Card booking buttons retain the existing `/p/{slug}/booking` redirect, preserving click tracking and existing destination validation.
- Help article icons remain associated with their articles after search filtering.
- The local PostgreSQL 18 installation was found, but initialization fails at shared-memory creation (`Operation not permitted`). Connecting to the existing local socket is also denied. No existing database was modified or inspected.
- Final typecheck and 315 automated tests passed. The final production build passed from a separate temporary source copy to avoid disturbing the user-started server.
