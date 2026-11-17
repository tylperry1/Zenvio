# Smarty address autocomplete & typed booking addresses

## Summary

Server-side Smarty US Autocomplete Pro + US Street validation, Master Admin Address & Location Services controls, required booking telephone numbers, appointment location modes, and distinct address records (residential / billing / business / appointment service).

Credentials are vault-only. Enable under `/admin/smarty` after connecting Auth ID / Token (choose **live** when ready). Autocomplete also works for signed-in hosts without a public host slug (session-scoped usage).

## Smarty configuration required

Store in Master Admin → Connections (encrypted vault):

| Key | Purpose |
| --- | --- |
| `SMARTY_AUTH_ID` | Secret Auth ID |
| `SMARTY_AUTH_TOKEN` | Secret Auth Token |
| `SMARTY_EMBEDDED_KEY` | Optional hostname-restricted embedded key (not used by default proxy) |

Then open **Integrations & Services → Address & Location Services** (`/admin/smarty`) to test connection, set cost rates / monthly cap, and enable (test or live).

Official endpoints used:

- Autocomplete: `https://us-autocomplete-pro.api.smarty.com/lookup`
- Validation: `https://us-street.api.smarty.com/street-address`

## Database changes

### `097_smarty_addresses.sql`
- `private.addresses` — typed structured addresses (`residential`, `billing`, `business`, `service_saved`, `custom_meeting`)
- `public.event_types.location_mode`, `allowed_location_modes`, `virtual_instructions`, `custom_location_prompt`
- `public.bookings.location_mode`, `service_address` (jsonb snapshot), `access_instructions`
- `private.smarty_api_errors`
- Legacy `contacts.address` values copied into residential rows without clearing the legacy column

### `098_business_address_unique.sql`
- Unique partial index: one `business` address per workspace (`contact_id IS NULL`)
- `saveBusinessAddress` uses atomic `ON CONFLICT` upsert

## Booking & location modes

| Mode | Behavior |
| --- | --- |
| `at_business` | Shows workspace business address from `private.addresses` (`address_type=business`); guests do not re-enter it |
| `at_customer` | Requires guest service address via Smarty autocomplete; saved as appointment `service_address` only |
| `virtual` | No physical address; uses virtual instructions |
| `custom` | Guest/host-provided meeting address when needed |

## Surfaces using shared AddressAutocomplete / typed addresses

- Public `/book/[host]/[event]` (+ paid checkout)
- Host create appointment + manual override path
- Business Profile → business street address
- CRM client residential/billing editors
- Team booking (required phone; location from staff event when possible)
- Client portal, workspace booking detail, calendar, confirmation UI
- Service request + jobs create (formatted string into legacy `jobs.address`)

## Explicit exclusions (documented)

- Marketplace Gelato shipping uses its own line1/city/state/ZIP schema (structured, not yet on `StructuredAddress` / Smarty widget)
- Smart Cards marketing `address` ≤300 free text (digital card copy)
- `profiles.location` remains a short marketing locality string (“Austin, TX”), separate from verified business street address
- Intake question type `address` remains a free-text intake answer (not the appointment service location)

## CRM & notifications

- Client detail API returns typed addresses and appointment service snapshots; UI edits residential/billing via Smarty
- Confirmation / reminder email text includes telephone + service address when present
- Calendar ICS location remains location-only (no phone in public calendar payloads)
- Customer residential/billing are never overwritten by public booking service addresses

## Failure handling

If Smarty is disabled, misconfigured, or unreachable, autocomplete returns an empty list with a manual-entry message. Booking still proceeds with the customer’s typed address.

## Privacy notes

- Public booking never overwrites an existing CRM phone or residential address (fill-blank phone only; service addresses are appointment-scoped).
- Business `accessInstructions` are omitted from public event payloads; only `at_business` events receive a public formatted business address.
- Confirmation responses return the resolved appointment location, not only the event default.
- Server-side credentials only; rate-limited autocomplete/validate APIs.
