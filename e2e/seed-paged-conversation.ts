import { Database } from "bun:sqlite";

/**
 * Run with bun while the test host is stopped: appends turns of a question, a search whose raw output is as long as
 * `rawOutputSize`, as Claude Code reports a tool's output again there, and a reply. Turns are numbered with two digits.
 */
const [databasePath, conversationId, turns, rawOutputSize] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number | null };
const insert = db.prepare("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
const start = Date.now() - 3_600_000;

const events = Array.from({ length: Number(turns) }, (_, turn) => {
  const number = String(turn).padStart(2, "0");
  return [
    { type: "user-message", text: `question ${number}` },
    {
      type: "acp",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `grep-${number}`,
        title: `Grep needle ${number}`,
        kind: "search",
        status: "completed",
        rawInput: { pattern: `needle ${number}` },
        content: [{ type: "content", content: { type: "text", text: `found ${number}` } }],
        rawOutput: { output: `raw listing ${number}: ${"file ".repeat(Number(rawOutputSize) / 5)}` },
        _meta: { claudeCode: { toolName: "Grep" } },
      },
    },
    { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `reply ${number}` } } },
    { type: "turn-end", stopReason: "end_turn" },
  ];
}).flat();

db.transaction(() => events.forEach((event, index) => insert.run(conversationId!, (lastSeq ?? 0) + index + 1, start + index * 1000, JSON.stringify(event))))();
