import type { McpServer, ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Conversation } from "../../shared/model.ts";
import type { ConversationService } from "../conversations.ts";
import type { ReportedQuotaWindow } from "../plan-quotas.ts";
import type { Store } from "../store.ts";
import { profileOf } from "../usage-stats.ts";
import { PLAN_USAGE_TOOL } from "./tool-names.ts";

const PLAN_USAGE_DESCRIPTION =
  "The plan's usage limits as the agent last reported them: the five-hour and weekly windows, each with the percent used, when it starts over (ISO time and epoch seconds) and when it was reported, with the time now. This conversation's profile unless another is named. A window is null when the agent hasn't reported it since Mirador started, when it has started over since, or when the profile's agent reports none: only Claude Code and Codex do.";

class PlanUsageQueryError extends Error {}

interface AskedProfile {
  profileId: string | null;
  name: string;
}

const isoTime = (epochMs: number) => new Date(epochMs).toISOString();

const roundedToTenths = (percent: number) => Math.round(percent * 10) / 10;

const windowReport = (window: ReportedQuotaWindow | null | undefined) =>
  window
    ? {
        usedPercent: roundedToTenths(window.usedPercent),
        resetsAt: isoTime(window.resetsAt),
        resetsAtEpochSeconds: Math.floor(window.resetsAt / 1000),
        reportedAt: isoTime(window.reportedAt),
      }
    : null;

function profileOfCaller(store: Store, caller: Conversation | undefined): AskedProfile {
  if (!caller) throw new PlanUsageQueryError("The conversation asking isn't in Mirador's list, so it has no profile of its own: name a profile.");
  const profileName = caller.profileId === null ? null : (store.findProfile(caller.profileId)?.name ?? null);
  return { profileId: caller.profileId, name: profileOf({ ...caller, profileName }) };
}

function profileNamed(store: Store, wanted: string): AskedProfile {
  const profiles = store.listProfiles();
  const match = profiles.find(({ name }) => name.toLowerCase() === wanted.toLowerCase());
  if (match) return { profileId: match.id, name: match.name };
  const known = profiles.length === 0 ? "Mirador has no profiles: leave the profile out for this conversation's." : `The profiles: ${profiles.map(({ name }) => name).join(", ")}.`;
  throw new PlanUsageQueryError(`No profile is called "${wanted}". ${known}`);
}

/** Read-only, and loaded on demand like usage_stats, as few turns need it. */
export function registerPlanUsageTool(
  server: McpServer,
  store: Store,
  conversations: ConversationService,
  callingConversation: (ctx: ServerContext) => Promise<string>,
  reviewFree: { annotations?: ToolAnnotations } = {},
) {
  server.registerTool(
    PLAN_USAGE_TOOL,
    {
      description: PLAN_USAGE_DESCRIPTION,
      inputSchema: z.object({
        profile: z.string().optional().describe("A profile's name, to read its limits instead of this conversation's."),
      }),
      ...reviewFree,
    },
    async ({ profile }, ctx) => {
      try {
        const asked = profile === undefined ? profileOfCaller(store, store.findConversation(await callingConversation(ctx))) : profileNamed(store, profile);
        const now = Date.now();
        const quotas = conversations.planQuotasOfProfile(asked.profileId, now);
        const report = { profile: asked.name, now: isoTime(now), fiveHour: windowReport(quotas?.fiveHour), sevenDay: windowReport(quotas?.sevenDay) };
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (error) {
        if (error instanceof PlanUsageQueryError) return { isError: true, content: [{ type: "text", text: error.message }] };
        throw error;
      }
    },
  );
}
