import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

const compiled = new Map();

function compileTs(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  compiled.set(filename, output);
  return output;
}

function loadTs(relative) {
  const filename = path.resolve(relative);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const standard = mod.require.bind(mod);
  mod.require = (id) => {
    if (id === "./server" || id.endsWith("/server"))
      return {
        ApiError: class ApiError extends Error {
          constructor(message, status = 400) {
            super(message);
            this.status = status;
          }
        },
      };
    if (id.startsWith(".")) {
      const resolved = path.resolve(path.dirname(filename), id.endsWith(".ts") ? id : `${id}.ts`);
      if (fs.existsSync(resolved)) {
        const child = new Module(resolved);
        child.filename = resolved;
        child.paths = Module._nodeModulePaths(path.dirname(resolved));
        const childRequire = child.require.bind(child);
        child.require = (childId) => {
          if (childId === "./server" || childId.endsWith("/server"))
            return mod.require("./server");
          if (childId.startsWith(".")) {
            const nested = path.resolve(
              path.dirname(resolved),
              childId.endsWith(".ts") ? childId : `${childId}.ts`,
            );
            if (fs.existsSync(nested)) return loadTs(path.relative(process.cwd(), nested));
          }
          return childRequire(childId);
        };
        child._compile(compileTs(resolved), resolved);
        return child.exports;
      }
    }
    return standard(id);
  };
  mod._compile(compileTs(filename), filename);
  return mod.exports;
}

const addresses = loadTs("src/lib/addresses.ts");
const phone = loadTs("src/lib/phone.ts");
const bookingAddress = loadTs("src/lib/booking-address.ts");

test("structured address formatting keeps components separate", () => {
  const formatted = addresses.formatAddress({
    street: "1600 Amphitheatre Pkwy",
    street2: "Suite 100",
    city: "Mountain View",
    state: "CA",
    postalCode: "94043",
    country: "US",
  });
  assert.match(formatted, /1600 Amphitheatre Pkwy/);
  assert.match(formatted, /Suite 100/);
  assert.match(formatted, /Mountain View/);
  assert.match(formatted, /CA 94043/);
  const multi = addresses.formatAddressMultiline({
    street: "123 Main Street",
    street2: "Suite 200",
    city: "Cincinnati",
    state: "OH",
    postalCode: "45202",
  });
  assert.equal(multi, "123 Main Street, Suite 200\nCincinnati, OH 45202");
  const summary = addresses.bookingLocationSummary({
    locationMode: "at_customer",
    location: "On site",
    serviceAddress: {
      street: "456 Oak Avenue",
      street2: "Apartment 3",
      city: "Hamilton",
      state: "OH",
      postalCode: "45011",
    },
    accessInstructions: "Ring 3B",
  });
  assert.equal(summary.title, "At customer location");
  assert.match(summary.body, /456 Oak Avenue/);
  assert.equal(summary.access, "Ring 3B");
  assert.equal(
    addresses.bookingLocationSummary({
      locationMode: "custom",
      location: "Fallback hall",
      serviceAddress: { formatted: "123 Main St only" },
    }).body,
    "123 Main St only",
  );
  assert.equal(
    addresses.bookingLocationSummary({
      locationMode: "custom",
      location: "Fallback hall",
      serviceAddress: {},
    }).body,
    "Fallback hall",
  );
  const migrated = "A".repeat(250) + ", Cincinnati, OH 45202";
  assert.equal(
    addresses.displayStructuredAddress({
      street: migrated.slice(0, 200),
      formatted: migrated,
      city: "",
      state: "",
      postalCode: "",
    }),
    migrated,
  );
  const site = addresses.jobSiteSubmission({
    street: "10 Main",
    street2: "",
    city: "Cincinnati",
    state: "OH",
    postalCode: "45202",
    country: "US",
    formatted: "10 Main · Cincinnati, OH 45202",
    accessInstructions: "Gate 12",
  });
  assert.match(site.address, /10 Main/);
  assert.equal(site.accessNote, "Gate 12");
});

