import { headers } from "next/headers";
import { getAuth } from "./auth";
import { databaseConfigured } from "./db";
import { postgresBackend } from "./postgres-backend";
import { NextRequest } from "next/server";
export class ApiError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
    }
}
export const configured = databaseConfigured;
export function configuration() {
    if (!configured())
        throw new ApiError("Account services are not connected in this environment.", 503);
}
export async function backend(path: string, options: RequestInit = {}, userId?: string, adminScope?: string): Promise<any> {
    configuration();
    try {
        return await postgresBackend(path, options, userId, adminScope);
    }
    catch (error) {
        const e = error as {
            code?: string;
            message?: string;
        };
        const message = e.message || "";
        if (e.code === "23505")
            throw new ApiError("That booking link or contact is already in use.", 409);
        if (e.code === "23P01" || message.includes("slot_unavailable"))
            throw new ApiError("That time was just booked. Please choose another.", 409);
        if (message.includes("rate_limit"))
            throw new ApiError("Too many requests. Please wait and try again.", 429);
        if (e.code === "42501" || message.includes("permission_denied"))
            throw new ApiError("This request is not allowed.", 403);
        if (message.includes("not_found"))
            throw new ApiError("This booking page is unavailable.", 404);
        if (e.code?.startsWith("23") || message.includes("invalid_"))
            throw new ApiError("We could not save that change. Check your details and try again.");
        throw new ApiError("Account services are temporarily unavailable. Please try again.", 503);
    }
}
export async function session() {
    configuration();
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current)
        throw new ApiError("Please sign in to continue.", 401);
    return { token: current.user.id, user: current.user };
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
    if (raw.length > 16384)
        throw new ApiError("This request is too large.", 413);
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
            throw new Error();
        return parsed as Record<string, unknown>;
    }
    catch {
        throw new ApiError("Invalid request.");
    }
}
export function string(value: unknown, name: string, max = 200, min = 1) {
    if (typeof value !== "string" ||
        value.trim().length < min ||
        value.trim().length > max)
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
    if (typeof value !== "string" ||
        value.length < min ||
        value.length > 128 ||
        !value.trim())
        throw new ApiError(`Please enter a password with ${min === 1 ? "at least one" : `at least ${min}`} character${min === 1 ? "" : "s"}.`);
    return value;
}
export function slug(value: unknown) {
    const result = string(value, "booking link", 60, 3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result))
        throw new ApiError("Use lowercase letters, numbers, and hyphens for your link.");
    return result;
}
export function integer(value: unknown, name: string, min: number, max: number) {
    if (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < min ||
        value > max)
        throw new ApiError(`Please enter a valid ${name}.`);
    return value;
}
export function uuid(value: unknown) {
    const result = string(value, "record ID", 36);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result))
        throw new ApiError("Invalid record.");
    return result;
}
export function failure(error: unknown) {
    if (error instanceof ApiError)
        return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    console.error("Zenvio request failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
