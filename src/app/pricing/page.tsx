import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import Link from "next/link";
import { PublicPricing } from "@/components/public-pricing";
import { Logo, Icon } from "@/components/icons";

export const metadata = {
  alternates: { canonical: "https://gozenvio.com/pricing" },
  title: "Simple scheduling and signing pricing",
  description:
    "Compare Zenvio subscription plans, included allowances, and team seats. Scheduling and signing included.",
};
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [controls, surface] = await Promise.all([launchControls(), publicPricingSurface()]);
  const signupOpen = publicRegistrationOpen(controls);
  const joinHref = signupOpen ? "/sign-up" : controls.waitlistEnabled ? "/early-access" : "/demo";
  const joinLabel = signupOpen
    ? "Create account"
    : controls.waitlistEnabled
      ? "Join early access"
      : "Explore demo";
  const hero = surface.display.hero || "";
  const tagline = surface.display.tagline;

  return (
    <div className="subscription-pricing-page">
      <nav aria-label="Main navigation">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <div>
          <Link href="/demo">Explore the demo</Link>
          {signupOpen && <Link href="/sign-up">Create account</Link>}
          <Link href="/sign-in">
            Sign in <Icon name="arrow" size={16} />
          </Link>
        </div>
      </nav>
      <main>
        <header className="subscription-pricing-intro">
          <span className="subscription-kicker">
            {tagline ? tagline.toUpperCase() : "A CLEAR PRICE FOR YOUR NEXT CHAPTER"}
          </span>
          <h1>
            {hero ? (
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
            An affordable operating system for bookings, clients, documents, marketing, and growth — with
            Professional as the flagship.
          </p>
        </header>
        <PublicPricing
          joinHref={joinHref}
          joinLabel={joinLabel}
          signupOpen={signupOpen}
          previewOnly={surface.previewOnly}
          enrollmentReady={surface.enrollment.enabled}
        />
        <div className="subscription-free-note">
          <h2>Want a closer look first?</h2>
          <p>
            Explore the demo with sample data.
            {surface.previewOnly
              ? " These plans are shown for preview and aren’t open for paid enrollment yet."
              : " Enrollment uses the synchronized Stripe catalog for these plans."}{" "}
            No credit card required.
          </p>
          <Link href="/demo">
            Explore the workspace <Icon name="arrow" size={16} />
          </Link>
        </div>
      </main>
    </div>
  );
}
