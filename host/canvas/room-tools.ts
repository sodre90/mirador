import type { McpServer, ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ROOM_HISTORY_COUNT, ROOM_HISTORY_MOST, ROOM_HISTORY_TOOL, ROOM_TAG_TOOL, roomTimeOf } from "../../shared/rooms.ts";
import type { RoomService, TagsNamed } from "../rooms.ts";

/** What the room tools need of the rooms. */
export type RoomTools = Pick<RoomService, "nameTagsForAnswer" | "readBack">;

const NOT_IN_A_ROOM = "Only an agent's conversation in a room of Mirador has a room to read or tag in.";

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

const namesIn = (names: string[]) => (names.length > 0 ? names.join(", ") : "none");

function tagsNamedText({ tagged, itself, unknown, others }: TagsNamed) {
  return [
    tagged.length > 0 ? `Your final answer of this turn will tag ${tagged.join(", ")}.` : "Your final answer of this turn tags no agent.",
    ...(itself ? ["You can't tag yourself."] : []),
    ...(unknown.length > 0 ? [`No agent of this room is called ${unknown.join(", ")}. Its other agents: ${namesIn(others)}.`] : []),
  ].join("\n");
}

/**
 * Only for an agent's conversation in a room. Their descriptions are the same in every room, so that the prompt cache
 * holds; the room's names come in its first prompt and in the tools' results.
 */
export function registerRoomTools(
  server: McpServer,
  rooms: RoomTools,
  callingConversation: (ctx: ServerContext) => Promise<string>,
  extras: { _meta: Record<string, unknown>; annotations?: ToolAnnotations },
) {
  server.registerTool(
    ROOM_HISTORY_TOOL,
    {
      description:
        "Read messages of your room older than those you were sent with your task: the latest before a message's number or a time, or those whose text holds what you look for. They come numbered, with their author and time, oldest first, as the room's messages reach you. Only messages you were sent count.",
      inputSchema: z.object({
        before: z.number().int().positive().optional().describe("A message's number, 12 for #12: only messages before it."),
        beforeTime: z.string().optional().describe("A time in UTC as the room's messages show it, such as 2026-11-20 09:00: only messages written before it."),
        search: z.string().optional().describe("Only messages whose text holds this, in any case."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`How many of the latest messages that match, at most: ${ROOM_HISTORY_COUNT} when left out, ${ROOM_HISTORY_MOST} at the most.`),
      }),
      ...extras,
    },
    async ({ before, beforeTime, search, limit }, ctx) => {
      const until = beforeTime === undefined ? undefined : roomTimeOf(beforeTime);
      if (until === null) return toolError(`"${beforeTime}" is no time: give one such as 2026-11-20 09:00, in UTC.`);
      const history = rooms.readBack(await callingConversation(ctx), { before, beforeTime: until, search, limit });
      return history === null ? toolError(NOT_IN_A_ROOM) : toolText(history);
    },
  );

  server.registerTool(
    ROOM_TAG_TOOL,
    {
      description:
        "Tag other agents of your room in your final answer of this turn, by their profile names: once your turn ends, each gets a thread of its own on your answer and is sent the room's messages it has not seen, as when a person tags it. Calling it again in the turn replaces whom you tag; an empty list tags none. You can't tag yourself, nor an agent outside the room, and after a few turns of agents tagging each other since a person wrote, the room stops passing tags on.",
      inputSchema: z.object({
        agents: z.array(z.string()).describe("The profile names of the room's other agents to tag."),
      }),
      ...extras,
    },
    async ({ agents }, ctx) => {
      const named = rooms.nameTagsForAnswer(await callingConversation(ctx), agents);
      if (named === null) return toolError(NOT_IN_A_ROOM);
      const text = tagsNamedText(named);
      return named.tagged.length === 0 && agents.length > 0 ? toolError(text) : toolText(text);
    },
  );
}
