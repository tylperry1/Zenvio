import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "./db";
import { sendAccountMail, mailReady } from "./mail";
let auth: ReturnType<typeof createAuth> | undefined;
export const mailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
function createAuth() {
  return betterAuth({
    appName: "Zenvio",
    database: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL:
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: mailConfigured(),
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAccountMail(user.email, "Reset your Zenvio password", url),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        if (await mailReady())
          await sendAccountMail(user.email, "Verify your Zenvio email", url);
      },
    },
    advanced: { database: { generateId: "uuid" } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
    plugins: [nextCookies()],
  });
}
export function getAuth() {
  return (auth ??= createAuth());
}
