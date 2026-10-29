import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { scratchPath } from "./test-host.ts";

type ContentBlock = { type: string; text?: string; tool_use_id?: string; content?: string | { type: string; text?: string }[]; source?: { media_type?: string } };

type MessagesRequest = {
  model: string;
  stream?: boolean;
  system?: string | { text: string }[];
  tools?: { name: string }[];
  messages: { role: string; content: string | ContentBlock[] }[];
};

type Answer = { type: "text"; text: string } | { type: "tool_use" | "server_tool_use"; id: string; name: string; input: Record<string, unknown> };

const systemTextOf = ({ system }: MessagesRequest) => (typeof system === "string" ? system : (system ?? []).map(({ text }) => text).join("\n"));

const textOf = (content: MessagesRequest["messages"][number]["content"]) =>
  typeof content === "string" ? content : content.map(({ text }) => text ?? "").join("");

const imageTypesIn = (content: MessagesRequest["messages"][number]["content"]) =>
  typeof content === "string" ? [] : content.filter(({ type }) => type === "image").map(({ source }) => source?.media_type ?? "");

/** What a reply quotes: the newest text the user typed, after Claude Code's system reminders. */
const lastTypedText = ({ messages }: MessagesRequest) =>
  textOf(messages.findLast(({ role }) => role === "user")?.content ?? "")
    .split(/<\/system-reminder>/)
    .at(-1)!
    .trim();

/** What the tools called with `CALL` gave back, when the user's newest message carries their results. */
const resultsOfCalls = ({ messages }: MessagesRequest) => {
  const content = messages.findLast(({ role }) => role === "user")?.content ?? "";
  if (typeof content === "string") return null;
  const results = content.filter(({ type, tool_use_id }) => type === "tool_result" && tool_use_id?.startsWith(CALL_ID));
  if (results.length === 0) return null;
  return results.map(({ content: result }) => (typeof result === "string" ? result : (result ?? []).map(({ text }) => text ?? "").join(""))).join("\n");
};

const CALL = "CALL ";
const CALL_ID = "toolu_fake_call_";
const BACKGROUND = "BACKGROUND ";
const RUN = "RUN ";
const SUBAGENT = "SUBAGENT ";
const ADVISOR_AFTER_BASH = "ADVISOR AFTER BASH ";
const WRITE = "WRITE ";

const offersBash = ({ tools }: MessagesRequest) => (tools ?? []).some(({ name }) => name === "Bash");

const offersAgent = ({ tools }: MessagesRequest) => (tools ?? []).some(({ name }) => name === "Agent");

/** A request Claude Code makes on its own once a command it ran in the background ends. */
const answersEndedBackgroundCommand = ({ messages }: MessagesRequest) => {
  const content = messages.findLast(({ role }) => role === "user")?.content ?? "";
  return textOf(content).includes("<task-notification>") && (typeof content === "string" || content.every(({ type }) => type === "text"));
};

/**
 * Claude's Messages API for a subscription that Claude Code believes it signs in to (CLAUDE_CODE_OAUTH_TOKEN): while
 * `limited`, every request is refused the way the API refuses once a usage limit is reached; while `failing`, it fails
 * the way a gateway in front of the API does when it cannot reach it, with a 502; otherwise each reply
 * quotes the user's newest message. A message starting with `RUN ` runs the rest as a Bash command, and one starting
 * with `BACKGROUND ` runs it in the background; once a background command or subagent ends, the reply to Claude Code's
 * notification of it waits until `answerEndedCommands`, then runs `true` in Bash, so the turn Claude Code started on its
 * own asks for one more reply after it. A message starting with `ADVISOR AFTER BASH ` runs the rest in Bash and calls
 * the advisor after it in the same reply, which the real API never runs, so that call gets no result. A message
 * starting with `WRITE ` writes the file whose absolute path follows with the words after it. A message
 * starting with `SUBAGENT ` has a subagent do the rest, on the model Claude Code picks for it. A message starting with
 * `CALL ` calls the tool named after it with the JSON input that follows, such as `CALL mcp__canvas__ask {"question": …}`,
 * and each further line starting with `CALL ` calls one more in the same reply; the reply to their results is
 * `Result: ` and what they gave back, or the text after a last line starting with `THEN `. While `replySuffix` is set,
 * every reply in text ends with it. While `contextTokens` is
 * set, answers report it as their input usage, so Claude Code compacts its context on the next request; a message equal
 * to `refuseAfterCompaction` is answered with a Bash call so the turn keeps going after the compaction, and every
 * request after it runs into the usage limit.
 */
