import {
  createHash,
  timingSafeEqual,
  createPublicKey,
  verify,
  type JsonWebKey,
} from "node:crypto";
const issuer = "https://token.actions.githubusercontent.com";
const repository = "tylperry1/Zenvio",
  repositoryId = "1433734869",
  ownerId = "222509539";
const workflow =
  repository + "/.github/workflows/scheduled-jobs.yml@refs/heads/main";
let cached:
  | {
      until: number;
      keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[];
    }
  | undefined;
let pending: Promise<NonNullable<typeof cached>> | undefined;
async function publicKeys() {
  if (cached && cached.until > Date.now()) return cached.keys;
  pending ??= (async () => {
    const r = await fetch(issuer + "/.well-known/jwks", {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!r.ok) throw Error("Identity provider unavailable");
    const data = await r.json();
    if (!Array.isArray(data.keys) || data.keys.length > 30)
      throw Error("Invalid identity key set");
    cached = { until: Date.now() + 300000, keys: data.keys };
    return cached;
  })();
  try {
    return (await pending).keys;
  } finally {
    pending = undefined;
  }
}
export async function jobsAuthorized(authorization: string | null) {
  const cron = process.env.CRON_SECRET;
  if (
    cron &&
    authorization &&
    timingSafeEqual(
      createHash("sha256").update(authorization).digest(),
      createHash("sha256")
        .update("Bearer " + cron)
        .digest(),
    )
  )
    return true;
  if (
    process.env.JOB_SCHEDULER_PROVIDER !== "github-actions" ||
    !authorization?.startsWith("Bearer ")
  )
    return false;
  try {
    const token = authorization.slice(7);
    if (token.length > 16000) return false;
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))
    )
      return false;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()),
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (
      header.alg !== "RS256" ||
      header.typ !== "JWT" ||
      typeof header.kid !== "string" ||
      header.crit ||
      header.jku ||
      header.jwk
    )
      return false;
    const now = Math.floor(Date.now() / 1000);
    const subject = [
      "repo:" + repository + ":ref:refs/heads/main",
      "repo:tylperry1@" +
        ownerId +
        "/Zenvio@" +
        repositoryId +
        ":ref:refs/heads/main",
    ];
    if (
      claims.iss !== issuer ||
      claims.aud !== "https://gozenvio.com/api/jobs" ||
      !subject.includes(claims.sub) ||
      claims.repository !== repository ||
      String(claims.repository_id) !== repositoryId ||
      String(claims.repository_owner_id) !== ownerId ||
      claims.ref !== "refs/heads/main" ||
      claims.workflow_ref !== workflow ||
      !["schedule", "workflow_dispatch"].includes(claims.event_name) ||
      claims.runner_environment !== "github-hosted" ||
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat) ||
      !Number.isFinite(claims.nbf) ||
      claims.exp <= now ||
      claims.iat > now + 30 ||
      claims.iat < now - 600 ||
      claims.nbf > now + 30 ||
      claims.exp - claims.iat > 600
    )
      return false;
    const key = (await publicKeys()).find(
      (k) =>
        k.kid === header.kid &&
        k.kty === "RSA" &&
        (!k.alg || k.alg === "RS256") &&
        (!k.use || k.use === "sig"),
    );
    return (
      !!key &&
      verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    );
  } catch {
    return false;
  }
}
