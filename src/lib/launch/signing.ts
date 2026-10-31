import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { ApiError } from "../server";
import { queueEnvelopeInvitation } from "../document-delivery";
import { unsealSecret } from "../platform-settings";
export async function assertSignerTurn(db: PoolClient, envelope: {
    id: string;
    signing_mode?: string;
}, recipient: {
    signing_order?: number;
}) {
    if (envelope.signing_mode !== "sequential")
        return;
    const previous = await db.query("select 1 from private.signature_recipients where envelope_id=$1 and signing_order<$2 and status<>'signed' limit 1", [envelope.id, recipient.signing_order || 1]);
    if (previous.rowCount)
        throw new ApiError("An earlier recipient must sign before this document is available to you.", 409);
}
export async function drawnSignature(value: unknown) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value !== "string" || !value.startsWith("data:image/png;base64,") || value.length > 12000)
        throw new ApiError("Use a PNG signature smaller than 8 KB.");
    const raw = Buffer.from(value.slice(22), "base64");
    if (!raw.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
        throw new ApiError("Invalid PNG signature.");
    try {
        const image = sharp(raw, { limitInputPixels: 1000000, animated: false }), meta = await image.metadata();
        if (meta.format !== "png" || !meta.width || !meta.height || meta.width > 1200 || meta.height > 500)
            throw Error();
        const bytes = await image.resize(600, 200, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
        if (bytes.length > 20000)
            throw Error();
        return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
    }
    catch {
        throw new ApiError("This drawn signature could not be processed.");
    }
}
export async function queueNextSigner(db: PoolClient, envelope: any) {
    if (envelope.signing_mode !== "sequential" || !envelope.email_delivery_enabled)
        return;
    const next = (await db.query("select * from private.signature_recipients where envelope_id=$1 and status in ('pending','viewed') order by signing_order,id limit 1", [envelope.id])).rows[0];
    if (next?.link_ciphertext)
        await queueEnvelopeInvitation(db, envelope, next, unsealSecret(next.link_ciphertext), "routing");
}
/** Identity adapter contract: private-link possession is self-attestation, never government verification. */
export type IdentityVerification = {
    provider: string;
    state: "not_started" | "pending" | "verified" | "failed";
    verifiedAt: string | null;
    evidenceId: string | null;
};
export interface IdentityProvider {
    id: string;
    start(input: {
        userId: string;
        recipientId: string;
    }): Promise<{
        url: string;
        reference: string;
    }>;
    verifyWebhook(raw: string, headers: Headers): Promise<IdentityVerification>;
}
export const defaultIdentityVerification: IdentityVerification = { provider: "private_link", state: "not_started", verifiedAt: null, evidenceId: null };
