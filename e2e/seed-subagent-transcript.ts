import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Run with bun: writes Claude Code's transcript of the background subagent that seed-subagents.ts starts ("Watch the
 * build"), where the host reads what it spent, beside the transcript of another subagent that must not count.
 */
const [databasePath, conversationId, claudeConfigDir] = process.argv.slice(2);
const db = new Database(databasePath!, { readonly: true });
const { acp_session_id: sessionId } = db.query("SELECT acp_session_id FROM conversations WHERE id = ?").get(conversationId!) as { acp_session_id: string | null };
if (!sessionId) throw new Error(`conversation ${conversationId} has no agent session`);
const subagents = join(claudeConfigDir!, "projects", "-e2e-project", sessionId, "subagents");
mkdirSync(subagents, { recursive: true });

const answer = (id: string, usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", isSidechain: true, message: { id, model: "claude-sonnet-4-5-20250929", usage } });

writeFileSync(join(subagents, "agent-a1b2c3.meta.json"), JSON.stringify({ agentType: "general-purpose", toolUseId: "toolu_watch" }));
writeFileSync(
  join(subagents, "agent-a1b2c3.jsonl"),
  [
    answer("msg_1", { input_tokens: 3, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 1_000_000, output_tokens: 5 }),
    answer("msg_1", { input_tokens: 3, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_200 }),
    answer("msg_2", { input_tokens: 2, cache_creation_input_tokens: 5_000, cache_read_input_tokens: 1_200_000, output_tokens: 2_300 }),
  ].join("\n") + "\n",
);
writeFileSync(join(subagents, "agent-ffffff.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "toolu_somewhere_else" }));
writeFileSync(join(subagents, "agent-ffffff.jsonl"), answer("msg_9", { input_tokens: 9_000_000, output_tokens: 9_000_000 }) + "\n");