export class FakeClaudeApi {
  limited = true;
  failing = false;
  /** When set, every answer reports this many input tokens, so Claude Code thinks its context grew this big and compacts it. */
  contextTokens: number | null = null;
  /** Answers this message with a Bash call that keeps the same turn going, and refuses every request after it with the usage limit. */
  refuseAfterCompaction: string | null = null;
  /** When the limit resets, in epoch seconds; Claude Code shows it as "resets 6:20pm (Europe/Budapest)". */
  resetsAt = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
  /** The plan's usage limits each answer reports, as shares of 0 to 1, and when they start over, in epoch seconds. */
  planUsage: { fiveHour: number; fiveHourResetsAt: number; sevenDay: number; sevenDayResetsAt: number } | null = null;
  /** Ends every reply in text, e.g. with a question for the user. */
  replySuffix = "";
  readonly answered: string[] = [];
  /** The settings folder of a profile built with `subscriptionEnvironment`: empty, so the user's own ~/.claude stays out of the run. */
  readonly claudeConfigDir = scratchPath("claude-config");
  /** The system prompt each request carried, by the text the user typed last. */
  readonly systemPrompts = new Map<string, string>();
  /** The user's newest message as Claude Code sent it, with the context it adds, by the text the user typed. */
  readonly userMessages = new Map<string, string>();
  /** The media type of each image the user's newest message carried, by the text the user typed. */
  readonly images = new Map<string, string[]>();
  /** The model each request asked for, by the text the user typed last; a subagent's request goes by its prompt. */
  readonly models = new Map<string, string>();
  /** Every request's messages, role by role: what the agent's own history held when it answered. */
  readonly history: string[][] = [];
  readonly refused: string[] = [];
  /** The text the user typed last in each request held since `hold`. */
  readonly held: string[] = [];
  /** Every request held since `hold`, its messages role by role: what the agent's history held when it asked. */
  readonly heldRequests: string[][] = [];
  private server?: Server;
  private heldReplies: (() => void)[] | null = null;
  private heldNotificationReplies: (() => void)[] = [];
  private replies = 0;
  /** The `THEN ` reply of each reply of tool calls, by the id its calls' ids start with. */
  private readonly repliesAfterCalls = new Map<string, string>();

