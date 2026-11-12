import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Landed } from "../../shared/changes.ts";
import { HostProblemError } from "../../shared/host-problems.ts";
import type { ConversationService } from "../conversations.ts";
import { LAND_TOOL } from "./tool-names.ts";

const LAND_DESCRIPTION =
  "Bring the commits of this conversation's worktree onto the branch the project folder has checked out, moving that folder's files along. Commit your work first: uncommitted files stay in the worktree. When the branch moved on meanwhile, your commits are rebased onto it first. Mirador refuses and changes nothing when they would overwrite uncommitted edits in the project folder, or when the rebase conflicts. Never move that branch yourself with git update-ref, git branch -f or a merge in the project folder: that leaves the folder's files behind its branch, and its new commits show up there as staged reverts.";

const landedText = ({ branch, revision, subjects, rebased }: Landed) =>
  [
    `${branch} is now at ${revision}, with ${subjects.length === 1 ? "this commit" : `these ${subjects.length} commits`} from your worktree:`,
    ...subjects.map((subject) => `- ${subject}`),
    ...(rebased ? [`They were rebased onto what ${branch} gained meanwhile, so their hashes changed; your worktree is on the rebased commits.`] : []),
  ].join("\n");

/** Only for a conversation in its own worktree. It changes the user's repository, so it asks for permission like any other such tool. */
export function registerLandTool(server: McpServer, conversations: ConversationService, callingConversation: (ctx: ServerContext) => Promise<string>, loadedUpFront: Record<string, unknown>) {
  server.registerTool(LAND_TOOL, { description: LAND_DESCRIPTION, inputSchema: z.object({}), _meta: loadedUpFront }, async (_noArguments, ctx) => {
    try {
      const landed = await conversations.land(await callingConversation(ctx), { byAgent: true });
      return { content: [{ type: "text", text: landedText(landed) }] };
    } catch (error) {
      if (error instanceof HostProblemError) return { isError: true, content: [{ type: "text", text: error.message }] };
      throw error;
    }
  });
}
