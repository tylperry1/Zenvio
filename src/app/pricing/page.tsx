import { launchPromotionEnabled } from "@/lib/pricing-policy";
import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import Link from "next/link";
import { PublicPricing } from "@/components/public-pricing";
import { PublicPricingV4 } from "@/components/public-pricing-v4";
import { Icon } from "@/components/icons";
import { PublicSiteHeader } from "@/components/public-site-header";
import "../marketing.css";

export const metadata = {
  alternates: { canonical: "https://gozenvio.com/pricing" },
  title: "Simple scheduling and signing pricing",
  description:
    "Compare Zenvio subscription plans, included allowances, and team seats. Scheduling and signing included.",
};
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [promotionEnabled, controls, surface] = await Promise.all([
    launchPromotionEnabled(),
    launchControls(),
    publicPricingSurface(),
  ]);
  const signupOpen = publicRegistrationOpen(controls);
  const showV4 = surface.family === "v4";
  const joinHref = signupOpen ? "/sign-up" : controls.waitlistEnabled ? "/early-access" : "/demo";
  const joinLabel = signupOpen
    ? "Create account"
    : controls.waitlistEnabled
      ? "Join early access"
      : "Explore demo";
  const hero = surface.display.hero || "";
  const tagline = surface.display.tagline;

  return (
    <>
      <PublicSiteHeader />
      <div className="marketing-v3 pricing-page">
      <main>
        <header className="subscription-pricing-intro">
          <span className="subscription-kicker">
            {showV4 && tagline ? tagline.toUpperCase() : "A CLEAR PRICE FOR YOUR NEXT CHAPTER"}
          </span>
          <h1>
            {showV4 && hero ? (
              <>
                {hero.split(". ")[0]}.
                <br />
                <span>{hero.split(". ").slice(1).join(". ")}</span>
              </>
            ) : (
              <>
                Great work starts here.
                <br />
                <span>So does simple pricing.</span>
              </>
            )}
          </h1>
          <p>
            {showV4
              ? "An affordable operating system for bookings, clients, documents, marketing, and growth — with Professional as the flagship."
              : "Your calendar, clients, and signed agreements. Together in one workspace, with a monthly bill you can understand."}
          </p>
        </header>
        {showV4 ? (
          <PublicPricingV4
            joinHref={joinHref}
            joinLabel={joinLabel}
            signupOpen={signupOpen}
            previewOnly={surface.previewOnly}
            enrollmentReady={surface.enrollment.enabled}
          />
        ) : (
          <PublicPricing
            promotionEnabled={promotionEnabled}
            waitlistEnabled={controls.waitlistEnabled}
            signupOpen={signupOpen}
            catalog={surface.liveCatalog}
          />
        )}
        <div className="subscription-free-note">
          <h2>Want a closer look first?</h2>
          <p>
            Explore the demo with sample data.
            {showV4
              ? surface.previewOnly
                ? " These new plans are shown for preview and aren’t open for paid enrollment yet."
                : " Enrollment uses the synchronized Stripe catalog for these plans."
              : " See the current launch offer above when it is available."}{" "}
            No credit card required.
          </p>
          <Link href="/demo">
            Explore the workspace <Icon name="arrow" size={16} />
          </Link>
        </div>
        </main>
      </div>
    </>
  );
}
