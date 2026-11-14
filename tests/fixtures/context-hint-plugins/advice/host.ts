import type { CanvasHost } from "../../../../shared/canvas-plugins.ts";

/** Tells what the conversation's last turn left in its context and what it cost so far, as Mirador recorded it, and past half the window offers to compact. */
const advice: CanvasHost = {
  items: {},
  tools: {},
  contextHint({ usageHistory }) {
    const last = usageHistory.turns().at(-1);
    if (!last?.context || last.startedAt === null) return null;
    const cost = last.costSoFar ? ` The conversation cost ${last.costSoFar.amount} ${last.costSoFar.currency} so far.` : "";
    const text = `The last turn made ${last.toolCalls} tool calls and left ${last.context.used} tokens in context.${cost}`;
    return last.context.used > last.context.size / 2 ? { text, action: "compact" } : { text };
  },
};

export default advice;
