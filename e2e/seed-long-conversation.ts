import { Database } from "bun:sqlite";

/**
 * Run with bun while the test host is stopped: appends turns of a question and a three-line answer to a conversation,
 * each answer streamed a word at a time, as agents do.
 */
const [databasePath, conversationId, turns] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number | null };
const insert = db.prepare("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
const start = Date.now() - 3_600_000;

const events = Array.from({ length: Number(turns) }, (_, turn) => [
  { type: "user-message", text: `question ${turn}` },
  ...`answer ${turn}\n\nsecond line\n\nthird line`.match(/\S+\s*/g)!.map((word) => ({
    type: "acp",
    update: { sessionUpdate: "agent_message_chunk", messageId: `answer-${turn}`, content: { type: "text", text: word } },
  })),
  { type: "turn-end", stopReason: "end_turn" },
]).flat();

db.transaction(() => events.forEach((event, index) => insert.run(conversationId!, (lastSeq ?? 0) + index + 1, start + index * 1000, JSON.stringify(event))))();