  async start() {
    mkdirSync(this.claudeConfigDir, { recursive: true });
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.method !== "POST" || !request.url!.startsWith("/v1/messages")) return response.writeHead(200).end("{}");
        this.reply(JSON.parse(Buffer.concat(chunks).toString()) as MessagesRequest, response);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  get url() {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  stop() {
    rmSync(this.claudeConfigDir, { recursive: true, force: true });
    this.server?.close();
  }

  /** Keeps every reply from now on waiting, so a turn stays running until `answerHeld`. */
  hold() {
    this.heldReplies ??= [];
  }

  /** Sends the replies held since `hold`, and answers at once again. */
  answerHeld() {
    const held = this.heldReplies ?? [];
    this.heldReplies = null;
    held.forEach((answer) => answer());
  }

  /** How many replies to notifications of ended background commands wait for `answerEndedCommands`. */
  get endedCommandsWaiting() {
    return this.heldNotificationReplies.length;
  }

  answerEndedCommands() {
    this.heldNotificationReplies.splice(0).forEach((answer) => answer());
  }

  private reply(body: MessagesRequest, response: ServerResponse) {
    if (this.heldReplies) {
      this.held.push(lastTypedText(body));
      this.heldRequests.push(body.messages.map(({ role, content }) => `${role}: ${textOf(content)}`));
      return void this.heldReplies.push(() => this.reply(body, response));
    }
    const typed = lastTypedText(body);
    this.systemPrompts.set(typed, systemTextOf(body));
    this.userMessages.set(typed, textOf(body.messages.findLast(({ role }) => role === "user")?.content ?? ""));
    this.images.set(typed, imageTypesIn(body.messages.findLast(({ role }) => role === "user")?.content ?? ""));
    this.history.push(body.messages.map(({ role, content }) => `${role}: ${textOf(content)}`));
    this.models.set(typed, body.model);
    if (this.failing) {
      this.refused.push(typed);
      response.writeHead(502, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "<urlopen error [Errno 8] nodename nor servname provided, or not known>" }));
    }
    if (this.limited) {
      this.refused.push(typed);
      response.writeHead(429, { "content-type": "application/json", ...this.limitHeaders() });
      return response.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } }));
    }
    if (this.refuseAfterCompaction === typed) {
      this.refuseAfterCompaction = null;
      this.limited = true;
      this.contextTokens = null;
      this.answered.push(typed);
      return this.send(body, response, [this.bashCall("true", false)]);
    }
    if (offersBash(body) && answersEndedBackgroundCommand(body)) return void this.heldNotificationReplies.push(() => this.send(body, response, [this.bashCall("true", false)]));
    this.answered.push(typed);
    if (offersAgent(body) && typed.startsWith(SUBAGENT)) return this.send(body, response, [this.agentCall(typed.slice(SUBAGENT.length))]);
    const results = resultsOfCalls(body);
    if (results !== null) return this.send(body, response, [{ type: "text", text: this.replyAfterCalls(body) ?? `Result: ${results}` }]);
    if (typed.startsWith(CALL)) return this.send(body, response, this.toolCalls(typed));
    this.send(body, response, this.answerTo(typed, offersBash(body)));
  }

  private answerTo(typed: string, bashOffered: boolean): Answer[] {
    if (bashOffered && typed.startsWith(RUN)) return [this.bashCall(typed.slice(RUN.length), false)];
    if (bashOffered && typed.startsWith(BACKGROUND)) return [this.bashCall(typed.slice(BACKGROUND.length), true)];
    if (bashOffered && typed.startsWith(ADVISOR_AFTER_BASH)) return [this.bashCall(typed.slice(ADVISOR_AFTER_BASH.length), false), this.advisorCall()];
    if (bashOffered && typed.startsWith(WRITE)) return [this.writeCall(typed.slice(WRITE.length))];
    return [{ type: "text", text: `Answered: ${typed}` }];
  }

  private replyAfterCalls({ messages }: MessagesRequest) {
    const content = messages.findLast(({ role }) => role === "user")?.content ?? "";
    const callId = typeof content === "string" ? undefined : content.find(({ tool_use_id }) => tool_use_id?.startsWith(CALL_ID))?.tool_use_id;
    return callId === undefined ? undefined : this.repliesAfterCalls.get(callId.slice(0, callId.lastIndexOf("_") + 1));
  }

  private toolCalls(typed: string): Answer[] {
    const [calls, replyAfter] = typed.split(/^THEN /m);
    if (replyAfter !== undefined) this.repliesAfterCalls.set(`${CALL_ID}${this.replies + 1}_`, replyAfter.trimEnd());
    return calls!.split(/^CALL /m).filter(Boolean).map((call, index) => {
      const [, name, input] = /^(\S+)\s+([\s\S]*)$/.exec(call.trim())!;
      return { type: "tool_use", id: `${CALL_ID}${this.replies + 1}_${index}`, name: name!, input: JSON.parse(input!) };
    });
  }

  private bashCall(command: string, inBackground: boolean): Answer {
    return { type: "tool_use", id: `toolu_fake_${this.replies + 1}`, name: "Bash", input: { command, description: `Run ${command}`, run_in_background: inBackground } };
  }

  private writeCall(pathAndText: string): Answer {
    const [path, ...words] = pathAndText.split(" ");
    return { type: "tool_use", id: `toolu_fake_${this.replies + 1}`, name: "Write", input: { file_path: path, content: `${words.join(" ")}\n` } };
  }

  private agentCall(prompt: string): Answer {
    return { type: "tool_use", id: `toolu_fake_${this.replies + 1}`, name: "Agent", input: { description: "Scripted subagent", prompt, subagent_type: "general-purpose" } };
  }

  private advisorCall(): Answer {
    return { type: "server_tool_use", id: `srvtoolu_fake_${this.replies + 1}`, name: "advisor", input: {} };
  }

  private send(body: MessagesRequest, response: ServerResponse, answers: Answer[]) {
    const blocks = answers.map((answer) => (answer.type === "text" ? { ...answer, text: answer.text + this.replySuffix } : answer));
    const id = `msg_fake_${++this.replies}`;
    const usage = { input_tokens: this.contextTokens ?? 10, output_tokens: 5 };
    const stopReason = blocks.some(({ type }) => type === "tool_use") ? "tool_use" : "end_turn";
    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json", ...this.planUsageHeaders() });
      return response.end(JSON.stringify({ id, type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: stopReason, stop_sequence: null, usage }));
    }
    response.writeHead(200, { "content-type": "text/event-stream", ...this.planUsageHeaders() });
    const send = (event: { type: string } & Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    blocks.forEach((block, index) => {
      send({ type: "content_block_start", index, content_block: block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} } });
      send({ type: "content_block_delta", index, delta: block.type === "text" ? { type: "text_delta", text: block.text } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      send({ type: "content_block_stop", index });
    });
    send({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } });
    send({ type: "message_stop" });
    response.end();
  }

  private planUsageHeaders(): Record<string, string> {
    if (!this.planUsage) return {};
    const { fiveHour, fiveHourResetsAt, sevenDay, sevenDayResetsAt } = this.planUsage;
    return {
      "anthropic-ratelimit-unified-status": "allowed",
      "anthropic-ratelimit-unified-reset": String(fiveHourResetsAt),
      "anthropic-ratelimit-unified-representative-claim": "five_hour",
      "anthropic-ratelimit-unified-5h-status": "allowed",
      "anthropic-ratelimit-unified-5h-reset": String(fiveHourResetsAt),
      "anthropic-ratelimit-unified-5h-utilization": String(fiveHour),
      "anthropic-ratelimit-unified-7d-status": "allowed",
      "anthropic-ratelimit-unified-7d-reset": String(sevenDayResetsAt),
      "anthropic-ratelimit-unified-7d-utilization": String(sevenDay),
    };
  }

  private limitHeaders() {
    const reset = String(this.resetsAt);
    return {
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-reset": reset,
      "anthropic-ratelimit-unified-representative-claim": "five_hour",
      "anthropic-ratelimit-unified-5h-status": "rejected",
      "anthropic-ratelimit-unified-5h-reset": reset,
    };
  }
}

