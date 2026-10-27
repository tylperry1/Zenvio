"use client";
import { useState } from "react";
export function ProfilePhoto({ host }: { host: string }) {
  const [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 2000000) throw Error("Choose a photo under 2 MB.");
      const r = await fetch("/api/profile/photo", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setFailed(false);
      setRevision(Date.now());
      setMessage("Profile photo updated successfully.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ padding: "20px 0" }}>
      <h3>Your profile photo</h3>
      {!failed && (
        <img
          src={`/api/profile/photo?host=${encodeURIComponent(host)}&v=${revision}`}
          alt="Your booking profile"
          width={80}
          height={80}
          style={{ borderRadius: "50%", objectFit: "cover" }}
          onError={() => setFailed(true)}
        />
      )}
      <label style={{ display: "block" }}>
        Upload a photo (JPEG, PNG, or WebP; up to 2 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/profile/photo", { method: "DELETE" });
            if (!r.ok) throw Error("Unable to remove photo.");
            setFailed(true);
            setMessage("Profile photo removed successfully.");
          } catch (e) {
            setMessage(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Remove photo
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function PublicPhoto({ host, name }: { host: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <>
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </>
  ) : (
    <img
      src={`/api/profile/photo?host=${encodeURIComponent(host)}`}
      alt=""
      width={112}
      height={112}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        borderRadius: "inherit",
      }}
      onError={() => setFailed(true)}
    />
  );
}
