import type { CanvasHost, StatuslineChip } from "../../../../shared/canvas-plugins.ts";

/** A meter on a stand-in gateway: its chips say what the conversation's profile set, and its session chip takes the place of the agent's cost. */
const meter: CanvasHost = {
  items: {},
  tools: {},
  statusline(context) {
    if (context.profileSetting("metered") !== "on") return [];
    const chips: StatuslineChip[] = [{ text: "⏱", hint: `Meter at ${context.profileSetting("url") ?? "nowhere"}` }];
    if (context.profileSetting("show-total") === "on") chips.push({ text: `Total ${context.profileSetting("tier")}`, level: "warn", stale: true });
    chips.push({
      text: "Session $1.25",
      hint: `Session ${context.sessionId ?? "not started"} of ${context.conversationTitle}`,
      cost: { amount: 1.25, currency: "USD" },
      opensWindow: { action: { show: context.conversationTitle } },
    });
    return chips;
  },
  checkProfile(setting) {
    const url = setting("url");
    if (!url) throw new Error("Give the meter's URL.");
    return `Reached ${url} with a key ending ${setting("key")?.slice(-4) ?? "nowhere"}`;
  },
  window: {
    state: (context) => ({ showing: context.storage.get("showing") ?? null, metered: context.profiles().filter(({ name }) => context.settingOfProfile(name, "metered") === "on").map(({ name }) => name) }),
    action(action, context) {
      context.storage.set("showing", (action as { show?: unknown }).show ?? null);
      context.windowChanged();
      return null;
    },
  },
};

export default meter;
