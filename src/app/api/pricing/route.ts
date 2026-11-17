import { publicPricingSurface } from "@/lib/public-pricing-surface";

export const dynamic = "force-dynamic";

export async function GET() {
  const surface = await publicPricingSurface();
  return Response.json(
    {
      family: surface.family,
      previewOnly: surface.previewOnly,
      currency: "USD",
      catalogVersion: surface.display.version,
      periods: surface.enrollment.periods.length
        ? surface.enrollment.periods
        : surface.family === "v4"
          ? ["monthly", "annual"]
          : ["monthly"],
      plans: surface.display.offers.filter((o) => o.id !== "enterprise" || o.custom),
      extraSeat: surface.display.extraSeat,
      allowances: surface.display.allowances,
      addons: surface.display.addons,
      enrollment: surface.enrollment,
      tagline: surface.display.tagline,
      hero: surface.display.hero,
      flagship: surface.display.flagship,
      // Live published checkout catalog remains available for operators even during v4 preview.
      liveCheckoutCatalogVersion: surface.liveCatalog.version,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
