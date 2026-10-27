import { createHash, randomBytes } from "node:crypto";
export const documentHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const signingToken = () => randomBytes(32).toString("hex");
export const signingConsent = "I have reviewed this document and agree to its terms. I consent to use my typed name as my electronic signature.";
export function signingReceipt(document: { id: string; content_hash: string; recipient_email: string }, name: string, at: string) {
  return documentHash(JSON.stringify({ documentId: document.id, contentHash: document.content_hash, recipientEmail: document.recipient_email, signatureName: name, signedAt: at, consent: signingConsent }));
}
export function signedText(document: Record<string, any>) {
  return `${document.title}\n\n${document.content}\n\n--- SIGNING RECORD ---\nDocument: ${document.id}\nRecipient: ${document.recipient_name} <${document.recipient_email}>\nStatus: ${document.status}\nSignature: ${document.signature_name || "Not signed"}\nSigned at (UTC): ${document.signed_at ? new Date(document.signed_at).toISOString() : "Not signed"}\nConsent statement: ${signingConsent}\nDocument SHA-256: ${document.content_hash}\nReceipt SHA-256: ${document.receipt_hash || "Not signed"}\n\nIdentity method: possession of a private signing link and self-attested typed name. Email ownership and government identity were not independently verified.\n`;
}
