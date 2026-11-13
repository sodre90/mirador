import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { findAntigravity } from "../host/acp/antigravity-program.ts";
import { findCopilot } from "../host/acp/copilot-program.ts";
import { foldersOnPath, programIn } from "./test-host.ts";

type ChatMessage = { role: string; content?: string | { type: string; text?: string }[] | null };
type ChatRequest = { model?: string; messages: ChatMessage[]; tools?: { function: { name: string; description?: string } }[] };
type ToolCall = { name: string; arguments: Record<string, unknown> };
type Reply = { text: string } | { call: ToolCall };

type ResponsesContent = string | { type: string; text?: string }[];
type ResponsesItem =
  | { type: "message"; role: string; content: ResponsesContent }
  | { type: "function_call"; name: string; namespace?: string }
  | { type: "function_call_output"; output: ResponsesContent }
  | { type: string };
type ResponsesTool = { type: string; name?: string; description?: string; tools?: { name: string; description?: string }[] };
type ResponsesRequest = { input: ResponsesItem[]; tools?: ResponsesTool[] };

const responsesText = (content: ResponsesContent) => (typeof content === "string" ? content : content.map(({ text }) => text ?? "").join(""));

/** Codex's Responses API request, as the chat request the script reads: a namespace's tools go by `<namespace>__<tool>`, as Claude Code names MCP tools. */
function asChatRequest({ input, tools = [] }: ResponsesRequest): ChatRequest {
  const messages = input.flatMap((item): ChatMessage[] => {
    if (item.type === "message" && "content" in item) return [{ role: item.role, content: responsesText(item.content) }];
    if (item.type === "function_call_output" && "output" in item) return [{ role: "tool", content: responsesText(item.output) }];
    if (item.type === "function_call") return [{ role: "assistant", content: null }];
    return [];
  });
  const functions = tools.flatMap((tool) =>
    tool.type === "namespace"
      ? (tool.tools ?? []).map(({ name, description }) => ({ function: { name: `${tool.name}__${name}`, description } }))
      : tool.type === "function"
        ? [{ function: { name: tool.name!, description: tool.description } }]
        : [],
  );
  return { messages, tools: isCodexSideTask(messages) ? [] : functions };
}

/** Codex asks its model for a title and a guess at the user's next message with tools offered; they read as title requests do. */
const isCodexSideTask = (messages: ChatMessage[]) => textOf(messages.at(-1)).startsWith("Your task is to");

const responsesEvent = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const textOf = (message: ChatMessage | undefined) =>
  typeof message?.content === "string" ? message.content : (message?.content ?? []).map(({ text }) => text ?? "").join("");

/** opencode 2 hands the model a failed tool's result as JSON with the error in it, opencode 1 as the bare message. */
const toolResultOf = (message: ChatMessage) => {
  const text = textOf(message);
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text;
  }
};

/** The model list an agent such as Antigravity asks an OpenAI-compatible endpoint for. */
const SCRIPTED_MODEL_LIST = { object: "list", data: [{ id: "scripted", object: "model", owned_by: "e2e" }] };

/** Antigravity sends the user's message inside `<USER_REQUEST>`, followed by metadata such as the local time. */
const withoutAntigravityWrapping = (text: string) => /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(text)?.[1] ?? text;

/** Antigravity may follow the user's message with a notice of its own, such as that a restart stopped its background tasks. */
const isAntigravityNotice = (message: ChatMessage) => message.role === "user" && textOf(message).includes("<SYSTEM_MESSAGE>") && !textOf(message).includes("<USER_REQUEST>");

/** Antigravity refuses a tool call without the `toolSummary` it asks of every call; its shell tool, run_command, tells it apart. */
function withAntigravityToolSummary(request: ChatRequest, reply: Reply): Reply {
  const offersRunCommand = (request.tools ?? []).some(({ function: { name } }) => name === "run_command");
  if (!offersRunCommand || !("call" in reply)) return reply;
  return { call: { ...reply.call, arguments: { toolSummary: "Scripted call", ...reply.call.arguments } } };
}

