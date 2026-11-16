import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (f) => fs.readFileSync(f, "utf8");

test("public registration uses the same launch-control flags on page and API", () => {
  const controls = read("src/lib/launch-controls.ts");
  const page = read("src/app/sign-up/page.tsx");
  assert.match(page, /initialReferral/);
  const auth = read("src/app/api/auth/route.ts");
  const home = read("src/app/page.tsx");
  assert.match(controls, /export function publicRegistrationOpen/);
  assert.match(controls, /signupEnabled && !controls.invitationOnly && !controls.maintenance/);
  assert.match(page, /publicRegistrationOpen\(controls\)/);
  assert.match(page, /SignupUnavailable/);
  assert.match(page, /initialReferral/);
  assert.match(auth, /publicRegistrationOpen\(controls\)/);
  assert.match(home, /publicRegistrationOpen\(controls\)/);
  assert.doesNotMatch(page, /Signup is by invitation/);
});

test("signup form is the Better Auth workspace flow with confirmation and partner codes", () => {
  const form = read("src/components/auth-form.tsx");
  assert.match(form, /Start building a better business with Zenvio/);
  assert.match(form, /Create account/);
  assert.match(form, /confirmPassword/);
  assert.match(form, /Passwords do not match/);
  assert.match(form, /action: recover \? "recover" : mode/);
  assert.match(form, /\/api\/auth/);
  assert.match(form, /referralCode/);
  assert.match(form, /params.get\("ref"\)/);
  assert.match(form, /You’ve been invited to Zenvio/);
  assert.match(form, /auth-layout-invite/);
  assert.match(form, /auth-invite-banner/);
  assert.match(form, /referralLocked/);
  assert.match(form, /Change code/);
  assert.match(form, /invited \? \(/);
  assert.match(form, /Show password/);
  assert.match(form, /\/terms/);
  assert.match(form, /\/privacy/);
});

test("pricing CTAs follow public registration instead of the waitlist", () => {
  const pricing = read("src/components/public-pricing.tsx");
  const home = read("src/app/page.tsx");
  const page = read("src/app/pricing/page.tsx");
  const waitlist = read("src/components/early-access-form.tsx");
  assert.match(pricing, /signupOpen/);
  assert.match(pricing, /\/sign-up\?plan=individual/);
  assert.doesNotMatch(pricing, /Reserve before launch/);
  assert.match(home, /signupOpen=\{publicRegistrationOpen\(controls\)\}/);
  assert.match(page, /signupOpen=\{signupOpen\}/);
  assert.match(waitlist, /signupOpen\?"\/sign-up":"\/demo"/);
});

test("launch migration opens public signup without touching checkout or waitlist rows", () => {
  const sql = read("postgres/migrations/079_public_signup_launch.sql");
  assert.match(sql, /signupEnabled', true/);
  assert.match(sql, /invitationOnly', false/);
  assert.doesNotMatch(sql, /checkoutEnabled', true/);
  assert.doesNotMatch(sql, /early_access_signups/);
  assert.doesNotMatch(sql, /DELETE FROM private.early_access/);
});
