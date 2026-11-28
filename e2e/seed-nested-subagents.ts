import { Database } from "bun:sqlite";

/**
 * Run with bun while the test host is stopped: appends to a conversation a turn, still open, in which a subagent
 * Claude Code started has started a subagent of its own, as claude-agent-acp reports them.
 */
const [databasePath, conversationId] = process.argv.slice(2);
const db = new Database(databasePath!);
const { seq: lastSeq } = db.query("SELECT max(seq) AS seq FROM events WHERE conversation_id = ?").get(conversationId!) as { seq: number };
const start = Date.now() - 60_000;

const update = (update: Record<string, unknown>) => ({ type: "acp", update });
const madeBy = (parentToolUseId: string, toolName?: string) => ({ claudeCode: { parentToolUseId, ...(toolName && { toolName }) } });

/** Long enough that the inner subagent's card is taller than the conversation's view. */
const testPlan = Array.from({ length: 60 }, (_, index) => `Test suite ${index + 1} passes.`).join("\n\n");

const turn: [seconds: number, event: Record<string, unknown>][] = [
  [0, { type: "user-message", text: "Review the release" }],
  [
    1,
    update({
      sessionUpdate: "tool_call",
      toolCallId: "toolu_review",
      title: "Task",
      kind: "think",
      status: "pending",
      rawInput: { description: "Review the release", prompt: "Review the release and report.", model: "sonnet" },
      _meta: { claudeCode: { toolName: "Agent" } },
    }),
  ],
  [2, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I'll have the tests run first." }, _meta: madeBy("toolu_review") })],
  [
    3,
    update({
      sessionUpdate: "tool_call",
      toolCallId: "toolu_release_tests",
      title: "Task",
      kind: "think",
      status: "pending",
      rawInput: { description: "Run the release tests", prompt: "Run every test and report.", model: "haiku" },
      _meta: madeBy("toolu_review", "Agent"),
    }),
  ],
  [5, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: testPlan }, _meta: madeBy("toolu_release_tests") })],
  [
    8,
    update({
      sessionUpdate: "tool_call",
      toolCallId: "toolu_test_run",
      title: "bun run test",
      kind: "execute",
      status: "pending",
      rawInput: { command: "bun run test" },
      _meta: madeBy("toolu_release_tests", "Bash"),
    }),
  ],
  [9, update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The release is under review." } })],
];

const insert = db.query("INSERT INTO events (conversation_id, seq, at, event) VALUES (?, ?, ?, ?)");
turn.forEach(([seconds, event], index) => insert.run(conversationId!, lastSeq + 1 + index, start + seconds * 1000, JSON.stringify(event)));
