import { configured } from "@/lib/server";
export async function GET() {
  return Response.json(
    {
      status: "ok",
      accounts: configured() ? "configured" : "not_configured",
      version: "0.1.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