const chunk = (delta: object, finishReason: string | null = null) => ({
  id: "scripted",
  object: "chat.completion.chunk",
  created: 0,
  model: "scripted",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

/** Every reply reports the same token usage, so opencode's context report has a known value. */
export const SCRIPTED_PROMPT_TOKENS = 42_000;
const finish = (finishReason: string) => ({
  ...chunk({}, finishReason),
  usage: { prompt_tokens: SCRIPTED_PROMPT_TOKENS, completion_tokens: 500, total_tokens: SCRIPTED_PROMPT_TOKENS + 500 },
});

/**
 * An OpenAI-compatible model for opencode that follows a script instead of thinking: the last
 * user message decides the reply. `RUN <command>` calls the shell tool, `SHOW <title>` and `ASK <question>`
 * call the canvas tools, `CALL <tool> <JSON arguments>` any of them, `DELEGATE <prompt>` starts an opencode 2
 * subagent whose own script is the prompt, a tool result is echoed back, anything else is echoed as text.
 */
export class ScriptedModel {
  readonly requests: ChatRequest[] = [];
  private readonly requestHeaders: IncomingHttpHeaders[] = [];
  private readonly responsesRequests: ResponsesRequest[] = [];
  /** While set, every request for a reply gets this error response instead, as from a provider that is down. */
  failure: { status: number; body: object } | null = null;
  /** Response headers every Responses API reply carries, such as the `x-codex-*` rate limits ChatGPT's backend sends Codex. */
  responsesHeaders: Record<string, string> = {};
  private server?: Server;
  private heldReplies: (() => void)[] | null = null;

  async start() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.method === "GET" && request.url?.endsWith("/models")) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(SCRIPTED_MODEL_LIST));
        const parsed = JSON.parse(Buffer.concat(chunks).toString() || "{}") as ChatRequest | ResponsesRequest;
        const viaResponses = request.url?.endsWith("/responses") ?? false;
        if (viaResponses) this.responsesRequests.push(parsed as ResponsesRequest);
        const body = viaResponses ? asChatRequest(parsed as ResponsesRequest) : (parsed as ChatRequest);
        this.requests.push(body);
        this.requestHeaders.push(request.headers);
        const answer = () => this.reply(body, response, viaResponses);
        if (this.heldReplies && (body.tools ?? []).length > 0) return void this.heldReplies.push(answer);
        answer();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  get url() {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/v1`;
  }

  stop() {
    this.server?.close();
  }

  /** Keeps every reply from now on waiting, so the agent stays on its model call until `answerHeld`. */
  hold() {
    this.heldReplies ??= [];
  }

  /** Sends the replies held since `hold`, and answers at once again. */
  answerHeld() {
    const held = this.heldReplies ?? [];
    this.heldReplies = null;
    held.forEach((answer) => answer());
  }

  /** Each value the agent sent in a request header, once, such as the session id an LLM gateway files requests under. */
  headerValues(name: string) {
    return [...new Set(this.requestHeaders.flatMap((headers) => headers[name] ?? []))];
  }

  /** Every text the agent sent the model, to check what context a conversation carries. */
  textsSent() {
    return this.requests.flatMap(({ messages }) => messages.map(textOf));
  }

  /** The user's messages in the latest request for a reply, not a title: what the agent's context holds of the conversation. */
  /** Without the environment Codex describes in a message of the user's own at a session's start, and the suggestion Codex asks for after a turn, which no one typed. */
  userMessagesInContext() {
    return this.latestReplyRequest().messages
      .filter(({ role }) => role === "user")
      .map(textOf)
      .filter((text) => !text.startsWith("<environment_context>") && !text.startsWith("This is an app-generated request for a suggested next user message."));
  }

  /** The system messages of the latest request for a reply. */
  systemPromptInContext() {
    return this.latestReplyRequest().messages.filter(({ role }) => role === "system" || role === "developer").map(textOf).join("\n\n");
  }

  /** The description the agent gave the model of the tool whose name ends with `name`, in the latest request for a reply. */
  toolDescription(name: string) {
    return (this.latestReplyRequest().tools ?? []).find(({ function: tool }) => tool.name.endsWith(name))?.function.description;
  }

  /** The description Codex gave the model of a namespace of tools, such as an MCP server's, in the latest request with it. */
  namespaceDescription(name: string) {
    const namespaceIn = (request: ResponsesRequest) => request.tools?.find((tool) => tool.type === "namespace" && tool.name === name);
    return this.responsesRequests.map(namespaceIn).findLast((namespace) => namespace !== undefined)?.description;
  }

  private latestReplyRequest() {
    return this.requests.findLast(({ tools }) => (tools ?? []).length > 0) ?? { messages: [] };
  }

  private reply(request: ChatRequest, response: ServerResponse, viaResponses: boolean) {
    if ((request.tools ?? []).length > 0 && this.failure) {
      return response.writeHead(this.failure.status, { "content-type": "application/json" }).end(JSON.stringify(this.failure.body));
    }
    const reply = withAntigravityToolSummary(request, this.scriptedReply(request));
    if (viaResponses) return this.streamResponse(response, reply);
    if ("text" in reply) return this.stream(response, [chunk({ role: "assistant", content: reply.text }), finish("stop")]);
    const toolCall = { index: 0, id: `call_${this.requests.length}`, type: "function", function: { name: reply.call.name, arguments: JSON.stringify(reply.call.arguments) } };
    this.stream(response, [chunk({ role: "assistant", tool_calls: [toolCall] }), finish("tool_calls")]);
  }

  private scriptedReply(request: ChatRequest): Reply {
    const tools = (request.tools ?? []).map(({ function: { name } }) => name);
    const last = request.messages.findLast((message) => !isAntigravityNotice(message));
    if (tools.length === 0) return { text: "Scripted title" };
    if (last?.role === "tool") return { text: `Tool result: ${toolResultOf(last)}` };
    const text = withoutAntigravityWrapping(textOf(last)).trim();
    const canvasTool = (action: string) => tools.find((name) => name.includes("canvas") && name.endsWith(action))!;
    const script = text.split("\n").at(-1)!.trim(); // opencode 2 puts its own lines before a subagent's prompt
    const [directive, ...rest] = script.split(" ");
    const argument = rest.join(" ");
    if (directive === "RUN") return { call: shellCall(tools, argument) };
    if (directive === "QUESTIONS") return { call: { name: "request_user_input", arguments: JSON.parse(argument) } };
    if (directive === "DELEGATE") return { call: { name: "subagent", arguments: { agent: "general", description: "Scripted subagent", prompt: argument } } };
    if (directive === "CALL") {
      const [tool, ...json] = rest;
      return { call: { name: canvasTool(tool!), arguments: JSON.parse(json.join(" ")) } };
    }
    if (directive === "SHOW") return { call: { name: canvasTool("show"), arguments: { title: argument, html: `<h1>${argument}</h1>` } } };
    if (directive === "ASK") {
      const context = `<h2>Why this matters</h2><div style="height:600px">Taller than the frame's starting height</div>`;
      const options = [{ label: "Red", html: `<div style="height:100px">Red swatch</div>` }, { label: "Blue" }];
      return { call: { name: canvasTool("ask"), arguments: { question: argument, html: context, options } } };
    }
    return { text: `Echo: ${text}` };
  }

  /** A Responses API stream: the text comes as a delta of an item announced first, as codex-acp shows only the deltas. */
  private streamResponse(response: ServerResponse, reply: Reply) {
    const id = `resp_${this.requests.length}`;
    const item = "text" in reply ? { type: "message", role: "assistant", id: `msg_${this.requests.length}`, content: [{ type: "output_text", text: reply.text }] } : functionCallItem(reply.call, this.requests.length);
    const usage = { input_tokens: SCRIPTED_PROMPT_TOKENS, output_tokens: 500, total_tokens: SCRIPTED_PROMPT_TOKENS + 500 };
    response.writeHead(200, { ...this.responsesHeaders, "content-type": "text/event-stream" });
    response.end(
      [
        responsesEvent("response.created", { response: { id } }),
        responsesEvent("response.output_item.added", { item: "text" in reply ? { ...item, content: [] } : item }),
        ...("text" in reply ? [responsesEvent("response.output_text.delta", { item_id: item.id, delta: reply.text })] : []),
        responsesEvent("response.output_item.done", { item }),
        responsesEvent("response.completed", { response: { id, usage } }),
      ].join(""),
    );
  }

  private stream(response: ServerResponse, chunks: object[]) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`${chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("")}data: [DONE]\n\n`);
  }
}

