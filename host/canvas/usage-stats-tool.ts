import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Store } from "../store.ts";
import { toolReportApart, usageReportApart } from "../usage-reports.ts";
import { profileOf, UsageQueryError, type PluginToolTitles } from "../usage-stats.ts";
import { USAGE_STATS_TOOL } from "./tool-names.ts";

/**
 * How the user works with Mirador's agents, for the agent to read and explain. Loaded on demand, as few turns need it,
 * so it takes no room in the agent's context until it searches for it. A report on other workspaces than the caller's
 * leaves out what quotes their work.
 */
export function registerUsageStatsTool(server: McpServer, store: Store, callingConversation: (ctx: ServerContext) => Promise<string>, pluginTools: () => PluginToolTitles) {
  server.registerTool(
    USAGE_STATS_TOOL,
    {
      description:
        "How the user works with Mirador's agents, as JSON that defines its numbers: findings with a change worth trying for each, each profile's numbers, the tools called most and why they fail, permission prompts, the user's reply times, turns, models, and samples of requests. This conversation's workspace over the last 30 days unless told otherwise.",
      inputSchema: z.object({
        since: z.string().optional().describe("How far back: 12h, 7d or 2w, or a date such as 2026-10-01. 30 days when left out."),
        until: z.string().optional().describe("Until when: a date, counted whole, or a time. Now when left out."),
        workspace: z.string().optional().describe('A workspace\'s name or folder, or "all". This conversation\'s when left out.'),
        profile: z.string().optional().describe('"this" for this conversation\'s profile, or a profile\'s name. All profiles when left out.'),
        tool: z.string().optional().describe("One tool to look into, e.g. Bash: its calls by profile, more of its failed calls, and its slowest."),
        compare: z.boolean().optional().describe("Also give the numbers of the same length of time before, to tell what got better or worse."),
      }),
    },
    async ({ since, until, workspace = "this", profile, tool, compare }, ctx) => {
      try {
        const caller = store.findConversation(await callingConversation(ctx));
        const own = caller && store.findWorkspace(caller.workspaceId);
        if (!caller || !own) throw new UsageQueryError(`The conversation asking isn't in Mirador's list, so it has no workspace or profile of its own: give a workspace's name, or "all".`);
        const ownProfile = profileOf({ ...caller, profileName: caller.profileId === null ? null : (store.findProfile(caller.profileId)?.name ?? null) });
        const query = {
          since,
          until,
          workspace: workspace === "this" ? own.path : workspace,
          profile: profile === "this" ? ownProfile : profile,
          compare,
        };
        const options = { pluginTools: pluginTools(), excerpts: query.workspace === own.path || query.workspace.toLowerCase() === own.name.toLowerCase() };
        const report = tool ? await toolReportApart(store.path, { ...query, tool }, options) : await usageReportApart(store.path, query, options);
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (error) {
        if (error instanceof UsageQueryError) return { isError: true, content: [{ type: "text", text: error.message }] };
        throw error;
      }
    },
  );
}
