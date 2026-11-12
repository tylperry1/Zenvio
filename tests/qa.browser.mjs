// Isolated CI only: fixture accounts from upgrade.integration.mjs, never production.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const origin="http://localhost:3100";
const browser=await chromium.launch({headless:true});
const errors=[],results=[],apiTimings=[];
fs.mkdirSync("test-results",{recursive:true});
try {
  const guest=await browser.newContext(),member=await browser.newContext(),admin=await browser.newContext();
  for (const [context,email] of [[member,"alice@example.com"],[admin,"owner@example.com"]]) {
    const r=await context.request.post(origin+"/api/auth",{headers:{Origin:origin},data:{action:"sign-in",email,password:"An-isolated-password-123456789!"}});
    assert.equal(r.status(),200,await r.text());
  }
  const pages=[await guest.newPage(),await member.newPage(),await admin.newPage()];
  for(const page of pages)page.on("pageerror",e=>errors.push(e.message));
  const groups=[
    [pages[0],["/","/pricing","/early-access","/sign-in","/privacy","/terms","/book/demo/discovery-call","/shop/not-a-business","/gift-card","/purchase/complete","/class-cancel","/waitlist-offer"]],
    [pages[1],["/app","/app/calendar","/app/clients","/app/documents","/app/templates","/app/automation","/app/team","/app/payments","/app/billing","/app/connections","/app/assistant","/app/inbox","/app/jobs","/app/feedback","/app/growth","/app/support","/app/marketing","/app/smart-cards","/app?view=availability","/app?view=event-types"]],
    [pages[2],["/admin","/admin?view=accounts","/admin/operations","/admin/operations?section=users","/admin/operations?section=pricing","/admin/operations?section=integrations","/admin/operations?section=health","/admin/operations?section=marketplace","/admin/assistant","/admin/early-access","/admin/entitlements","/admin/economics","/admin/feedback","/admin/marketplace-tools","/admin/team","/admin/support","/admin/email-preview","/admin/suppliers","/admin/suppliers?view=integrations"]],
  ];
  for(const width of [375,390,768,1024,1440,1920]) {
    for(const [page,routes] of groups) {
      await page.setViewportSize({width,height:1000});
      for(const route of routes){
        const response=await page.goto(origin+route);
        assert.equal(response.status(),200,route);
        console.log(`QA page ${route} at ${width}px`);
        await page.locator("h1").first().waitFor();
        if(route==="/pricing") {
          const table=page.getByRole("table",{name:"New monthly subscription allowances"});
          assert.deepEqual(await table.getByRole("row",{name:/Signing envelopes/}).getByRole("cell").allTextContents(),["10","30"]);
          assert.deepEqual(await table.getByRole("row",{name:/AI credits/}).getByRole("cell").allTextContents(),["150","450"]);
          assert.equal(await page.getByText(/Extra-seat charges are also half off/).count(),0);
        }
        if(route === "/app/inbox") {
          const filters = page.getByRole("tablist", {name: "Filter conversations"});
          await filters.getByRole("tab", {name: "Closed", exact: true}).waitFor();
          const layout = await filters.evaluate(node => {
            const parent = node.getBoundingClientRect();
            return {overflow: node.scrollWidth - node.clientWidth, tabsFit: [...node.querySelectorAll('[role="tab"]')].every(tab => {
              const box = tab.getBoundingClientRect();
              return box.left >= parent.left - 1 && box.right <= parent.right + 1 && box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1;
            })};
          });
          assert.ok(layout.overflow <= 1 && layout.tabsFit, `Inbox filters must fit at ${width}px: ${JSON.stringify(layout)}`);
          await filters.getByRole("tab", {name: "Closed", exact: true}).click();
          assert.equal(await filters.getByRole("tab", {name: "Closed", exact: true}).getAttribute("aria-selected"), "true");
          await page.screenshot({path: `test-results/inbox-filters-${width}.png`});
        }
        if(route === "/admin/suppliers?view=integrations") {
          const sections = page.getByRole("group", {name: "Gelato sections"});
          const last = sections.getByRole("button", {name: "Sync & logs", exact: true});
          await last.waitFor();
          assert.ok(await sections.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Supplier section controls must fit without sideways scrolling");
          await last.click();
          assert.equal(await last.getAttribute("aria-pressed"), "true");
          await page.screenshot({path: `test-results/supplier-sections-${width}.png`});
        }
        // Await fonts/layout, without asserting a synthetic performance target.
        await page.evaluate(()=>document.fonts.ready);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        const timing=await page.evaluate(()=>{
          const n=performance.getEntriesByType("navigation")[0];
          return n ? {ttfbMs:n.responseStart-n.requestStart,domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd} : null;
        });
        results.push({route,width,status:response.status(),overflow,timing});
        assert(overflow<=1,`${route} at ${width}px overflows ${overflow}px`);
        assert.equal(await page.getByText("Application error",{exact:true}).count(),0,route);
        if(route === "/app/clients" && width <= 640) {
          const clientOverflow=await page.locator(".client-table-wrap").evaluate(n=>n.scrollWidth-n.clientWidth);
          assert(clientOverflow <= 1, "mobile client records must fit without sideways scrolling");
        }
        if(["/pricing","/admin?view=accounts","/admin/operations?section=users","/admin/operations?section=pricing","/app/billing","/app/clients","/app/connections","/app/smart-cards","/app/growth","/app?view=availability","/app?view=event-types"].includes(route))
          await page.screenshot({path:`test-results/qa-${route.replace(/[^a-z0-9]/gi,"-")}-${width}.png`,fullPage:true});
      }
    }
  }

  // Review the redesigned workspace sections without changing billing or live bookings.
  const polishPage=pages[1];
  for(const width of [390,1440]) {
    await polishPage.setViewportSize({width,height:900});
    await polishPage.goto(origin+"/app/billing");
    await polishPage.locator(".subscription-account-card").waitFor();
    for(const label of ["Overview","Plans","Usage & credits","Invoices"]) {
      const tab=polishPage.getByRole("tab",{name:label,exact:true});
      await tab.click();assert.equal(await tab.getAttribute("aria-selected"),"true");
      assert.ok(await polishPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await polishPage.screenshot({path:`test-results/billing-${label.replaceAll(/[^a-z0-9]/gi,"-")}-${width}.png`,fullPage:true});
    }
    await polishPage.goto(origin+"/app?view=availability");
    await polishPage.getByRole("tab",{name:"Weekly hours",exact:true}).waitFor();
    await polishPage.getByLabel("Apply schedule preset").selectOption("split");
    assert.equal(await polishPage.getByLabel("Monday start time 2",{exact:true}).inputValue(),"13:00");
    await polishPage.screenshot({path:`test-results/availability-split-hours-${width}.png`,fullPage:true});
    await polishPage.getByRole("tab",{name:"Date exceptions",exact:true}).click();
    await polishPage.getByLabel("Exception date",{exact:true}).waitFor();
    await polishPage.screenshot({path:`test-results/availability-date-exceptions-${width}.png`,fullPage:true});
    await polishPage.getByRole("tab",{name:"Booking rules",exact:true}).click();
    await polishPage.getByLabel("Minimum notice",{exact:true}).waitFor();
    await polishPage.screenshot({path:`test-results/availability-booking-rules-${width}.png`,fullPage:true});
    await polishPage.goto(origin+"/app/growth");
    for(const label of ["Offers","Classes","Memberships","Coupons","Orders"]) {
      const tab=polishPage.getByRole("tab",{name:label,exact:true});
      await tab.click();assert.equal(await tab.getAttribute("aria-selected"),"true");
      assert.ok(await polishPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await polishPage.screenshot({path:`test-results/growth-${label.toLowerCase()}-${width}.png`,fullPage:true});
    }
  }
  const localContext=await browser.newContext({timezoneId:"America/Los_Angeles",storageState:await member.storageState()});
  const localPage=await localContext.newPage();
  await localPage.goto(origin+"/app/calendar");
  assert.equal(await localPage.getByLabel("Timezone",{exact:true}).inputValue(),"auto");
  await localPage.getByRole("button",{name:"+ New appointment",exact:true}).click();
  const localDialog=localPage.getByRole("dialog",{name:"Create appointment"});
  assert.equal(await localDialog.getByLabel("Time zone",{exact:true}).inputValue(),"auto");
  await localDialog.getByLabel("Meeting location",{exact:true}).fill("120 Main Street");
  await localDialog.getByRole("button",{name:"Close dialog",exact:true}).click();
  await localContext.close();

  const calendarPage = pages[1];
  await calendarPage.route("**/api/calendars/google", (route) => route.fulfill({ json: {
    configured: true, isAdmin: true, redirectUri: "", maximumAccounts: 5,
    jobs: { pending: 0, failed: 0 },
    connections: [{ account_sub: "fixture", account_email: "a-long-google-calendar-address@example.com",
      status: "connected", check_conflicts: true, sync_events: true, last_sync_at: null,
      last_error: "Google Calendar API is disabled for the OAuth client’s Google Cloud project. The platform administrator must enable Google Calendar API in that same project." }],
  } }));
  for (const width of [375, 390, 768, 1440]) {
    await calendarPage.setViewportSize({ width, height: 900 });
    await calendarPage.goto(origin + "/app/connections");
    const account = calendarPage.locator(".gc-account");
    await account.getByText("Needs attention", { exact: true }).waitFor();
    await account.getByRole("link", { name: /Enable Google Calendar API/ }).waitFor();
    const layout = await account.evaluate((node) => {
      const main = node.querySelector(".ui-list-main").getBoundingClientRect();
      const actions = node.querySelector(".gc-actions").getBoundingClientRect();
      return { textWidth: main.width, actionsBelow: actions.top >= main.bottom - 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(layout.textWidth >= 180, JSON.stringify({ width, layout }));
    assert.ok(layout.actionsBelow);
    assert.equal(layout.pageOverflow, false);
    await calendarPage.screenshot({ path: `test-results/calendar-connection-${width}.png` });
  }
  await calendarPage.unroute("**/api/calendars/google");
  for (const width of [390, 1440]) {
    await calendarPage.setViewportSize({width, height:900});
    await calendarPage.goto(origin+"/app/calendar");
    await calendarPage.getByRole("button", {name:"+ New appointment", exact:true}).click();
    const appointmentDialog=calendarPage.getByRole("dialog", {name:"Create appointment"});
    const spacing=await appointmentDialog.locator(".appointment-form > label").evaluateAll(labels=>labels.map(label=>{
      const style=getComputedStyle(label);
      return {top:style.marginTop,bottom:style.marginBottom};
    }));
    assert.ok(spacing.length>0 && spacing.every(s=>s.top==="0px" && s.bottom==="0px"), "Appointment labels must not double the form grid spacing");
    await appointmentDialog.getByLabel("Enter a custom time outside availability").check();
    await appointmentDialog.getByLabel("Custom time", {exact:true}).waitFor();
    await appointmentDialog.getByLabel("Reason for override", {exact:true}).waitFor();
    assert.ok(await appointmentDialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1), "Appointment dialog must fit the viewport");
    await calendarPage.screenshot({path:`test-results/manual-appointment-spacing-${width}.png`});
    await appointmentDialog.getByRole("button", {name:"Close dialog",exact:true}).click();
  }

  const adminMenu = pages[2];
  await adminMenu.setViewportSize({ width: 1440, height: 900 });
  await adminMenu.goto(origin + "/admin/operations?section=health");
  const workspaceMenu = pages[1];
  await workspaceMenu.setViewportSize({width:1440,height:1000});
  await workspaceMenu.goto(origin+"/app/clients");
  const businessGroup = workspaceMenu.locator(".shell-nav-group").filter({has:workspaceMenu.locator("summary",{hasText:"Business"})});
  assert.equal(await businessGroup.getAttribute("open"),null);
  await businessGroup.locator("summary").click();
  await businessGroup.getByRole("link",{name:"Team",exact:true}).waitFor();
  await workspaceMenu.screenshot({path:"test-results/workspace-menu-compact.png"});
  const platformNav = adminMenu.getByRole("navigation", { name: "Platform", exact: true });
  const healthLink = platformNav.getByRole("link", { name: "System health" });
  await healthLink.waitFor();
  assert.equal(await healthLink.getAttribute("aria-current"), "page");
  const group = platformNav.locator("..");
  const appearance = await group.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, padding: style.padding, border: style.borderTopWidth };
  });
  assert.deepEqual(appearance, { background: "rgba(0, 0, 0, 0)", padding: "0px", border: "0px" });
  await adminMenu.screenshot({ path: "test-results/admin-health-sidebar.png" });
  await adminMenu.goto(origin + "/admin");
  const billingToggle = adminMenu.getByRole("button", { name: "Billing", exact: true });
  assert.equal(await billingToggle.getAttribute("aria-expanded"), "false");
  await billingToggle.click();
  await adminMenu.getByRole("navigation", { name: "Billing", exact: true }).getByRole("link", { name: "Subscriptions" }).waitFor();
  await billingToggle.click();
  await adminMenu.getByRole("textbox", { name: "Filter admin sections" }).fill("supplier");
  await adminMenu.getByRole("link", { name: "Suppliers & pricing" }).waitFor();
  await adminMenu.getByRole("textbox", { name: "Filter admin sections" }).press("Escape");
  await adminMenu.screenshot({ path: "test-results/admin-menu-desktop.png" });
  await adminMenu.setViewportSize({ width: 390, height: 844 });
  await adminMenu.getByRole("button", { name: "Toggle admin navigation" }).click();
  await adminMenu.getByRole("link", { name: "Support inbox" }).waitFor();
  await adminMenu.locator("#admin-console-links").getByRole("button", { name: "Sign out" }).waitFor();
  assert.ok(await adminMenu.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await adminMenu.screenshot({ path: "test-results/admin-menu-mobile.png" });

  // Master-admin-only storefront visibility is a real UI switch, separate from checkout.
  await adminMenu.setViewportSize({width:1440,height:1000});
  await adminMenu.goto(origin+"/admin/operations?section=marketplace");
  await adminMenu.getByRole("button",{name:"Settings",exact:true}).click();
  const storeSwitch=adminMenu.getByRole("switch",{name:"Marketplace visible to customers"});
  await storeSwitch.waitFor();
  await Promise.all([
    adminMenu.waitForResponse(r=>r.url().endsWith("/api/admin/marketplace") && r.request().method()==="POST" && r.status()===200),
    storeSwitch.uncheck(),
  ]);
  await adminMenu.getByText("Marketplace is hidden.",{exact:true}).waitFor();
  await adminMenu.screenshot({path:"test-results/marketplace-visibility-desktop.png",fullPage:true});
  await pages[1].goto(origin+"/app/clients");
  assert.equal(await pages[1].locator('.shell-nav-group a[href="/marketplace"]').count(),0);
  await Promise.all([
    adminMenu.waitForResponse(r=>r.url().endsWith("/api/admin/marketplace") && r.request().method()==="POST" && r.status()===200),
    storeSwitch.check(),
  ]);
  await adminMenu.getByText("Marketplace is visible. Checkout still requires its own readiness checks.",{exact:true}).waitFor();

  await adminMenu.setViewportSize({width:1440,height:1000});
  await adminMenu.goto(origin+"/admin/suppliers");
  const commerceMenu=adminMenu.getByRole("navigation",{name:"Commerce",exact:true});
  assert.equal(await commerceMenu.locator('a[href="/admin/gelato"]').count(),0);
  await adminMenu.getByRole("navigation",{name:"Supplier sections"}).getByRole("link",{name:"Integrations",exact:true}).click();
  await adminMenu.getByRole("heading",{name:"Gelato",exact:true}).waitFor();
  assert.equal(await commerceMenu.getByRole("link",{name:"Suppliers & pricing",exact:true}).getAttribute("aria-current"),"page");
  await adminMenu.screenshot({path:"test-results/commerce-supplier-integrations-desktop.png",fullPage:true});
  await adminMenu.setViewportSize({width:390,height:844});
  assert.ok(await adminMenu.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await adminMenu.screenshot({path:"test-results/commerce-supplier-integrations-mobile.png",fullPage:true});
  await adminMenu.goto(origin+"/admin/gelato");
  assert.equal(new URL(adminMenu.url()).pathname,"/admin/suppliers");
  assert.equal(new URL(adminMenu.url()).searchParams.get("view"),"integrations");

  // Customer-product UI acceptance stays in the isolated fixture: no provider checkout.
  await pages[1].goto(origin+"/app/growth");
  const offerForm=pages[1].locator("form").filter({has:pages[1].getByRole("heading",{name:"Create an offer",exact:true})});
  await offerForm.locator('[name="title"]').fill("QA service package");
  await offerForm.locator('[name="description"]').fill("Three service visits. Contact the business for eligible services.");
  await offerForm.locator('[name="priceDollars"]').fill("75.00");
  await offerForm.locator('[name="creditUnits"]').fill("3");
  await offerForm.locator('[name="unit"]').fill("VISITS");
  await offerForm.getByRole("button",{name:"Save draft offer"}).click();
  await pages[1].getByRole("status").filter({hasText:"Offer saved as a draft"}).waitFor();
  const offerCard=pages[1].locator("article").filter({has:pages[1].getByRole("heading",{name:"QA service package",exact:true})});
  await offerCard.getByRole("button",{name:"Publish offer",exact:true}).click();
  await pages[1].getByRole("status").filter({hasText:"Offer published"}).waitFor();
  const business=(await (await member.request.get(origin+"/api/workspace")).json()).profile.slug;
  await pages[0].goto(origin+"/shop/"+encodeURIComponent(business));
  await pages[0].getByRole("heading",{name:"QA service package",exact:true}).waitFor();
  assert.equal(await pages[0].getByRole("button",{name:"Review offer",exact:true}).isDisabled(),true,"unvalidated checkout stays disabled");
  await pages[0].screenshot({path:"test-results/customer-offers-mobile.png",fullPage:true});

  await pages[1].getByRole("tab",{name:"Coupons",exact:true}).click();
  const couponForm=pages[1].locator("form").filter({has:pages[1].getByRole("heading",{name:"Create a package coupon",exact:true})});
  await couponForm.locator('[name="code"]').fill("QA-SAVE10");
  await couponForm.locator('[name="percentOff"]').fill("10");
  await couponForm.locator('[name="maximumUses"]').fill("3");
  await couponForm.locator('[name="expiresAt"]').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
  await couponForm.getByRole("button",{name:"Create coupon",exact:true}).click();
  await pages[1].getByRole("status").filter({hasText:"Coupon created."}).waitFor();
  const couponCard=pages[1].locator("article").filter({has:pages[1].getByRole("heading",{name:"QA-SAVE10",exact:true})});
  await couponCard.getByRole("button",{name:"Pause coupon QA-SAVE10",exact:true}).click();
  await couponCard.getByRole("button",{name:"Reactivate coupon QA-SAVE10",exact:true}).waitFor();
  await couponCard.getByRole("button",{name:"Reactivate coupon QA-SAVE10",exact:true}).click();
  await couponCard.getByRole("button",{name:"Pause coupon QA-SAVE10",exact:true}).waitFor();

  for (const route of ["/api/workspace","/api/clients","/api/account","/api/billing"]) {
    for (let sample=0;sample<5;sample++) {
      const start=performance.now();
      const response=await member.request.get(origin+route);
      const elapsedMs=performance.now()-start;
      assert.equal(response.status(),200,route);
      apiTimings.push({route,sample,elapsedMs});
    }
  }
  const robots=await guest.request.get(origin+"/robots.txt");assert.equal(robots.status(),200);assert.match(await robots.text(),/Disallow: \/portal/);
  const sitemap=await guest.request.get(origin+"/sitemap.xml");assert.equal(sitemap.status(),200);assert.doesNotMatch(await sitemap.text(),/\/portal|\/admin|\/api/);
  const privateResponse=await guest.request.get(origin+"/api/account");assert.equal(privateResponse.status(),401);assert.match(privateResponse.headers()["x-robots-tag"],/noindex/);
  const memberAdmin=await member.request.get(origin+"/api/admin");assert.equal(memberAdmin.status(),403);
  const teamList = await member.request.get(origin + "/api/teams");
  assert.equal(teamList.status(), 200);
  const fixtureTeam = (await teamList.json()).organizations.find((org) => org.slug === "fixture-team");
  assert.ok(fixtureTeam);
  const inviteEmail = "browser-invited@example.com";
  const invitation = await member.request.post(origin + "/api/teams", {
    headers: { Origin: origin },
    data: { action: "invite", organization: fixtureTeam.id, email: inviteEmail, role: "staff" },
  });
  assert.equal(invitation.status(), 200, await invitation.text());
  const invitePage = await guest.newPage();
  await invitePage.setViewportSize({ width: 390, height: 844 });
  await invitePage.goto(origin + (await invitation.json()).invitationPath);
  await invitePage.getByLabel("Your name").fill("Browser Teammate");
  assert.equal(await invitePage.getByLabel("Invited email").inputValue(), inviteEmail);
  assert.equal(await invitePage.getByLabel("Invited email").getAttribute("readonly"), "");
  await invitePage.getByLabel("Create a password").fill("An-isolated-password-123456789!");
  await invitePage.getByRole("button", { name: "Create account and join" }).click();
  await invitePage.waitForURL("**/app/team");
  const membership = await guest.request.get(origin + "/api/teams?id=" + fixtureTeam.id);
  assert.equal(membership.status(), 200);
  assert.equal((await membership.json()).role, "staff");
  assert.deepEqual(errors,[]);
  for (const route of [...new Set(apiTimings.map(r=>r.route))]) {
    const samples=apiTimings.filter(r=>r.route===route).map(r=>r.elapsedMs).sort((a,b)=>a-b);
    console.log(`QA fixture API timing ${route}: median=${samples[2].toFixed(1)}ms max=${samples.at(-1).toFixed(1)}ms samples=5`);
  }
  console.log(`QA responsive checks passed: ${results.length} page/viewport combinations; SEO and access smoke passed.`);
} finally {
  fs.writeFileSync("test-results/qa-responsive.json",JSON.stringify({results,apiTimings,errors},null,2));
  await browser.close();
}
