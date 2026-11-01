import { Database } from "bun:sqlite";

/** Run with bun while the test host is stopped: appends working turns of a question, shell calls with 40-line outputs, and an answer. */
const [databasePath, conversationId, turns, toolsPerTurn] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number | null };
const insert = db.prepare("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
const start = Date.now() - 3_600_000;
const outputLine = (turn: number, tool: number, line: number) => `src/module-${turn}/file-${tool}.ts:${line}: export const value${line} = computeSomething(theInput, otherParameter);`;
const update = (update: Record<string, unknown>) => ({ type: "acp", update });

const events = Array.from({ length: Number(turns) }, (_, turn) => [
  { type: "user-message", text: `Please refactor the module ${turn} and check every reference before you change the exported names.` },
  ...Array.from({ length: Number(toolsPerTurn) }, (_, tool) => {
    const id = `toolu_${turn}_${tool}`;
    return [
      update({ sessionUpdate: "tool_call", toolCallId: id, title: `grep -rn value src/module-${turn}`, kind: "execute", status: "pending", rawInput: { command: `grep -rn value src/module-${turn}`, description: "Find the references" } }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: Array.from({ length: 40 }, (_, line) => outputLine(turn, tool, line)).join("\n") } }],
      }),
    ];
  }).flat(),
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `I refactored module ${turn}. ${"Every reference was checked before the exported names changed. ".repeat(12)}` } }),
  { type: "turn-end", stopReason: "end_turn" },
]).flat();

db.transaction(() => events.forEach((event, index) => insert.run(conversationId!, (lastSeq ?? 0) + index + 1, start + index * 1000, JSON.stringify(event))))();
