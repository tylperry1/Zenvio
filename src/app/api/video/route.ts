import { failure, session } from "@/lib/server";
import { videoStatus } from "@/lib/video";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await session();
    return Response.json(await videoStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
