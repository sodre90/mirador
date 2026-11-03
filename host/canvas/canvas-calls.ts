import type { ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { AskOption, AskQuestion, StoredEvent } from "../../shared/model.ts";
import { toolNameOf } from "../../shared/tool-title.ts";
import { canvasToolName } from "./tool-names.ts";
import type { LoadedSession } from "../conversations.ts";
import type { Store } from "../store.ts";
import type { CanvasPlugins } from "./plugins.ts";
import type { AskRequest, CanvasService, ShowRequest } from "./service.ts";

/** A canvas tool call the agent made, as its session's history has it: what it was given, and what it returned. */
export interface CanvasCall {
  /** The canvas tool's own name, without the agent's prefix: show, ask, update_checklist… */
  tool: string;
  input: Record<string, unknown>;
  result: string;
  /** What the user wrote next after the call, where an answer given as the next message would be. */
  nextUserMessage: string | null;
  /** Counts the user's messages before the call, so calls of one turn share it. */
  userMessagesBefore: number;
}

/**
 * Brings back the canvas of the session a conversation continues or forks: as the conversation that holds the session
 * has it, or had it when deleted, else as the session's history tells. A continued session's deleted canvas is then
 * the new conversation's own.
 */
export async function restoreCanvas(conversationId: string, { harness, sessionId, mode }: LoadedSession, events: StoredEvent[], store: Store, canvas: CanvasService, plugins: CanvasPlugins) {
  const holder = store.listConversations().find((conversation) => conversation.id !== conversationId && conversation.harness === harness && conversation.acpSessionId === sessionId);
  const kept = holder ? store.listCanvasItems(holder.id) : store.deletedCanvas(harness, sessionId);
  if (!kept) return rebuildCanvas(conversationId, events, canvas, plugins);
  canvas.restoreItems(conversationId, kept, { sameIds: mode === "continue" && !holder });
  if (mode === "continue" && !holder) store.forgetDeletedCanvas(harness, sessionId);
}

/**
 * Puts back on a continued session's canvas the pages, questions and plugin items its history made; it runs once the
 * history is loaded into a conversation of its own, whose canvas is empty.
 */
export async function rebuildCanvas(conversationId: string, events: StoredEvent[], canvas: CanvasService, plugins: CanvasPlugins) {
  let pagesSinceQuestion: { id: string; userMessagesBefore: number }[] = [];
  for (const call of canvasCallsIn(events)) {
    if (call.tool === "show") {
      const page = showRequestOf(call.input);
      if (page) pagesSinceQuestion.push({ id: canvas.restorePage(conversationId, page).id, userMessagesBefore: call.userMessagesBefore });
    } else if (call.tool === "ask") {
      const request = askRequestOf(call.input);
      if (!request) continue;
      const shownBefore = pagesSinceQuestion.filter(({ userMessagesBefore }) => userMessagesBefore === call.userMessagesBefore).map(({ id }) => id);
      canvas.restoreAsk(conversationId, request, { shownBefore, toolResult: call.result, nextUserMessage: call.nextUserMessage });
      pagesSinceQuestion = [];
    } else {
      await plugins.replay(conversationId, call.tool, call.input);
    }
  }
}

const showRequestOf = ({ title, html }: Record<string, unknown>): ShowRequest | null =>
  typeof title === "string" && typeof html === "string" ? { title, html } : null;

function askRequestOf({ questions, question, options, html, allowOther, optionWidth }: Record<string, unknown>): AskRequest | null {
  if (Array.isArray(questions)) return { questions: questions as AskQuestion[] };
  if (typeof question !== "string" || !Array.isArray(options)) return null;
  return {
    question,
    options: options as AskOption[],
    ...(typeof html === "string" && { html }),
    ...(typeof allowOther === "boolean" && { allowOther }),
    ...(typeof optionWidth === "number" && { optionWidth }),
  };
}

interface CallInProgress extends CanvasCall {
  completed: boolean;
}

/** The completed canvas calls in the events, in the order the agent made them. */
export function canvasCallsIn(events: StoredEvent[]): CanvasCall[] {
  const calls = new Map<string, CallInProgress>();
  const awaitingUserMessage: CallInProgress[] = [];
  let userMessages = 0;
  let userMessageText: string[] | null = null;
  const endUserMessage = () => {
    if (userMessageText === null) return;
    const text = userMessageText.join("");
    awaitingUserMessage.splice(0).forEach((call) => (call.nextUserMessage = text));
    userMessageText = null;
  };
  for (const { event } of events) {
    if (event.type === "user-message") {
      endUserMessage();
      userMessages += 1;
      userMessageText = [event.text];
      endUserMessage();
      continue;
    }
    if (event.type !== "acp") continue;
    const { update } = event;
    if (update.sessionUpdate === "user_message_chunk") {
      if (userMessageText === null) {
        userMessages += 1;
        userMessageText = [];
      }
      if (update.content.type === "text") userMessageText.push(update.content.text);
      continue;
    }
    endUserMessage();
    if (update.sessionUpdate === "tool_call") {
      const tool = canvasToolName(toolNameOf(update));
      if (tool === null) continue;
      const call: CallInProgress = { tool, input: {}, result: "", nextUserMessage: null, userMessagesBefore: userMessages, completed: false };
      calls.set(update.toolCallId, call);
      noteProgress(call, update);
    } else if (update.sessionUpdate === "tool_call_update") {
      const call = calls.get(update.toolCallId);
      if (!call) continue;
      noteProgress(call, update);
      if (update.status === "completed") {
        call.completed = true;
        awaitingUserMessage.push(call);
      } else if (update.status === "failed") calls.delete(update.toolCallId);
    }
  }
  endUserMessage();
  return [...calls.values()].filter(({ completed }) => completed).map(({ completed: _, ...call }) => call);
}

function noteProgress(call: CallInProgress, update: ToolCallUpdate) {
  if (update.rawInput && typeof update.rawInput === "object" && Object.keys(update.rawInput).length > 0) call.input = update.rawInput as Record<string, unknown>;
  const result = resultText(update);
  if (result) call.result = result;
}

function resultText(update: ToolCallUpdate): string {
  const fromContent = (update.content ?? [])
    .map((block) => (block.type === "content" && block.content.type === "text" ? block.content.text : ""))
    .join("\n")
    .trim();
  if (fromContent) return fromContent;
  const { rawOutput } = update;
  if (typeof rawOutput === "string") return rawOutput.trim();
  if (Array.isArray(rawOutput)) {
    return rawOutput
      .map((block) => (block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}
