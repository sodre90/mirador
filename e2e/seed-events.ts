import { Database } from "bun:sqlite";

/** Run with bun while the test host is stopped: appends the events, given as a JSON array, to a conversation. */
const [databasePath, conversationId, eventsJson] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number | null };
const insert = db.prepare("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
const events = JSON.parse(eventsJson!) as unknown[];
db.transaction(() => events.forEach((event, index) => insert.run(conversationId!, (lastSeq ?? 0) + index + 1, Date.now(), JSON.stringify(event))))();
