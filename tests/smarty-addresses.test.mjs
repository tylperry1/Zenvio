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
  assert.match(resolved.locationText, /Zoom/);
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
  const migration = fs.readFileSync("postgres/migrations/092_smarty_addresses.sql", "utf8");
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
  assert.match(page, /saveAsResidential/);
  const autocomplete = fs.readFileSync("src/components/address-autocomplete.tsx", "utf8");
  assert.match(autocomplete, /Enter the address manually/);
});
