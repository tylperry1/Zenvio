import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "./db";
let auth: ReturnType<typeof createAuth> | undefined;
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
async function sendMail(email: string, subject: string, url: string) {
    if (!mailConfigured())
        throw new Error("Account email delivery is not connected.");
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: email, subject, text: `${subject}\n\nOpen this link to continue:\n${url}\n\nIf you did not request this, ignore this email.` }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok)
        throw new Error("Account email could not be delivered.");
}
function createAuth() {
    return betterAuth({
        appName: "Zenvio", database: getPool(), secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: mailConfigured(),
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, url }) => sendMail(user.email, "Reset your Zenvio password", url) },
        emailVerification: { sendOnSignUp: mailConfigured(), autoSignInAfterVerification: false,
            sendVerificationEmail: async ({ user, url }) => sendMail(user.email, "Verify your Zenvio email", url) },
        advanced: { database: { generateId: "uuid" } },
        session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
        rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
        plugins: [nextCookies()]
    });
}
export function getAuth() { return auth ??= createAuth(); }
