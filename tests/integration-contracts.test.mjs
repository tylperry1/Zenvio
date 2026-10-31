import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/integration-contracts.ts", import.meta.url),
  "utf8",
);

test("shared integration contracts expose the required stable surfaces", () => {
  for (const name of [
    "MessagingThread",
    "MessageRecord",
    "MessageDeliveryState",
    "SendMessageRequest",
    "BookingLinkShareRequest",
    "CommunicationTemplate",
    "ContactConsent",
    "ProviderConnectionHealth",
    "AiAppointmentQuery",
    "AiCrmSummary",
    "AiDocumentStatus",
    "AiActionProposal",
    "AiActionConfirmationRequest",
    "AiActionExecutionResult",
  ]) assert.match(source, new RegExp(`export type ${name}\\b`));
});

test("contract documentation makes tenant and AI execution boundaries explicit", async () => {
  const docs = await readFile(
    new URL("../docs/INTEGRATION-CONTRACTS.md", import.meta.url),
    "utf8",
  );
  assert.match(docs, /derived from the authenticated Better Auth session/i);
  assert.match(docs, /STOP immediately overrides/i);
  assert.match(docs, /two-step proposal and confirmation/i);
  assert.match(docs, /Provider callbacks.*provider signatures/i);
});
