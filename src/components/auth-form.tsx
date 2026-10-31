"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" | "reset" }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [recover, setRecover] = useState(false),
    [token, setToken] = useState(""),
    [accounts, setAccounts] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode === "reset") {
      const params = new URLSearchParams(window.location.search);
      setToken(params.get("token") || "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: recover ? "recover" : mode,
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name"),
          token,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
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
      .then((d) => setAccounts(d.accounts === true))
      .catch(() => setAccounts(false));
  }, []);
  const title = recover
    ? "A fresh start."
    : mode === "sign-up"
      ? "Create your workspace."
      : mode === "reset"
        ? "Your new password."
        : "Good to see you again.";
  return (
    <main className="auth-layout">
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
      <section className="auth-main">
        <Link className="auth-back" href="/">
          ← Back to Zenvio
        </Link>
        <div className="auth-box">
          <p className="eyebrow">
            {mode === "sign-up"
              ? "A LITTLE MORE POSSIBILITY"
              : "YOUR TIME, TOGETHER"}
          </p>
          <h1>{title}</h1>
          <p>
            {recover
              ? "Enter your email and we’ll send a reset link."
              : mode === "sign-up"
                ? "Create your free workspace. No credit card needed."
                : mode === "reset"
                  ? "Choose a password with at least 12 characters."
                  : "Sign in to your workspace and pick up where you left off."}
          </p>
          {accounts === false && (
            <p className="notice" role="status">
              Zenvio is getting ready for real accounts. Registration and
              sign-in will open once account services are connected. You can
              explore the complete interactive demo below.
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
                Email address
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
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "sign-in"
                      ? "Your password"
                      : "At least 12 characters"
                  }
                  minLength={mode === "sign-in" ? 1 : 12}
                  maxLength={128}
                  required
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
                    ? "Create my workspace"
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
                New around here? <Link href="/early-access">Join early access</Link>
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