test("phone normalization accepts US local numbers and rejects blanks", () => {
  assert.equal(phone.normalizeBookingPhone("(555) 123-4567"), "+15551234567");
  assert.equal(phone.normalizeBookingPhone("+44 7911 123456"), "+447911123456");
  assert.throws(() => phone.normalizeBookingPhone(""), /telephone/i);
  assert.throws(() => phone.normalizeBookingPhone("123"), /country code/i);
});

test("customer location bookings require a service address", () => {
  assert.throws(
    () =>
      bookingAddress.resolveBookingLocation({
        event: {
          location: "On site",
          location_mode: "at_customer",
          allowed_location_modes: ["at_customer"],
        },
        guest: { locationMode: "at_customer", serviceAddress: {} },
      }),
    /service address/i,
  );
});

test("virtual bookings skip physical address and keep instructions", () => {
  const resolved = bookingAddress.resolveBookingLocation({
    event: {
      location: "Video call",
      location_mode: "virtual",
      allowed_location_modes: ["virtual"],
      virtual_instructions: "Join Zoom five minutes early",
    },
    guest: { locationMode: "virtual" },
  });
  assert.equal(resolved.locationMode, "virtual");
  assert.equal(resolved.serviceAddress, null);
  assert.equal(resolved.locationText, "Video call");
  assert.match(resolved.accessInstructions, /Zoom/);
});

test("guest access notes do not leak into virtual or at_business modes", () => {
  const virtual = bookingAddress.resolveBookingLocation({
    event: {
      location: "Video call",
      location_mode: "virtual",
      allowed_location_modes: ["virtual"],
      virtual_instructions: "Join Zoom five minutes early",
    },
    guest: {
      locationMode: "virtual",
      accessInstructions: "Gate code from a prior customer-location booking",
    },
  });
  assert.match(virtual.accessInstructions, /Zoom/);
  assert.doesNotMatch(virtual.accessInstructions, /Gate code/);

  const business = bookingAddress.resolveBookingLocation({
    event: {
      location: "Studio",
      location_mode: "at_business",
      allowed_location_modes: ["at_business"],
    },
    businessAddress: {
      street: "100 Main St",
      street2: "",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
      formatted: "100 Main St · Austin, TX, 78701",
      accessInstructions: "Ring suite B",
    },
    guest: {
      locationMode: "at_business",
      accessInstructions: "Guest leftover note",
    },
  });
  assert.equal(business.accessInstructions, "Ring suite B");
  assert.equal(business.serviceAddress?.accessInstructions, "");
});

test("at-business uses business address without requiring guest re-entry", () => {
  const resolved = bookingAddress.resolveBookingLocation({
    event: {
      location: "Studio",
      location_mode: "at_business",
      allowed_location_modes: ["at_business"],
    },
    businessAddress: {
      street: "100 Main St",
      street2: "",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
      formatted: "100 Main St · Austin, TX, 78701",
    },
    guest: { locationMode: "at_business" },
  });
  assert.equal(resolved.locationMode, "at_business");
  assert.match(resolved.locationText, /100 Main St/);
  assert.equal(resolved.serviceAddress?.city, "Austin");
});

test("migration and Smarty vault wiring are present", () => {
  const migration = fs.readFileSync("postgres/migrations/097_smarty_addresses.sql", "utf8");
  assert.match(migration, /private\.addresses/);
  assert.match(migration, /location_mode/);
  assert.match(migration, /service_address/);
  assert.match(migration, /smarty_api_errors/);
  const settings = fs.readFileSync("src/lib/platform-settings.ts", "utf8");
  assert.match(settings, /SMARTY_AUTH_ID/);
  assert.match(settings, /SMARTY_AUTH_TOKEN/);
  const connections = fs.readFileSync("src/components/admin-connections.tsx", "utf8");
  assert.match(connections, /Address & Location Services/);
  const nav = fs.readFileSync("src/lib/admin-console-nav.ts", "utf8");
  assert.match(nav, /\/admin\/smarty/);
  const client = fs.readFileSync("src/lib/smarty/client.ts", "utf8");
  assert.match(client, /us-autocomplete-pro\.api\.smarty\.com\/lookup/);
  assert.match(client, /us-street\.api\.smarty\.com\/street-address/);
  const page = fs.readFileSync("src/components/booking-page.tsx", "utf8");
  assert.doesNotMatch(page, /SMARTY_AUTH_/);
  assert.doesNotMatch(fs.readFileSync("src/components/address-autocomplete.tsx", "utf8"), /SMARTY_AUTH_/);
});

