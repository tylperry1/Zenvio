import { NextRequest } from "next/server";
import { loadPublicProfile, vcard } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await loadPublicProfile(slug.toLowerCase());
  if (!profile) return new Response("Not found", { status: 404 });
  const file = profile.view.displayName.replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-") || "contact";
  return new Response(vcard(profile.view, request.nextUrl.origin), {
    headers: { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.vcf"`, "Cache-Control": "no-store" },
  });
}
