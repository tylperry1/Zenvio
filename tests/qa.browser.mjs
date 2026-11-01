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
    [pages[1],["/app","/app/calendar","/app/clients","/app/documents","/app/templates","/app/automation","/app/team","/app/payments","/app/billing","/app/connections","/app/assistant","/app/inbox","/app/jobs","/app/feedback","/app/growth"]],
    [pages[2],["/admin","/admin?view=accounts","/admin/operations","/admin/operations?section=users","/admin/operations?section=pricing","/admin/operations?section=integrations","/admin/operations?section=health","/admin/operations?section=marketplace","/admin/assistant","/admin/early-access","/admin/entitlements","/admin/feedback","/admin/marketplace-tools","/admin/team"]],
  ];
  for(const width of [375,390,768,1024,1440,1920]) {
    for(const [page,routes] of groups) {
      await page.setViewportSize({width,height:1000});
      for(const route of routes){
        const response=await page.goto(origin+route);
        assert.equal(response.status(),200,route);
        console.log(`QA page ${route} at ${width}px`);
        await page.locator("h1").first().waitFor();
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
        if(["/pricing","/admin?view=accounts","/admin/operations?section=users","/admin/operations?section=pricing","/app/billing"].includes(route))
          await page.screenshot({path:`test-results/qa-${route.replace(/[^a-z0-9]/gi,"-")}-${width}.png`,fullPage:true});
      }
    }
  }
  // Customer-product UI acceptance stays in the isolated fixture: no provider checkout.
  await pages[1].goto(origin+"/app/growth");
  const offerForm=pages[1].locator("form").filter({has:pages[1].getByRole("heading",{name:"Create an offer",exact:true})});
  await offerForm.locator('[name="title"]').fill("QA service package");
  await offerForm.locator('[name="description"]').fill("Three service visits. Contact the business for eligible services.");
  await offerForm.locator('[name="priceCents"]').fill("7500");
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
