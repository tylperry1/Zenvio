import { getPool } from "./db";
import { ApiError, publicHostSlug, session } from "./server";

/** Resolve workspace id for Smarty lookups: public booking host slug, or signed-in session. */
export async function resolveAddressWorkspace(opts: {
  host?: string | null;
  allowSession?: boolean;
}): Promise<{ workspaceId: string; via: "host" | "session" }> {
  const hostRaw = String(opts.host || "").trim();
  if (hostRaw) {
    const host = publicHostSlug(hostRaw, "This booking page is unavailable.");
    const workspace = (
      await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])
    ).rows[0];
    if (!workspace) throw new ApiError("This booking page is unavailable.", 404);
    return { workspaceId: workspace.id, via: "host" };
  }
  if (opts.allowSession !== false) {
    try {
      const { token } = await session();
      return { workspaceId: token, via: "session" };
    } catch {
      /* fall through */
    }
  }
  throw new ApiError("This booking page is unavailable.", 404);
}