/** Claude Code signs in with a made-up subscription token and gives up at the first refusal instead of retrying. */
export const subscriptionEnvironment = (api: FakeClaudeApi) =>
  [
    "-u ANTHROPIC_API_KEY",
    "-u ANTHROPIC_AUTH_TOKEN",
    "-u ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "-u ANTHROPIC_DEFAULT_SONNET_MODEL",
    "-u ANTHROPIC_DEFAULT_OPUS_MODEL",
    "-u ANTHROPIC_DEFAULT_FABLE_MODEL",
    `ANTHROPIC_BASE_URL=${api.url}`,
    "CLAUDE_CODE_OAUTH_TOKEN=e2e-subscription-token",
    "CLAUDE_CODE_MAX_RETRIES=0",
    `CLAUDE_CONFIG_DIR=${api.claudeConfigDir}`,
  ].join("\n");

/**
 * A test host's own Claude Code on this API, instead of the owner's model server: `new TestHost({ environment: () =>
 * fakeClaudeEnvironment(api) })`, read once the API has started. Every tool is offered up front, so `CALL` reaches
 * Mirador's MCP tools without a tool search first.
 */
export const fakeClaudeEnvironment = (api: FakeClaudeApi) => ({
  ANTHROPIC_BASE_URL: api.url,
  CLAUDE_CODE_OAUTH_TOKEN: "e2e-subscription-token",
  CLAUDE_CODE_MAX_RETRIES: "0",
  ENABLE_TOOL_SEARCH: "false",
});
