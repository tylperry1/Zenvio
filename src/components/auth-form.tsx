"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
import type { LaunchControls } from "@/lib/launch-controls";

const REFERRAL_STORAGE_KEY = "zenvio_referral_code";

function PasswordField({
  name,
  label,
  autoComplete,
  placeholder,
  minLength,
}: {
  name: string;
  label: string;
  autoComplete: string;
  placeholder: string;
  minLength: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="auth-password">
      {label}
      <input
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={128}
        required
      />
      <button
        type="button"
        className="auth-password-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={16} />
      </button>
    </label>
  );
}

export function SignupUnavailable({
  invitationOnly,
  waitlistEnabled,
  maintenance,
}: Pick<LaunchControls, "invitationOnly" | "waitlistEnabled" | "maintenance">) {
  const title = maintenance
    ? "Registration is temporarily unavailable."
    : invitationOnly
      ? "Registration is by invitation right now."
      : "Public registration is paused.";
  const detail = maintenance
    ? "Zenvio is undergoing scheduled maintenance. Existing members can still sign in."
    : invitationOnly
      ? "New workspaces open with a team invitation or when public registration is turned on. Existing members can sign in anytime."
      : "New workspace creation is turned off. Existing members can still sign in, and team invitations still work.";
  return (
    <main className="auth-layout auth-layout-register">
      <section className="auth-main">
        <Link className="auth-back" href="/">
          ← Back to Zenvio
        </Link>
        <div className="auth-box">
          <div className="auth-brand">
            <Link href="/" aria-label="Zenvio home">
              <Logo />
            </Link>
          </div>
          <p className="eyebrow">WORKSPACE ACCESS</p>
          <h1>{title}</h1>
          <p>{detail}</p>
          <p className="auth-switch">
            Already have a workspace? <Link href="/sign-in">Sign in</Link>
          </p>
          {waitlistEnabled && (
            <p className="auth-switch">
              Want a reminder when access opens?{" "}
              <Link href="/early-access">Join the interest list</Link>
            </p>
          )}
          <p className="legal-note">
            Have a team invitation? Open the private link from your email. It still works while public signup is off.
          </p>
        </div>
      </section>
    </main>
  );
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" | "reset" }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [recover, setRecover] = useState(false),
    [token, setToken] = useState(""),
    [referralCode, setReferralCode] = useState(""),
    [accounts, setAccounts] = useState<boolean | null>(null),
    [signupOpen, setSignupOpen] = useState(false);
  const registerLayout = mode === "sign-up";
  useEffect(() => {
    if (mode === "reset") {
      const params = new URLSearchParams(window.location.search);
      setToken(params.get("token") || "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);
  useEffect(() => {
    if (mode !== "sign-up") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("ref") || params.get("referral") || "").trim();
    if (fromQuery) setReferralCode(fromQuery);
    try {
      if (fromQuery) {
        sessionStorage.setItem(REFERRAL_STORAGE_KEY, fromQuery);
        return;
      }
      const stored = sessionStorage.getItem(REFERRAL_STORAGE_KEY) || "";
      if (stored) setReferralCode(stored);
    } catch {
      /* persistence is optional; query attribution still applies above */
    }
  }, [mode]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "sign-up" && String(form.get("password")) !== String(form.get("confirmPassword")))
        throw new Error("Passwords do not match.");
      const code =
        mode === "sign-up"
          ? String(form.get("referralCode") || referralCode || "").trim()
          : "";
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: recover ? "recover" : mode,
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name"),
          token,
          ...(code ? { referralCode: code } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (mode === "sign-up") {
        try {
          sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
      if (data.message) setMessage(data.message);
      else {
        const params=new URLSearchParams(window.location.search);
        const plan=params.get("plan"), seats=Number(params.get("seats"));
        const selectedPackage=plan==="individual"||plan==="team";
        const billingQuery=new URLSearchParams(selectedPackage?{plan}:{});
        if(plan==="team"&&Number.isInteger(seats)&&seats>=3&&seats<=1000)billingQuery.set("seats",String(seats));
        window.location.assign(data.redirectTo==="/admin"?"/admin":selectedPackage?"/app/billing?"+billingQuery.toString():"/app");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setAccounts(d.accounts === true);
        setSignupOpen(d.signupOpen === true);
      })
      .catch(() => setAccounts(false));
  }, []);
  const title = recover
    ? "A fresh start."
    : mode === "sign-up"
      ? "Start building a better business with Zenvio."
      : mode === "reset"
        ? "Your new password."
        : "Good to see you again.";
  const description = recover
    ? "Enter your email and we’ll send a reset link."
    : mode === "sign-up"
      ? "Everything you need to manage appointments, connect with customers, and grow your business—all in one place."
      : mode === "reset"
        ? "Choose a password with at least 12 characters."
        : "Sign in to your workspace and pick up where you left off.";
  return (
    <main className={registerLayout ? "auth-layout auth-layout-register" : "auth-layout"}>
      {!registerLayout && (
        <aside className="auth-story">
          <Link href="/">
            <Logo light />
          </Link>
          <div>
            <span className="auth-flower">✳</span>
            <h2>
              Good things,
              <br />
              on the calendar.
            </h2>
            <p>Less back-and-forth. More possibility.</p>
          </div>
          <small>CLEAR & CONNECTED</small>
        </aside>
      )}
      <section className="auth-main">
        <Link className="auth-back" href="/">
          ← Back to Zenvio
        </Link>
        <div className="auth-box">
          {registerLayout && (
            <div className="auth-brand">
              <Link href="/" aria-label="Zenvio home">
                <Logo />
              </Link>
            </div>
          )}
          <p className="eyebrow">
            {mode === "sign-up"
              ? referralCode
                ? "PARTNER INVITE"
                : "CREATE YOUR WORKSPACE"
              : "YOUR TIME, TOGETHER"}
          </p>
          <h1>{title}</h1>
          <p>{description}</p>
          {accounts === false && (
            <p className="notice" role="status">
              Zenvio is getting ready for real accounts. Registration and
              sign-in will open once account services are connected. You can
              explore the complete interactive demo below.
            </p>
          )}
          {mode === "sign-up" && referralCode && (
            <p id="referral-detected" className="notice" role="status">
              You’re joining with a partner referral. We’ll credit the business that invited you when this account is created.
            </p>
          )}
          <form onSubmit={submit}>
            {mode === "sign-up" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Jamie Davis"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Business email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourbusiness.com"
                  required
                  maxLength={254}
                />
              </label>
            )}
            {!recover && (
              <PasswordField
                name="password"
                label="Password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                placeholder={mode === "sign-in" ? "Your password" : "At least 12 characters"}
                minLength={mode === "sign-in" ? 1 : 12}
              />
            )}
            {mode === "sign-up" && (
              <PasswordField
                name="confirmPassword"
                label="Confirm password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                minLength={12}
              />
            )}
            {mode === "sign-up" && (
              <label>
                Referral code <span className="muted">(optional)</span>
                <input
                  name="referralCode"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  autoComplete="off"
                  placeholder="Friend’s or partner’s code"
                  maxLength={40}
                  aria-describedby={referralCode ? "referral-detected" : undefined}
                />
              </label>
            )}
            {mode === "sign-in" && !recover && (
              <button
                type="button"
                className="inline-link forgot"
                onClick={() => {
                  setRecover(true);
                  setError("");
                  setMessage("");
                }}
              >
                Forgot your password?
              </button>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="notice success" role="status">
                {message}
              </p>
            )}
            <button
              className="button primary full"
              disabled={
                busy || accounts !== true || (mode === "reset" && !token)
              }
            >
              {busy
                ? "One moment…"
                : recover
                  ? "Send reset link"
                  : mode === "sign-up"
                    ? "Create account"
                    : mode === "reset"
                      ? "Update password"
                      : "Sign in"}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          {mode === "reset" && !token && (
            <p className="notice">
              Open the password reset link from your email. If it has expired,
              request a new one from the sign-in page.
            </p>
          )}
          <p className="auth-switch">
            {recover ? (
              <button
                className="inline-link"
                onClick={() => {
                  setRecover(false);
                  setMessage("");
                  setError("");
                }}
              >
                Back to sign in
              </button>
            ) : mode === "sign-up" ? (
              <>
                Already have a workspace? <Link href="/sign-in">Log in</Link>
              </>
            ) : (
              <>
                New around here?{" "}
                <Link href={signupOpen ? "/sign-up" : "/early-access"}>
                  {signupOpen ? "Create an account" : "Join the interest list"}
                </Link>
              </>
            )}
          </p>
          <div className="auth-divider">
            <span>Want to have a look first?</span>
          </div>
          <Link href="/demo" className="button secondary full">
            Explore the interactive demo
          </Link>
          {mode === "sign-up" && (
            <p className="legal-note">
              By creating an account, you agree to our{" "}
              <Link href="/terms">Terms</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
