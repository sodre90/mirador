import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";

/**
 * A Copilot that prices its models and keeps its session's usage in its own events file, as Copilot does: it offers Auto
 * and models with `_meta.copilotUsage`, and each turn appends a cumulative `session.usage_checkpoint` to
 * `$COPILOT_HOME/session-state/<session>/events.jsonl` a moment after it answers and reports context usage without a cost.
 * Turn n of a session has used the n-th of CREDITS_AFTER_TURN, in nano-AIU; on the free model it stays 0.
 */
const CREDITS_AFTER_TURN = [2_040_580_000, 5_601_050_000, 9_000_000_000];
/** Copilot writes the checkpoint a moment after it has answered the prompt. */
const CHECKPOINT_AFTER_ANSWER_MS = 300;
const copilotHome = process.env.COPILOT_HOME!;

const modelOptions = (current: string): acp.SessionConfigOption[] => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: [
      { value: "auto", name: "Auto", _meta: null },
      { value: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", _meta: { copilotUsage: "1x", copilotEnablement: "enabled", copilotPriceCategory: "medium" } },
      { value: "free-model", name: "Free Model", _meta: { copilotUsage: "0x", copilotEnablement: "enabled", copilotPriceCategory: "low" } },
      { value: "claude-opus-5.5", name: "Claude Opus 5.5", _meta: { copilotUsage: "15x", copilotEnablement: "enabled", copilotPriceCategory: "high" } },
    ],
  },
];

const turns = new Map<string, number>();
const models = new Map<string, string>();
let nextSession = 0;

const appendCheckpoint = (sessionId: string, totalNanoAiu: number, totalPremiumRequests: number) => {
  const directory = join(copilotHome, "session-state", sessionId);
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify({ type: "session.usage_checkpoint", data: { totalNanoAiu, totalPremiumRequests } })}\n`);
};

const recordUsage = (sessionId: string, turn: number) =>
  appendCheckpoint(sessionId, models.get(sessionId) === "free-model" ? 0 : CREDITS_AFTER_TURN[Math.min(turn, CREDITS_AFTER_TURN.length) - 1]!, turn);

/** A session whose events file already holds what earlier turns used, as one Mirador began reading credits for only later. */
const EARLIER_NANO_AIU = Number(process.env.FAKE_COPILOT_EARLIER_NANO_AIU ?? 0);

acp
  .agent()
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `fake-copilot-${process.pid}-${++nextSession}`;
    if (EARLIER_NANO_AIU > 0) appendCheckpoint(sessionId, EARLIER_NANO_AIU, 0);
    return { sessionId, configOptions: modelOptions("auto") };
  })
  .onRequest(acp.methods.agent.session.setConfigOption, (ctx) => {
    models.set(ctx.params.sessionId, String(ctx.params.value));
    return { configOptions: modelOptions(String(ctx.params.value)) };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const { sessionId } = ctx.params;
    const turn = (turns.get(sessionId) ?? 0) + 1;
    turns.set(sessionId, turn);
    setTimeout(() => recordUsage(sessionId, turn), CHECKPOINT_AFTER_ANSWER_MS);
    await ctx.client.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answered turn ${turn}.` } },
    });
    await ctx.client.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: "usage_update", used: 1000 * turn, size: 200_000 } });
    return { stopReason: "end_turn" as const };
  })
  .onNotification(acp.methods.agent.session.cancel, () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>));
