import { Database } from "bun:sqlite";

/**
 * Run with bun while the test host is stopped: appends two finished turns to a conversation, the first having worked
 * the given minutes and edited the given files, the second a few seconds.
 */
const [databasePath, conversationId, minutes, filesEdited] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number | null };
const insert = db.prepare("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
const workedMs = Number(minutes) * 60_000;
const longTurnEndedAt = Date.now() - 600_000;
const reply = (messageId: string, text: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } });

const events = [
  { at: longTurnEndedAt - workedMs, event: { type: "user-message", text: "refactor the checkout" } },
  { at: longTurnEndedAt - 1000, event: reply("long", "The checkout is refactored.") },
  { at: longTurnEndedAt, event: { type: "turn-end", stopReason: "end_turn", startedAt: longTurnEndedAt - workedMs, filesEdited: Number(filesEdited) } },
  { at: longTurnEndedAt + 60_000, event: { type: "user-message", text: "thanks" } },
  { at: longTurnEndedAt + 63_000, event: reply("short", "You're welcome.") },
  { at: longTurnEndedAt + 64_000, event: { type: "turn-end", stopReason: "end_turn", startedAt: longTurnEndedAt + 60_000 } },
];

db.transaction(() => events.forEach(({ at, event }, index) => insert.run(conversationId!, (lastSeq ?? 0) + index + 1, at, JSON.stringify(event))))();