test("booking form requires telephone and keeps Smarty failure soft", () => {
  const page = fs.readFileSync("src/components/booking-page.tsx", "utf8");
  assert.match(page, /Telephone number/);
  assert.match(page, /AddressAutocomplete/);
  assert.doesNotMatch(page, /saveAsResidential/);
  assert.match(page, /locationMode === "at_customer" \|\| locationMode === "custom"/);
  const autocomplete = fs.readFileSync("src/components/address-autocomplete.tsx", "utf8");
  assert.match(autocomplete, /Enter the address manually/);
  assert.match(autocomplete, /validateSeq/);
  assert.match(autocomplete, /address-line1/);
  assert.match(autocomplete, /street2: ""/);
  assert.match(autocomplete, /city: s\.city/);
});

test("Greptile P1 guards: migration order, browser origin, health merge, confirmation location", () => {
  const migration = fs.readFileSync("postgres/migrations/097_smarty_addresses.sql", "utf8");
  const checkAt = migration.indexOf("event_types_allowed_location_modes_check CHECK");
  const backfillAt = migration.indexOf("allowed_location_modes = ARRAY[inferred.mode]");
  assert.ok(backfillAt > 0 && checkAt > backfillAt, "compound check must follow backfill");
  const server = fs.readFileSync("src/lib/server.ts", "utf8");
  assert.match(server, /sameOriginBrowser/);
  const autocompleteRoute = fs.readFileSync("src/app/api/address/autocomplete/route.ts", "utf8");
  assert.match(autocompleteRoute, /sameOriginBrowser/);
  assert.doesNotMatch(autocompleteRoute, /sameOrigin\(request\)/);
  const config = fs.readFileSync("src/lib/smarty/config.ts", "utf8");
  assert.match(config, /platform_settings\.value \|\| \$3::jsonb/);
  const book = fs.readFileSync("src/app/api/book/route.ts", "utf8");
  assert.match(book, /location: location\.locationText/);
  assert.match(book, /offersBusiness/);
  assert.doesNotMatch(book, /access_instructions,validated,smarty_key/);
  const bookingAddress = fs.readFileSync("src/lib/booking-address.ts", "utf8");
  assert.match(bookingAddress, /phone=''/);
  assert.match(bookingAddress, /Virtual meeting"\)\.slice\(0, 500\)/);
});

test("CodeRabbit Major guards: enhanced_match none and usage connection release", () => {
  const client = fs.readFileSync("src/lib/smarty/client.ts", "utf8");
  assert.match(client, /enhanced_match/);
  assert.match(client, /!== "none"/);
  const usage = fs.readFileSync("src/lib/smarty/usage.ts", "utf8");
  const releaseAt = usage.indexOf("db.release()");
  const settleAt = usage.indexOf("settleUsage(");
  assert.ok(releaseAt > 0 && settleAt > releaseAt, "settleUsage must run after releasing the reservation connection");
  assert.ok(!fs.existsSync("postgres/migrations/092_smarty_addresses.sql"));
  assert.ok(!fs.existsSync("postgres/migrations/095_smarty_addresses.sql"));
  assert.ok(fs.existsSync("postgres/migrations/097_smarty_addresses.sql"));
});

test("workspace backend allows Smarty event_types columns", () => {
  const backend = fs.readFileSync("src/lib/postgres-backend.ts", "utf8");
  assert.match(backend, /"location_mode"/);
  assert.match(backend, /"allowed_location_modes"/);
  assert.match(backend, /"virtual_instructions"/);
  assert.match(backend, /"custom_location_prompt"/);
  const resolver = fs.readFileSync("src/lib/booking-address.ts", "utf8");
  assert.match(
    resolver,
    /guestAccessInstructions \|\|[\s\S]*serviceAddress\.accessInstructions/,
  );
});

test("platform business address write path and CRM typed addresses", () => {
  const workspace = fs.readFileSync("src/app/api/workspace/route.ts", "utf8");
  assert.match(workspace, /case "business-address"/);
  assert.match(workspace, /saveBusinessAddress/);
  assert.match(workspace, /businessAddressForWorkspace/);
  assert.match(workspace, /locationMode === "virtual" \|\|[\s\S]*locationMode === "custom"/);
  const booking = fs.readFileSync("src/lib/booking-address.ts", "utf8");
  assert.match(booking, /export async function saveBusinessAddress/);
  assert.match(booking, /ON CONFLICT \(workspace_id\) WHERE address_type='business'/);
  assert.ok(fs.existsSync("postgres/migrations/098_business_address_unique.sql"));
  const profile = fs.readFileSync("src/components/business-profile.tsx", "utf8");
  assert.match(profile, /action: "business-address"/);
  assert.match(profile, /AddressAutocomplete/);
  const crm = fs.readFileSync("src/components/client-center.tsx", "utf8");
  assert.match(crm, /residentialAddress/);
  assert.match(crm, /billingAddress/);
  assert.match(crm, /bookingLocationSummary/);
  assert.match(crm, /guest_phone/);
  assert.match(crm, /displayStructuredAddress/);
  assert.match(crm, /residentialRow[\s\S]*\? null/);
  const clients = fs.readFileSync("src/app/api/clients/route.ts", "utf8");
  assert.match(clients, /payload === null/);
  assert.match(clients, /DELETE FROM private\.addresses/);
  const serviceRequest = fs.readFileSync("src/components/service-request.tsx", "utf8");
  assert.match(serviceRequest, /jobSiteSubmission/);
  assert.match(serviceRequest, /accessSuffix/);
  assert.match(serviceRequest, /Shorten the description so access instructions still fit/);
  const jobs = fs.readFileSync("src/components/jobs-center.tsx", "utf8");
  assert.match(jobs, /jobSiteSubmission/);
  assert.match(jobs, /accessSuffix/);
  assert.match(jobs, /Shorten the description so access instructions still fit/);
  const createAppt = fs.readFileSync("src/components/create-appointment.tsx", "utf8");
  assert.match(createAppt, /Meeting link for this appointment/);
  assert.match(createAppt, /virtualMeetingLink/);
  assert.match(createAppt, /key=\{`\$\{eventId\}-\$\{locationMode\}`\}/);
  assert.match(crm, /key=\{c\.id\}/);
  const teamBook = fs.readFileSync("src/app/api/team-book/route.ts", "utf8");
  assert.match(teamBook, /function teamLocationPolicy/);
  assert.match(
    teamBook,
    /do not share a meeting location option/,
  );
  assert.doesNotMatch(
    teamBook,
    /if \(!intersection\.length\) intersection = \["custom"\]/,
  );
  assert.match(teamBook, /SAVEPOINT enrichment/);
  assert.match(teamBook, /ROLLBACK TO SAVEPOINT enrichment/);
  assert.match(teamBook, /serviceAddress: v\.serviceAddress/);
  assert.match(teamBook, /if \(enrichmentError instanceof ApiError\) throw enrichmentError/);
  assert.match(teamBook, /if \(requestedMode === "at_customer"\) throw enrichmentError/);
  assert.match(teamBook, /allowed_location_modes: policy\.allowed_location_modes/);
  assert.match(workspace, /locationPending: true/);
  assert.match(workspace, /Appointment was reserved, but the service address could not be saved/);
  assert.match(workspace, /if \(location\.locationMode === "at_customer"\)/);
  const teamUi = fs.readFileSync("src/components/team-booking.tsx", "utf8");
  assert.match(teamUi, /AddressAutocomplete/);
  assert.match(teamUi, /serviceAddress/);
  const bookingPage = fs.readFileSync("src/components/booking-page.tsx", "utf8");
  assert.match(bookingPage, /location_mode: locationMode/);
  assert.match(bookingPage, /service_address: resolvedServiceAddress/);
  const autocomplete = fs.readFileSync("src/app/api/address/autocomplete/route.ts", "utf8");
  assert.match(autocomplete, /resolveAddressWorkspace/);
  const validate = fs.readFileSync("src/app/api/address/validate/route.ts", "utf8");
  assert.match(validate, /resolveAddressWorkspace/);
  const widget = fs.readFileSync("src/components/address-autocomplete.tsx", "utf8");
  assert.match(widget, /host\?/);
});
