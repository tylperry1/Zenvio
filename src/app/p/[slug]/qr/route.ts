import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { loadPublicProfile } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await loadPublicProfile((await params).slug.toLowerCase());
  if (!profile) return new Response("Not found", { status: 404 });
  const format = request.nextUrl.searchParams.get("format") ?? "svg";
  if (format !== "svg" && format !== "png") return new Response("Choose PNG or SVG", { status: 400 });
  const destination = new URL(`/p/${profile.view.slug}?via=qr`, request.nextUrl.origin).href;
  const options = { errorCorrectionLevel: "M" as const, margin: 4, width: 1024 };
  const qr = format === "svg"
    ? await QRCode.toString(destination, { ...options, type: "svg" })
    : Uint8Array.from(await QRCode.toBuffer(destination, options));
  return new Response(qr, {
    headers: {
      "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
      "Content-Disposition": `attachment; filename="${profile.view.slug}-qr.${format}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