/**
 * The shell tool each agent offers: Codex's exec_command takes `cmd`, Antigravity's run_command `CommandLine`, the
 * others' `command`. Copilot on Windows offers powershell instead of bash.
 */
function shellCall(tools: string[], command: string): ToolCall {
  if (tools.includes("exec_command")) return { name: "exec_command", arguments: { cmd: command } };
  if (tools.includes("run_command")) return { name: "run_command", arguments: { CommandLine: command, WaitMsBeforeAsync: 5000 } };
  const name = ["shell", "powershell"].find((tool) => tools.includes(tool)) ?? "bash";
  return { name, arguments: { command, description: "Run the scripted command" } };
}

/** Codex offers an MCP server's tools in a namespace, and the model names both in its call. */
function functionCallItem({ name, arguments: args }: ToolCall, index: number) {
  const namespaceEnd = name.lastIndexOf("__");
  const naming = namespaceEnd > 0 ? { namespace: name.slice(0, namespaceEnd), name: name.slice(namespaceEnd + 2) } : { name };
  return { type: "function_call", id: `fc_${index}`, call_id: `call_${index}`, ...naming, arguments: JSON.stringify(args) };
}

/** Enough models that the app offers its searchable model picker, as it does for a real opencode with many providers. */
export const SPARE_MODELS = 24;

