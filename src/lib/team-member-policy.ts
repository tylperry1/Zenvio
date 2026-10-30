import { ApiError } from "./server";
export function assertMemberControl(actorRole: string, targetRole: string, self: boolean, action: string) {
  if (!["owner", "administrator"].includes(actorRole)) throw new ApiError("Only team managers can manage members.",403);
  if (targetRole === "owner" || self) throw new ApiError("The team owner and your own membership are protected.",409);
  if (actorRole !== "owner" && (targetRole === "administrator" || action === "role")) throw new ApiError("Only the owner can manage manager roles.",403);
}
