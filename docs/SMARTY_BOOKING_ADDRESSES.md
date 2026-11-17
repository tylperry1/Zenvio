# Smarty address autocomplete & typed booking addresses

## Summary

Server-side Smarty US Autocomplete Pro + US Street validation, Master Admin Address & Location Services controls, required booking telephone numbers, appointment location modes, and distinct address records (residential / billing / business / appointment service).

**Smarty stays disabled by default.** Credentials are vault-only. No live activation without explicit approval.

## Smarty configuration required

Store in Master Admin → Connections (encrypted vault):

| Key | Purpose |
| --- | --- |
| `SMARTY_AUTH_ID` | Secret Auth ID |
| `SMARTY_AUTH_TOKEN` | Secret Auth Token |
| `SMARTY_EMBEDDED_KEY` | Optional hostname-restricted embedded key (not used by default proxy) |

Then open **Integrations & Services → Address & Location Services** (`/admin/smarty`) to test connection, set cost rates / monthly cap, and enable when approved.

Official endpoints used:

- Autocomplete: `https://us-autocomplete-pro.api.smarty.com/lookup`
- Validation: `https://us-street.api.smarty.com/street-address`

## Database changes (`095_smarty_addresses.sql`)

- `private.addresses` — typed structured addresses
- `public.event_types.location_mode`, `allowed_location_modes`, `virtual_instructions`, `custom_location_prompt`
- `public.bookings.location_mode`, `service_address` (jsonb snapshot), `access_instructions`
- `private.smarty_api_errors`
- Legacy `contacts.address` values copied into residential rows without clearing the legacy column

## Booking forms updated

- Public `/book/[host]/[event]` — required telephone (E.164 normalized), location modes, Smarty autocomplete with manual fallback
- Paid appointment checkout path carries phone + location through payment confirmation
- Workspace appointment-type editor — location mode options

## CRM & notifications

- Client detail API returns typed addresses and appointment service snapshots
- Confirmation / reminder email text includes telephone + service address when present
- Calendar ICS location remains location-only (no phone in public calendar payloads)

## Failure handling

If Smarty is disabled, misconfigured, or unreachable, autocomplete returns an empty list with a manual-entry message. Booking still proceeds with the customer’s typed address.

## Privacy notes

- Public booking never overwrites an existing CRM phone or residential address (fill-blank phone only; service addresses are appointment-scoped).
- Business `accessInstructions` are omitted from public event payloads; only `at_business` events receive a public formatted business address.
- Confirmation responses return the resolved appointment location, not only the event default.
