import { accountReadiness } from "@/lib/account-readiness";
export async function GET() {
  return Response.json(
    { accounts: await accountReadiness() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
