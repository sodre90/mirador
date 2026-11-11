import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { currentActivity, OpenToolCalls } from "../host/activity.ts";

const started = (toolCallId: string, title: string): acp.SessionUpdate => ({ sessionUpdate: "tool_call", toolCallId, title, status: "in_progress" });
const updated = (toolCallId: string, change: Partial<acp.ToolCallUpdate>): acp.SessionUpdate => ({ sessionUpdate: "tool_call_update", toolCallId, ...change });

describe("OpenToolCalls", () => {
  test("knows the kind of tool each open call is, from its start or a later update, until it finishes", () => {
    const open = new OpenToolCalls();
    open.follow({ sessionUpdate: "tool_call", toolCallId: "edit", title: "Edit a.ts", kind: "edit", status: "pending" });
    open.follow(started("fetch", "Fetch"));
    open.follow(updated("fetch", { kind: "fetch" }));
    expect(open.kindOf("edit")).toBe("edit");
    expect(open.kindOf("fetch")).toBe("fetch");
    expect(open.kindOf("never-started")).toBeNull();
    open.follow(updated("edit", { status: "completed" }));
    expect(open.kindOf("edit")).toBeNull();
    open.follow(updated("unknown", { kind: "read" }));
    expect(open.kindOf("unknown")).toBeNull();
  });

  test("keeps the tool calls that have not finished, and says when an update finishes a tool call", () => {
    const open = new OpenToolCalls();
    expect(open.follow(started("read", "Read src/checkout.ts"))).toBe(false);
    expect(open.follow(started("run", "sleep 120"))).toBe(false);
    expect(open.latest()).toBe("sleep 120");
    expect(open.follow(updated("run", { status: "completed" }))).toBe(true);
    expect(open.latest()).toBe("Read src/checkout.ts");
    expect(open.follow(updated("read", { status: "in_progress" }))).toBe(false);
    expect(open.follow(updated("read", { status: "failed" }))).toBe(true);
    expect(open.size).toBe(0);
    expect(open.latest()).toBeNull();
  });

  test("names the tool calls still open, its subagents' among them", () => {
    const open = new OpenToolCalls();
    open.follow(started("read", "Read a.ts"));
    open.follow(started("run", "sleep 45"));
    open.follow(started("explore", "Find the tests"), true);
    open.follow(updated("read", { status: "completed" }));
    expect(open.ids()).toEqual(["run", "explore"]);
  });

  test("takes the title a later update gives, and ignores tool calls that start already finished", () => {
    const open = new OpenToolCalls();
    open.follow(started("run", "Terminal"));
    open.follow(updated("run", { title: "bun test", status: "in_progress" }));
    expect(open.latest()).toBe("bun test");
    open.follow({ sessionUpdate: "tool_call", toolCallId: "done", title: "Read README.md", status: "completed" });
    expect(open.latest()).toBe("bun test");
    open.follow(updated("unknown", { title: "Never started" }));
    expect(open.latest()).toBe("bun test");
  });

  test("tells the agent's own open calls from its subagents', also once a subagent's call updates without the subagent's mark", () => {
    const open = new OpenToolCalls();
    open.follow(started("launch", "Review the diff"));
    open.follow(started("subagent-run", "sleep 45"), true);
    open.follow(updated("subagent-run", { status: "in_progress" }));
    expect([open.size, open.oldestOfMainAgent()]).toEqual([2, "launch"]);
    open.follow(updated("launch", { status: "completed" }));
    expect([open.size, open.oldestOfMainAgent()]).toEqual([1, null]);
    open.follow(updated("subagent-run", { status: "completed" }));
    open.follow(started("subagent-run", "sleep 45 again"));
    expect([open.size, open.oldestOfMainAgent()]).toEqual([1, "subagent-run"]);
    open.clear();
    open.follow(started("subagent-read", "Read a.ts"), true);
    open.clear();
    open.follow(started("subagent-read", "Read a.ts"));
    expect(open.oldestOfMainAgent()).toBe("subagent-read");
  });

  test("of the agent's own open calls, names the one started first, also once a later one has started or it has updated", () => {
    const open = new OpenToolCalls();
    open.follow(started("left-open", "Bash"));
    open.follow(started("next", "Read a.ts"));
    open.follow(updated("left-open", { title: "bun test", kind: "execute" }));
    open.follow(started("next", "Read b.ts"));
    expect(open.oldestOfMainAgent()).toBe("left-open");
    open.follow(updated("left-open", { status: "failed" }));
    expect(open.oldestOfMainAgent()).toBe("next");
  });

  describe("a server tool call, such as the advisor's", () => {
    const advisor = (toolCallId: string): acp.SessionUpdate => ({ sessionUpdate: "tool_call", toolCallId, title: "advisor", kind: "other", status: "pending", _meta: { claudeCode: { toolName: "advisor" } } });
    const chunk = (sessionUpdate: "agent_message_chunk" | "agent_thought_chunk", _meta?: acp.SessionUpdate["_meta"]): acp.SessionUpdate => ({ sessionUpdate, content: { type: "text", text: "Next," }, ...(_meta && { _meta }) });

    test("whose reply was cut off ends when the agent asks again, as a finish, so a queued message is tried again", () => {
      const open = new OpenToolCalls();
      open.follow(advisor("srvtoolu_cut_off"));
      open.follow(updated("srvtoolu_cut_off", { rawInput: {} }));
      expect(open.oldestOfMainAgent()).toBe("srvtoolu_cut_off");
      expect(open.follow(advisor("srvtoolu_asked_again"))).toBe(true);
      expect(open.ids()).toEqual(["srvtoolu_asked_again"]);
      expect(open.follow(updated("srvtoolu_asked_again", { status: "completed" }))).toBe(true);
      open.follow(started("run", "Terminal"));
      expect(open.oldestOfMainAgent()).toBe("run");
    });

    test("left without its answer ends at the agent's next call, reply or thought", () => {
      const endsAt = (next: acp.SessionUpdate) => {
        const open = new OpenToolCalls();
        open.follow(started("run", "Terminal"));
        open.follow(advisor("srvtoolu_skipped"));
        open.follow(updated("run", { status: "completed" }));
        return [open.follow(next), open.ids()];
      };
      expect(endsAt(started("read", "Read a.ts"))).toEqual([true, ["read"]]);
      expect(endsAt(chunk("agent_message_chunk"))).toEqual([true, []]);
      expect(endsAt(chunk("agent_thought_chunk"))).toEqual([true, []]);
    });

    test("stays open while it runs, through notices, other calls' updates and its subagents' work, until its answer", () => {
      const open = new OpenToolCalls();
      open.follow(started("background", "bun test"));
      open.follow(advisor("srvtoolu_running"));
      expect(open.follow(chunk("agent_message_chunk", { claudeCode: { kind: "informational" } }))).toBe(false);
      expect(open.follow({ sessionUpdate: "plan", entries: [] })).toBe(false);
      expect(open.follow(updated("background", { status: "completed" }))).toBe(true);
      expect(open.follow(started("subagent-read", "Read a.ts"), true)).toBe(false);
      expect(open.follow(chunk("agent_message_chunk"), true)).toBe(false);
      expect(open.follow(advisor("srvtoolu_running"))).toBe(false);
      expect(open.oldestOfMainAgent()).toBe("srvtoolu_running");
      expect(open.follow(updated("srvtoolu_running", { status: "completed" }))).toBe(true);
      expect(open.ids()).toEqual(["subagent-read"]);
    });

    test("of a subagent is not ended by the agent's own next step", () => {
      const open = new OpenToolCalls();
      open.follow(advisor("srvtoolu_of_subagent"), true);
      expect(open.follow(chunk("agent_message_chunk"))).toBe(false);
      expect(open.ids()).toEqual(["srvtoolu_of_subagent"]);
    });
  });
});

describe("currentActivity", () => {
  test("a tool waiting for permission comes first, then the tool call started last, and nothing once all have finished", () => {
    const open = new OpenToolCalls();
    expect(currentActivity(open, [])).toBeNull();
    open.follow(started("run", "sleep 120"));
    expect(currentActivity(open, [])).toEqual({ kind: "tool", title: "sleep 120" });
    expect(currentActivity(open, ["rm -rf build", "git push"])).toEqual({ kind: "permission", title: "git push" });
  });
});
