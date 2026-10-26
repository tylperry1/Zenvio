import { configured } from "@/lib/server";
export async function GET() {
  return Response.json(
    { accounts: configured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
