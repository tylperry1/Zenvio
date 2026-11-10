"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Logo } from "./icons";

type Invitation = { email: string; mode: "register" | "sign-in" | "accept" };

async function submit(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to continue. Please try again.");
  return data;
}

export function TeamInvitation() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const secret = new URLSearchParams(location.hash.slice(1)).get("token");
    if (!secret) {
      setError("This invitation link is incomplete. Ask your team to send a new link.");
      return;
    }
    let active = true;
    setToken(secret);
    submit("/api/teams", { action: "inspect-invite", token: secret })
      .then((data) => { if (active) setInvitation(data); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation || busy) return;
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    setBusy(true);
    setError("");
    try {
      if (invitation.mode === "register") {
        await submit("/api/teams", { action: "register-invite", token, name: form.get("name"), password });
        setJoined(true);
        setInvitation({ ...invitation, mode: "sign-in" });
      }
      if (invitation.mode !== "accept")
        await submit("/api/auth", { action: "sign-in", email: invitation.email, password });
      if (invitation.mode !== "register" && !joined)
        await submit("/api/teams", { action: "accept", token });
      location.replace("/app/team");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-page tb-page">
      <main>
        <Logo />
        <h1>{joined ? "Sign in to your new account" : "Join your team"}</h1>
        {error && <p role="alert">{error}</p>}
        {!invitation && !error && <p role="status">Checking your invitation…</p>}
        {invitation && (
          <section>
            <p>
              {joined ? "Your account is set up and you’ve joined the team."
                : invitation.mode === "register" ? "Set up your Zenvio account to accept your invitation."
                : invitation.mode === "sign-in" ? "Sign in with your existing Zenvio password to join."
                : "You’re signed in with the invited email address."}
            </p>
            <form className="stack-form" onSubmit={join}>
              {invitation.mode === "register" && (
                <label>
                  Your name
                  <input name="name" autoComplete="name" required minLength={2} maxLength={100} />
                </label>
              )}
              <label>
                Invited email
                <input name="email" type="email" autoComplete="username" value={invitation.email} readOnly />
              </label>
              {invitation.mode !== "accept" && (
                <label>
                  {invitation.mode === "register" ? "Create a password" : "Password"}
                  <input
                    key={invitation.mode}
                    name="password"
                    type="password"
                    autoComplete={invitation.mode === "register" ? "new-password" : "current-password"}
                    minLength={invitation.mode === "register" ? 12 : 1}
                    maxLength={128}
                    required
                  />
                  {invitation.mode === "register" && <small>Use at least 12 characters.</small>}
                </label>
              )}
              {invitation.mode === "register" && (
                <p>By creating an account, you agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
              )}
              <button type="submit" disabled={busy}>
                {busy ? "Joining…" : invitation.mode === "register" ? "Create account and join"
                  : invitation.mode === "sign-in" ? joined ? "Sign in" : "Sign in and join" : "Accept invitation"}
              </button>
              {invitation.mode === "sign-in" && <a href="/sign-in" target="_blank" rel="noreferrer">Need to reset your password?</a>}
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