/**
 * A profile environment that points opencode at the scripted model and keeps it away from the
 * user's own opencode setup: config, plugins, agents and session database all live under `root`.
 */
export function scriptedOpencodeEnvironment(model: ScriptedModel, root: string) {
  const scriptedModel = (name: string) => ({
    name,
    modalities: { input: ["text", "image"], output: ["text"] },
    supportsToolCalls: true,
    attachment: true,
    limit: { context: 100_000, output: 4_096 },
  });
  const spareModels = Object.fromEntries(Array.from({ length: SPARE_MODELS }, (_, index) => [`spare-${index + 1}`, scriptedModel(`Spare model ${index + 1}`)]));
  const config = {
    model: "e2e/scripted",
    enabled_providers: ["e2e", "spare"],
    provider: {
      e2e: {
        npm: "@ai-sdk/openai-compatible",
        name: "E2E",
        options: { baseURL: model.url, apiKey: "unused" },
        models: { scripted: scriptedModel("Scripted") },
      },
      spare: {
        npm: "@ai-sdk/openai-compatible",
        name: "Spare",
        options: { baseURL: model.url, apiKey: "unused" },
        models: spareModels,
      },
    },
    permission: { bash: "ask", shell: "ask" },
  };
  return [
    `XDG_CONFIG_HOME=${root}/opencode-config`,
    `XDG_DATA_HOME=${root}/opencode-data`,
    `XDG_STATE_HOME=${root}/opencode-state`,
    `OPENCODE_CONFIG_CONTENT='${JSON.stringify(config)}'`,
  ].join("\n");
}

/** opencode as the host finds it: on PATH, else where its installer puts it. */
export function opencodeProgram() {
  const installDirectory = join(homedir(), ".opencode", "bin");
  const found = programIn([...foldersOnPath(), installDirectory], "opencode");
  if (!found) throw new Error(`opencode is neither on PATH nor in ${installDirectory}`);
  return found;
}

/**
 * pi-acp asks npm for pi's newest version as each session starts and posts "New version available" as an agent message
 * when it is newer than the pi installed. With no registry to ask, the notice never shows, rather than whenever npm answers
 * within pi-acp's 800 ms.
 */
const NPM_WITHOUT_A_REGISTRY = ["npm_config_registry=http://127.0.0.1:9/", "npm_config_offline=true"];

/**
 * A profile environment that points pi at the scripted model and keeps it away from the user's own pi setup: settings,
 * models, extensions and sessions all live under `root`.
 */
export function scriptedPiEnvironment(model: ScriptedModel, root: string, defaultModel: "scripted" | "other" = "scripted") {
  const agentDirectory = join(root, "pi-agent");
  mkdirSync(agentDirectory, { recursive: true });
  const models = [
    { id: "scripted", name: "Scripted", input: ["text", "image"] },
    { id: "other", name: "Other", input: ["text", "image"] },
  ];
  const provider = { baseUrl: model.url, api: "openai-completions", apiKey: "unused", models };
  writeFileSync(join(agentDirectory, "models.json"), JSON.stringify({ providers: { e2e: provider } }));
  writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel }));
  return [`PI_CODING_AGENT_DIR=${agentDirectory}`, "PI_OFFLINE=1", ...NPM_WITHOUT_A_REGISTRY].join("\n");
}

/** pi as the host finds it, on PATH; null where it is not installed. */
export function piProgram() {
  const candidates = (process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, process.platform === "win32" ? "pi.cmd" : "pi"));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** The ids of the sessions the pi of `scriptedPiEnvironment(model, root)` saved, from their files' `<timestamp>_<id>.jsonl` names. */
export function piSessionIdsUnder(root: string) {
  const sessions = join(root, "pi-agent", "sessions");
  if (!existsSync(sessions)) return [];
  return readdirSync(sessions, { recursive: true, encoding: "utf8" }).flatMap((file) => file.match(/_([^_/\\]+)\.jsonl$/)?.[1] ?? []);
}

