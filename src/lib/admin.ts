import { ApiError, backend, session } from "./server";
export async function platformRole(
  token: string,
): Promise<"master_admin" | "member"> {
  const role = await backend(
    "/rest/v1/rpc/current_platform_role",
    { method: "POST", body: "{}" },
    token,
  );
  return role === "master_admin" ? "master_admin" : "member";
}
export async function adminSession() {
  const current = await session();
  if ((await platformRole(current.token)) !== "master_admin")
    throw new ApiError(
      "This area is reserved for the platform administrator.",
      403,
    );
  return current;
}
