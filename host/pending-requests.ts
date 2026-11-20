import type * as acp from "@agentclientprotocol/sdk/unstable";
import { questionsOf } from "../shared/ask.ts";
import type { AskItem, PendingAsk, PendingPermissionRequest } from "../shared/model.ts";
import type { AskedPermission } from "../shared/room-permissions.ts";
import { cutWithEllipsis } from "../shared/text-cut.ts";

/** As much of a command as a list of waiting conversations shows; the conversation has all of it. */
const COMMAND_SHOWN = 500;

function stringField(value: unknown, key: string) {
  const field = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof field === "string" ? field : null;
}

const shortened = (text: string) => cutWithEllipsis(text, COMMAND_SHOWN);

/** `kindSeenBefore`: the kind of the tool call the request is about, from the agent's updates, for an agent that leaves it off the request. */
export function pendingPermission(
  permissionId: string,
  { toolCall, options }: Pick<acp.RequestPermissionRequest, "toolCall" | "options">,
  kindSeenBefore: acp.ToolKind | null = null,
): PendingPermissionRequest {
  const title = toolCall.title ?? "a tool";
  const toolKind = toolCall.kind ?? kindSeenBefore;
  const runsCommand = toolKind === "execute";
  return {
    kind: "permission",
    permissionId,
    title,
    toolKind,
    command: runsCommand ? shortened(stringField(toolCall.rawInput, "command") ?? title) : null,
    description: runsCommand ? stringField(toolCall.rawInput, "description") : null,
    options,
  };
}

/** The request as the host judges it by itself: with the whole command, and every path its locations and diffs name. */
export function askedPermissionOf(toolCall: acp.ToolCallUpdate, kindSeenBefore: acp.ToolKind | null): AskedPermission {
  const toolKind = toolCall.kind ?? kindSeenBefore;
  const title = toolCall.title ?? "a tool";
  const diffPaths = (toolCall.content ?? []).flatMap((content) => (content.type === "diff" ? [content.path] : []));
  return {
    toolKind,
    title,
    command: toolKind === "execute" ? (stringField(toolCall.rawInput, "command") ?? title) : null,
    paths: [...new Set([...(toolCall.locations ?? []).map(({ path }) => path), ...diffPaths])],
  };
}

export function pendingAsk(item: AskItem): PendingAsk {
  const questions = questionsOf(item);
  const first = questions[0];
  return {
    kind: "ask",
    itemId: item.id,
    question: first?.question ?? item.title,
    choices: (first?.options ?? []).map(({ label, description, recommended }) => ({ label, ...(description && { description }), ...(recommended && { recommended }) })),
    allowOther: first?.allowOther ?? false,
    questions: questions.length,
    previews: questions.some(({ html, options }) => Boolean(html) || options.some((option) => Boolean(option.html))),
  };
}
