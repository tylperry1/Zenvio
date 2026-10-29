import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  ApiError,
} from "@/lib/server";
import { intakeQuestions } from "@/lib/intake";
export const dynamic = "force-dynamic";
export async function POST(r: NextRequest) {
  try {
    sameOrigin(r);
    const { token } = await session(),
      v = await body(r);
    const q = intakeQuestions(v.questions),
      updated = await getPool().query(
        "UPDATE public.event_types SET intake_questions=$3 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id",
        [uuid(v.id), token, JSON.stringify(q)],
      );
    if (!updated.rowCount)
      throw new ApiError("Appointment type not found.", 404);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
