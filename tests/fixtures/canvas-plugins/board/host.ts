import type { CanvasHost, CanvasPluginContext } from "../../../../shared/canvas-plugins.ts";

/**
 * The smallest canvas plugin for testing Mirador's: a card among the pages, which the user presses and the agent hears
 * of, and steps in the tab, which the agent ticks off.
 */
type Card = { text: string; presses: number; heardPresses: number };
type Steps = { steps: string[]; done: number };
type Report = { verdict: string; holding?: boolean };
type BoardData = Card | Steps | Report;

/** Reports held in this run of Mirador; one that says it's held but isn't here was held before a restart. */
const held = new Set<string>();

const newest = (context: CanvasPluginContext<BoardData>, type: string) => context.items().findLast((item) => item.type === type && !item.dismissed);

const host: CanvasHost<BoardData> = {
  items: {
    card: { icon: "▤", placement: "page" },
    report: {
      icon: "▥",
      placement: "page",
      opensWithRoom: true,
      outcome: (data) => (data as Report).verdict || undefined,
      listed: ({ id, data }) => ((data as Report).holding && !held.has(id) ? { ...(data as Report), holding: false } : data),
    },
    steps: { icon: "◔", placement: "tab", count: (data) => `${(data as Steps).done}/${(data as Steps).steps.length}` },
  },
  tools: {
    show_card: {
      description: "Show a card the user can press.",
      input: { type: "object", properties: { title: { type: "string", minLength: 1 }, text: { type: "string" } }, required: ["title", "text"] },
      run(input, { publish }) {
        const { title, text } = input as { title: string; text: string };
        return `Shown as ${publish({ type: "card", title, data: { text, presses: 0, heardPresses: 0 } }).id}.`;
      },
    },
    change_card: {
      description: "Change the text of the newest card.",
      onDemand: true,
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run(input, context) {
        const card = newest(context, "card");
        if (!card) throw new Error("There is no card to change; show one with show_card.");
        context.change(card.id, { data: { ...(card.data as Card), text: (input as { text: string }).text } });
        return "Changed.";
      },
    },
    show_report: {
      description: "Show a report with a verdict, which takes the room reviews take.",
      input: { type: "object", properties: { title: { type: "string" }, verdict: { type: "string" } }, required: ["title", "verdict"] },
      run(input, { publish }) {
        const { title, verdict } = input as { title: string; verdict: string };
        return `Shown as ${publish({ type: "report", title, data: { verdict } }).id}.`;
      },
    },
    change_verdict: {
      description: "Change the verdict of the newest report.",
      input: { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] },
      run(input, context) {
        const report = newest(context, "report");
        if (!report) throw new Error("There is no report; show one with show_report.");
        context.change(report.id, { data: { ...(report.data as Report), verdict: (input as { verdict: string }).verdict } });
        return "Changed.";
      },
    },
    track_steps: {
      description: "Track steps in the tab beside the canvas.",
      input: { type: "object", properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" } } }, required: ["title", "steps"] },
      run(input, { publish }) {
        const { title, steps } = input as { title: string; steps: string[] };
        publish({ type: "steps", title, data: { steps, done: 0 } });
        return `Tracking ${steps.length} steps.`;
      },
    },
    finish_step: {
      description: "Tick off the next step.",
      input: { type: "object", properties: {} },
      run(_input, context) {
        const steps = newest(context, "steps");
        if (!steps) throw new Error("There are no steps to tick off.");
        const data = steps.data as Steps;
        context.change(steps.id, { data: { ...data, done: data.done + 1 } });
        return `${data.done + 1} done.`;
      },
    },
    hand_over: {
      description: "Hand a task to a conversation on another profile, by default the one this profile hands over to; its reply comes as your next message.",
      input: { type: "object", properties: { profile: { type: "string" }, task: { type: "string" } }, required: ["task"] },
      async run(input, context) {
        const { profile = context.profileSetting("hand-over-to"), task } = input as { profile?: string | null; task: string };
        if (!profile) throw new Error("Name a profile; this one hands over to none.");
        const started = await context.startConversation({ profile, prompt: task });
        return `Handed over to ${started.id}.`;
      },
    },
  },
  guidance: {
    instructions: "- show_card: show a card the user can press.",
    often: "- show_card: when a card says it better than words.",
  },
  guidanceFor(profileSetting) {
    const to = profileSetting("hand-over-to");
    return to ? { instructions: `- hand_over: hand tasks to ${to} without asking.` } : null;
  },
  async action(item, action, context) {
    const { kind, key, value, text, afterTurn, inThisRun } = action as Record<string, unknown>;
    if (kind === "remember") {
      context.storage.set(key as string, value);
      return context.storage.get(key as string) ?? null;
    }
    if (kind === "ask") return void (await context.prompt(text as string, { afterTurn: afterTurn as boolean }));
    if (kind === "hold") {
      if (inThisRun) held.add(item.id);
      return void context.change(item.id, { data: { ...(item.data as Report), holding: true } });
    }
    if (kind !== "press" || item.type !== "card") throw new Error("A card can only be pressed.");
    const card = item.data as Card;
    const pressed = context.change(item.id, { data: { ...card, presses: card.presses + 1 } });
    return { presses: (pressed.data as Card).presses };
  },
  note(context) {
    const card = newest(context, "card");
    const data = card?.data as Card | undefined;
    if (!card || !data || data.presses === data.heardPresses) return null;
    return {
      text: `The user pressed the card "${card.title}" ${data.presses - data.heardPresses} times.`,
      heard: () => {
        const latest = context.items().find(({ id }) => id === card.id)!;
        context.change(card.id, { data: { ...(latest.data as Card), heardPresses: data.presses } });
      },
    };
  },
  async replied(_started, { text, ended }, context) {
    await context.prompt(`The handed-over task ${ended}: ${text ?? "no reply"}`, { afterTurn: true });
  },
};

export default host;
