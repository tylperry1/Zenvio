// Scripted stand-in for the Anthropic Messages streaming API, for tests and local runs only.
// Point the app at it with ANTHROPIC_BASE_URL=http://127.0.0.1:4010 and any ANTHROPIC_API_KEY.
//
// Script:
//   "TEST <tool> <json>"  -> calls that tool with that input, then echoes the tool result.
//   booking link to <name> -> search_clients, then send_booking_link for the first match.
//   appointments           -> list_appointments, then summarizes the count.
//   anything else          -> a short text reply.
import http from "node:http";

export function startMockAnthropic(port = Number(process.env.MOCK_ANTHROPIC_PORT || 4010)) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(requests));
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404);
      return res.end();
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, headers: { beta: req.headers["anthropic-beta"] }, body });
    if (requests.length > 500) requests.shift();
    let plan;
    try {
      plan = respond(body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(error) } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send("message_start", {
      message: {
        id: "msg_mock_" + requests.length,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });
    plan.blocks.forEach((block, index) => {
      if (block.type === "text") {
        send("content_block_start", { index, content_block: { type: "text", text: "" } });
        for (const piece of block.text.match(/.{1,24}/gs) || [""])
          send("content_block_delta", { index, delta: { type: "text_delta", text: piece } });
      } else {
        send("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
        send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      }
      send("content_block_stop", { index });
    });
    send("message_delta", { delta: { stop_reason: plan.stop, stop_sequence: null }, usage: { output_tokens: 40 } });
    send("message_stop", {});
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ server, requests, close: () => new Promise((r) => server.close(r)) })),
  );
}

let toolCounter = 0;
const tool = (name, input) => ({ blocks: [{ type: "tool_use", id: "toolu_mock_" + ++toolCounter, name, input }], stop: "tool_use" });
const text = (t) => ({ blocks: [{ type: "text", text: t }], stop: "end_turn" });

function respond(body) {
  const messages = body.messages;
  const last = messages[messages.length - 1];
  const firstUser = [...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  const prompt = typeof firstUser?.content === "string" ? firstUser.content : "";
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
    const result = last.content.find((b) => b.type === "tool_result");
    const previous = messages[messages.length - 2].content.find((b) => b.type === "tool_use");
    const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    if (previous?.name === "search_clients" && /booking link/i.test(prompt)) {
      const match = content.match(/"client_id":"([0-9a-f-]{36})"/);
      if (match) return tool("send_booking_link", { client_id: match[1], channel: "email" });
      return text("I couldn’t find that client. Check the name and try again.");
    }
    if (previous?.name === "send_booking_link" && !result.is_error)
      return text("I’ve prepared the booking link email. Review the card below and approve it to send.");
    if (previous?.name === "list_appointments" && !result.is_error) {
      const count = (content.match(/"appointment_id"/g) || []).length;
      return text(count ? `You have **${count}** appointment${count === 1 ? "" : "s"} in that range.` : "You have no appointments in that range.");
    }
    return text(`RESULT${result.is_error ? " ERROR" : ""}: ${content.slice(0, 3000)}`);
  }
  const scripted = prompt.match(/TEST (\w+) (\{[^\n]*\})/);
  if (scripted) return tool(scripted[1], JSON.parse(scripted[2]));
  const link = prompt.match(/booking link to (\w+)/i);
  if (link) return tool("search_clients", { query: link[1] });
  if (/appointments/i.test(prompt)) return tool("list_appointments", { status: "upcoming" });
  return text("Hi! I can look up your schedule, clients and documents, and prepare messages for you to approve.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = await startMockAnthropic();
  console.log("Mock Anthropic API listening on", server.address());
}