/** pi-acp keeps a map of every session it starts in the user's ~/.pi; the ones a test started under `root` come out of it again. */
export function forgetPiAcpSessionsUnder(root: string) {
  const sessionMap = join(homedir(), ".pi", "pi-acp", "session-map.json");
  if (!existsSync(sessionMap)) return;
  const map = JSON.parse(readFileSync(sessionMap, "utf8")) as { sessions: Record<string, { cwd: string; sessionFile: string }> };
  const kept = Object.entries(map.sessions).filter(([, { cwd, sessionFile }]) => !cwd.startsWith(root) && !sessionFile.startsWith(root));
  writeFileSync(sessionMap, `${JSON.stringify({ ...map, sessions: Object.fromEntries(kept) }, null, 2)}\n`);
}

/**
 * Codex's own models call their tools through code; the scripted model, which Codex knows from this catalog, gets them as
 * functions it calls directly. Without an entry Codex says in the conversation that it knows nothing of the model.
 */
const scriptedCodexModel = {
  slug: "scripted",
  display_name: "Scripted",
  description: "The e2e tests' scripted model",
  base_instructions: "You are a scripted model.",
  shell_type: "unified_exec",
  visibility: "list",
  supported_in_api: true,
  priority: 1,
  tool_mode: "direct_model_only",
  context_window: 258_400,
  supported_reasoning_levels: [],
  input_modalities: ["text", "image"],
  support_verbosity: true,
  truncation_policy: { mode: "tokens", limit: 10_000 },
  experimental_supported_tools: [],
};

/**
 * A profile environment that points Codex at the scripted model and keeps it away from the user's own Codex setup:
 * config, sign-in, skills and sessions all live under `root`. Full access, so commands run with neither a sandbox nor
 * Codex's own review.
 */
export function scriptedCodexEnvironment(model: ScriptedModel, root: string) {
  const codexHome = join(root, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const catalog = join(codexHome, "models.json");
  writeFileSync(catalog, JSON.stringify({ models: [scriptedCodexModel] }));
  const config = ['model = "scripted"', 'model_provider = "e2e"', `model_catalog_json = ${JSON.stringify(catalog)}`, "", "[model_providers.e2e]", 'name = "E2E"', `base_url = "${model.url}"`, 'wire_api = "responses"'];
  writeFileSync(join(codexHome, "config.toml"), `${config.join("\n")}\n`);
  return [`CODEX_HOME=${codexHome}`, "INITIAL_AGENT_MODE=agent-full-access"].join("\n");
}

/** The user's own Codex, which Mirador needs to offer Codex at all; null where it is not installed. */
export function codexProgram() {
  const candidates = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local", "bin")].map((directory) => join(directory, process.platform === "win32" ? "codex.cmd" : "codex"));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The user's own Copilot CLI, which Mirador needs to offer Copilot at all; null where it is not installed. VS Code's
 * launcher of the same name, which only says the CLI is missing, does not count.
 */
export function copilotProgram() {
  return findCopilot(process.env.PATH);
}

/**
 * A profile environment that points Copilot at the scripted model as a bring-your-own-key provider, which needs no GitHub
 * sign-in, and keeps it away from the user's own Copilot setup: config, state and sessions all live under `root`.
 */
export function scriptedCopilotEnvironment(model: ScriptedModel, root: string) {
  const copilotHome = join(root, "copilot-home");
  mkdirSync(copilotHome, { recursive: true });
  return [
    `COPILOT_HOME=${copilotHome}`,
    "COPILOT_OFFLINE=true",
    `COPILOT_PROVIDER_BASE_URL=${model.url}`,
    "COPILOT_PROVIDER_TYPE=openai",
    "COPILOT_PROVIDER_WIRE_API=completions",
    "COPILOT_PROVIDER_API_KEY=unused",
    "COPILOT_MODEL=scripted",
  ].join("\n");
}

/** The user's own Antigravity CLI, `agy`, which Mirador needs to offer Antigravity at all; null where it is not installed. */
export function antigravityProgram() {
  return findAntigravity(process.env.PATH);
}

/**
 * A profile environment that points Antigravity at the scripted model through its LLM gateway, which needs no Google
 * sign-in, and keeps it away from the user's own Antigravity setup: its home, and so `~/.gemini`, lives under `root`.
 */
export function scriptedAntigravityEnvironment(model: ScriptedModel, root: string) {
  const home = join(root, "antigravity-home");
  mkdirSync(home, { recursive: true });
  return [`HOME=${home}`, `AGY_LLM_GATEWAY_URL=${model.url.replace(/\/v1$/, "")}`, "AGY_LLM_GATEWAY_WIRE_PROTOCOL=openai", "AGY_LLM_GATEWAY_API_KEY=unused"].join("\n");
}
