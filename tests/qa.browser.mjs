// Isolated CI only: fixture accounts from upgrade.integration.mjs, never production.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const origin="http://localhost:3100";
const browser=await chromium.launch({headless:true});
const errors=[],results=[];
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
    [pages[0],["/","/pricing","/early-access","/sign-in","/privacy","/terms","/book/demo/discovery-call"]],
    [pages[1],["/app","/app/calendar","/app/clients","/app/documents","/app/templates","/app/automation","/app/team","/app/payments","/app/billing","/app/connections","/app/assistant","/app/inbox","/app/jobs","/app/feedback"]],
    [pages[2],["/admin","/admin?view=accounts","/admin/operations","/admin/operations?section=users","/admin/operations?section=pricing","/admin/operations?section=integrations","/admin/operations?section=health","/admin/operations?section=marketplace","/admin/assistant","/admin/early-access","/admin/entitlements","/admin/feedback","/admin/marketplace-tools"]],
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
        results.push({route,width,status:response.status(),overflow});
        assert(overflow<=1,`${route} at ${width}px overflows ${overflow}px`);
        assert.equal(await page.getByText("Application error",{exact:true}).count(),0,route);
        if(["/pricing","/admin?view=accounts","/admin/operations?section=users","/admin/operations?section=pricing","/app/billing"].includes(route))
          await page.screenshot({path:`test-results/qa-${route.replace(/[^a-z0-9]/gi,"-")}-${width}.png`,fullPage:true});
      }
    }
  }
  const robots=await guest.request.get(origin+"/robots.txt");assert.equal(robots.status(),200);assert.match(await robots.text(),/Disallow: \/portal/);
  const sitemap=await guest.request.get(origin+"/sitemap.xml");assert.equal(sitemap.status(),200);assert.doesNotMatch(await sitemap.text(),/\/portal|\/admin|\/api/);
  const privateResponse=await guest.request.get(origin+"/api/account");assert.equal(privateResponse.status(),401);assert.match(privateResponse.headers()["x-robots-tag"],/noindex/);
  const memberAdmin=await member.request.get(origin+"/api/admin");assert.equal(memberAdmin.status(),403);
  assert.deepEqual(errors,[]);
  console.log(`QA responsive checks passed: ${results.length} page/viewport combinations; SEO and access smoke passed.`);
} finally {
  fs.writeFileSync("test-results/qa-responsive.json",JSON.stringify({results,errors},null,2));
  await browser.close();
}
