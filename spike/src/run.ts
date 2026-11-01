import * as acp from "@agentclientprotocol/sdk";
import { spawnAgent } from "./agents";

const [agentName, waitSecondsArg = "5"] = process.argv.slice(2);
const waitSeconds = Number(waitSecondsArg);
const conversation = crypto.randomUUID().slice(0, 8);
const expectedAnswer = `nonce-${crypto.randomUUID().slice(0, 6)}`;
const canvasUrl = `http://127.0.0.1:4545/mcp/${conversation}?auto=${waitSeconds}&answer=${expectedAnswer}`;
const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);

const claudeOptions = {
  claudeCode: { options: { model: "claude-haiku-4-5-20251001", settings: { disableAllHooks: true } } },
};

const prompt =
  "Call the `ask` tool of the `canvas` MCP server exactly once, with question 'Which color should the button be?' " +
  "and two options: {label:'red', html:'<button style=\"background:red;color:white;font-size:24px\">Save</button>'} and " +
  "{label:'blue', html:'<button style=\"background:blue;color:white;font-size:24px\">Save</button>'}. " +
  "The tool waits for the user, which can take several minutes - do not retry it. " +
  "After it returns, reply with exactly the text it returned and nothing else.";

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: elapsed(), agent: agentName, event, ...details }));
}

function allowOnce(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
  const option = params.options.find((o) => o.kind === "allow_once") ?? params.options.find((o) => o.kind.startsWith("allow"));
  log("permission-requested", { title: params.toolCall.title, chose: option?.name });
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

const spFleetProvider = {
  npm: "@ai-sdk/openai-compatible",
  name: "SP fleet",
  options: { baseURL: "http://10.129.28.81:8080/v1", apiKey: "dummy" },
  models: { "qwen38-flash-next-sp": { name: "Qwen 3.8 Flash Next (SP fleet)", tool_call: true } },
};
const agentEnv: Record<string, Record<string, string>> = {
  opencode: {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "sp-fleet/qwen38-flash-next-sp", provider: { "sp-fleet": spFleetProvider } }),
  },
  "pi-acp-liuser": {
    PI_CODING_AGENT_DIR: `${process.cwd()}/.pi-agent`,
    PI_ACP_DIR: `${process.cwd()}/.pi-acp-state`,
  },
};

const { child, stream } = spawnAgent(agentName, agentEnv[agentName]);
const hardTimeout = setTimeout(() => {
  log("hard-timeout");
  child.kill();
  process.exit(2);
}, (waitSeconds + 300) * 1000);

let finalText = "";
const toolCalls = new Map<string, { title?: string; status?: string; rawOutput?: unknown }>();

try {
  const response = await acp
    .client({ name: "canvas-spike" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => allowOnce(ctx.params))
    .connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      const request = {
        cwd: process.cwd(),
        mcpServers: [{ type: "http" as const, name: "canvas", url: canvasUrl, headers: [] }],
        ...(agentName === "claude" && { _meta: claudeOptions }),
      };
      return ctx.buildSession(request).withSession(async (session) => {
        log("session-started", { conversation, sessionId: session.sessionId });
        session.prompt(prompt);
        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === "stop") return message.response;
          const update = message.update;
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") finalText += update.content.text;
          if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
            const call = toolCalls.get(update.toolCallId) ?? {};
            Object.assign(call, { title: update.title ?? call.title, status: update.status ?? call.status, rawOutput: update.rawOutput ?? call.rawOutput });
            toolCalls.set(update.toolCallId, call);
            log(update.sessionUpdate, { id: update.toolCallId, title: call.title, status: update.status });
          }
        }
      });
    });
  log("summary", {
    conversation,
    waitSeconds,
    stopReason: response.stopReason,
    answerReachedAgent: finalText.includes(expectedAnswer),
    finalText: finalText.trim().slice(0, 300),
    toolCalls: [...toolCalls.values()].map(({ title, status, rawOutput }) => ({ title, status, rawOutput: JSON.stringify(rawOutput)?.slice(0, 300) })),
  });
} catch (error) {
  log("error", { message: String(error) });
} finally {
  clearTimeout(hardTimeout);
  child.kill();
  process.exit(0);
}
