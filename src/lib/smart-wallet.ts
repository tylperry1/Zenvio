import { createHash, createPrivateKey, createPublicKey, sign, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JWT } from "google-auth-library";
import { PKPass } from "passkit-generator";
import sharp from "sharp";
import { getPool } from "./db";
import { integrationValue, type IntegrationKey } from "./platform-settings";
import { ApiError } from "./server";

export type WalletProvider = "apple" | "google";
type Card = { id: string; displayName: string; company: string; jobTitle: string; accent: string };

export function walletFlags() {
  return {
    apple: process.env.SMART_CARDS_APPLE_WALLET_ENABLED === "true",
    google: process.env.SMART_CARDS_GOOGLE_WALLET_ENABLED === "true",
  };
}

const providerKeys = {
  apple: ["APPLE_WALLET_PASS_TYPE_ID", "APPLE_WALLET_TEAM_ID", "APPLE_WALLET_SIGNER_CERT", "APPLE_WALLET_SIGNER_KEY", "APPLE_WALLET_WWDR_CERT"],
  google: ["GOOGLE_WALLET_CLASS_ID", "GOOGLE_WALLET_SERVICE_EMAIL", "GOOGLE_WALLET_PRIVATE_KEY"],
} satisfies Record<WalletProvider, IntegrationKey[]>;

export async function configuredWallets() {
  const flags = walletFlags();
  const keys = [...(flags.apple ? providerKeys.apple : []), ...(flags.google ? providerKeys.google : [])];
  if (!keys.length) return flags;
  const { rows } = await getPool().query("SELECT key FROM private.integration_secrets WHERE key=ANY($1::text[])", [keys]);
  const available = new Set(rows.map((row) => row.key));
  const configured = (key: IntegrationKey) => available.has(key) || Boolean(process.env[key]);
  return {
    apple: flags.apple && providerKeys.apple.every(configured),
    google: flags.google && providerKeys.google.every(configured),
  };
}

const passSerial = (id: string) => `smart-${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
const pem = (value: string) => value.trim().replaceAll("\\n", "\n");
const unavailable = () => new ApiError("This Wallet provider is temporarily unavailable.", 503);

export function walletProfileUrl(slug: string) {
  const site = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com");
  if (site.protocol !== "https:" && process.env.NODE_ENV === "production") throw unavailable();
  return new URL(`/p/${encodeURIComponent(slug)}?via=qr`, site.origin);
}

export async function appleWalletPass(card: Card, url: URL) {
  const [passTypeIdentifier, teamIdentifier, cert, key, intermediate] = await Promise.all(providerKeys.apple.map(integrationValue));
  const signerCert = pem(cert), signerKey = pem(key), wwdr = pem(intermediate);
  const certificate = new X509Certificate(signerCert);
  const authority = new X509Certificate(wwdr);
  const subject = certificate.subject.split("\n");
  const now = Date.now();
  if (!/^pass\.[a-zA-Z0-9.-]+$/.test(passTypeIdentifier) || !/^[A-Z0-9]{10}$/.test(teamIdentifier) ||
      !subject.includes(`UID=${passTypeIdentifier}`) || !subject.includes(`OU=${teamIdentifier}`) ||
      ![certificate, authority].every((item) => Date.parse(item.validFrom) <= now && Date.parse(item.validTo) > now) ||
      !authority.ca || !certificate.checkIssued(authority) || !certificate.verify(authority.publicKey) ||
      !certificate.checkPrivateKey(createPrivateKey(signerKey))) {
    throw unavailable();
  }

  const icon = await readFile(path.join(process.cwd(), "public/brand/icon-192.png"));
  const [icon1, icon2, icon3] = await Promise.all([29, 58, 87].map((size) => sharp(icon).resize(size, size).png().toBuffer()));
  const pass = new PKPass({
    "icon.png": icon1,
    "icon@2x.png": icon2,
    "icon@3x.png": icon3,
  }, { signerCert, signerKey, wwdr }, {
    passTypeIdentifier,
    teamIdentifier,
    serialNumber: passSerial(card.id),
    organizationName: "Zenvio",
    description: "Zenvio Smart Card",
    logoText: "Zenvio Smart Cards",
    backgroundColor: "rgb(21, 27, 56)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(219, 227, 255)",
  });
  pass.type = "generic";
  pass.primaryFields.push({ key: "name", label: "CONTACT", value: card.displayName });
  if (card.company) pass.secondaryFields.push({ key: "business", label: "BUSINESS", value: card.company });
  if (card.jobTitle) pass.auxiliaryFields.push({ key: "title", label: "TITLE", value: card.jobTitle });
  pass.backFields.push({ key: "profile", label: "Live profile", value: url.href });
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: url.href, messageEncoding: "utf-8" });
  return pass.getAsBuffer();
}

export function googleWalletObject(card: Card, url: URL, classId: string) {
  const localized = (value: string) => ({ defaultValue: { language: "en-US", value } });
  return {
    id: `${classId.split(".")[0]}.${passSerial(card.id)}`,
    classId,
    state: "ACTIVE",
    cardTitle: localized(card.company || "Zenvio Smart Card"),
    header: localized(card.displayName),
    ...(card.jobTitle && { subheader: localized(card.jobTitle) }),
    hexBackgroundColor: card.accent,
    barcode: { type: "QR_CODE", value: url.href },
    linksModuleData: { uris: [{ id: "profile", uri: url.href, description: "Open live profile" }] },
  };
}

export async function googleWalletSaveUrl(card: Card, url: URL) {
  const [classId, email, key] = await Promise.all(providerKeys.google.map(integrationValue));
  if (!/^\d+\.[A-Za-z0-9._-]+$/.test(classId) || !/^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(email)) throw unavailable();
  const privateKey = createPrivateKey(pem(key));
  if (privateKey.asymmetricKeyType !== "rsa" || (createPublicKey(privateKey).asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw unavailable();
  const object = googleWalletObject(card, url, classId);
  const client = new JWT({ email, key: pem(key), scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"] });
  const endpoint = "https://walletobjects.googleapis.com/walletobjects/v1/genericObject";
  const target = `${endpoint}/${encodeURIComponent(object.id)}`;
  const status = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;
  const { id, classId: objectClass, ...fields } = object;
  // Explicitly clear a previously saved job title when the owner removes it.
  const patch = { ...fields, subheader: fields.subheader ?? null };
  try {
    await client.request({ url: target, method: "PATCH", data: patch, timeout: 5000 });
  } catch (error) {
    if (status(error) !== 404) throw error;
    try {
      await client.request({ url: endpoint, method: "POST", data: { id, classId: objectClass, ...fields }, timeout: 5000 });
    } catch (createError) {
      if (status(createError) !== 409) throw createError;
      await client.request({ url: target, method: "PATCH", data: patch, timeout: 5000 });
    }
  }
  return signGoogleWalletLink(email, privateKey, url.origin, object.id);
}

export function signGoogleWalletLink(email: string, key: ReturnType<typeof createPrivateKey>, origin: string, id: string) {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const data = [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({
      iss: email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000),
      origins: [origin], payload: { genericObjects: [{ id }] },
    }),
  ].join(".");
  return `https://pay.google.com/gp/v/save/${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}
