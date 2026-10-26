import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const configured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export function configuration() {
  if (!configured())
    throw new ApiError(
      "Account services are not connected yet. Explore the interactive demo while we finish setup.",
      503,
    );
  return {
    url: process.env.SUPABASE_URL!.replace(/\/$/, ""),
    key: process.env.SUPABASE_ANON_KEY!,
  };
}
export async function backend(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const { url, key } = configuration();
  const headers = new Headers(options.headers);
  headers.set("apikey", key);
  headers.set("Content-Type", "application/json");
  if (token || key.startsWith("eyJ"))
    headers.set("Authorization", `Bearer ${token || key}`);
  const response = await fetch(`${url}${path}`, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status >= 500)
      throw new ApiError(
        "Account services are temporarily unavailable. Please try again.",
        503,
      );
    const message =
      data?.msg ||
      data?.error_description ||
      data?.message ||
      "The request could not be completed.";
    if (message.includes("duplicate key"))
      throw new ApiError(
        "That booking link is already in use. Please choose another.",
      );
    if (message.includes("exclusion") || message.includes("slot_unavailable"))
      throw new ApiError(
        "That time was just booked. Please choose another.",
        409,
      );
    if (message.includes("rate_limit"))
      throw new ApiError("Too many requests. Please wait and try again.", 429);
    if (response.status === 401)
      throw new ApiError("Please sign in again.", 401);
    if (message.includes("Invalid login credentials"))
      throw new ApiError("Email or password is incorrect.", 401);
    if (message.includes("Email not confirmed"))
      throw new ApiError("Please confirm your email before signing in.");
    if (message.includes("not_found"))
      throw new ApiError("This booking page is unavailable.", 404);
    throw new ApiError(
      "We could not save that change. Check your details and try again.",
      response.status === 403 ? 403 : 400,
    );
  }
  return data;
}
export async function saveSession(data: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}) {
  const jar = await cookies();
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  jar.set("zenvio_access", data.access_token, {
    ...common,
    maxAge: data.expires_in || 3600,
  });
  jar.set("zenvio_refresh", data.refresh_token, {
    ...common,
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearSession() {
  const jar = await cookies();
  jar.delete("zenvio_access");
  jar.delete("zenvio_refresh");
}
export async function session() {
  const jar = await cookies();
  let token = jar.get("zenvio_access")?.value;
  if (token) {
    try {
      const user = await backend("/auth/v1/user", {}, token);
      return { token, user };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
  }
  const refresh = jar.get("zenvio_refresh")?.value;
  if (!refresh) throw new ApiError("Please sign in to continue.", 401);
  const data = await backend("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refresh }),
  });
  await saveSession(data);
  token = data.access_token;
  const user = await backend("/auth/v1/user", {}, token);
  return { token: token!, user };
}
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin)
    throw new ApiError("This request is not allowed.", 403);
}
export async function body(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError("Expected a JSON request.", 415);
  const raw = await request.text();
  if (raw.length > 16384) throw new ApiError("This request is too large.", 413);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("Invalid request.");
  }
}
export function string(value: unknown, name: string, max = 200, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new ApiError(`Please enter a valid ${name}.`);
  return value.trim();
}
export function email(value: unknown) {
  const result = string(value, "email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw new ApiError("Please enter a valid email address.");
  return result.toLowerCase();
}
export function password(value: unknown, min = 12) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > 128 ||
    !value.trim()
  )
    throw new ApiError(
      `Please enter a password with ${min === 1 ? "at least one" : `at least ${min}`} character${min === 1 ? "" : "s"}.`,
    );
  return value;
}
export function slug(value: unknown) {
  const result = string(value, "booking link", 60, 3);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result))
    throw new ApiError(
      "Use lowercase letters, numbers, and hyphens for your link.",
    );
  return result;
}
export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new ApiError(`Please enter a valid ${name}.`);
  return value;
}
export function uuid(value: unknown) {
  const result = string(value, "record ID", 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      result,
    )
  )
    throw new ApiError("Invalid record.");
  return result;
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "Zenvio request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
