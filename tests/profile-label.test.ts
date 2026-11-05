import { expect, test } from "bun:test";
import { agentBesideProfile } from "../shared/profile-label.ts";

test("a profile named after its agent shows alone", () => {
  expect(agentBesideProfile("Claude Code", "claude")).toBeNull();
  expect(agentBesideProfile("claude-fast", "claude")).toBeNull();
  expect(agentBesideProfile("My Codex", "codex")).toBeNull();
  expect(agentBesideProfile("opencode", "opencode")).toBeNull();
});

test("a profile whose name doesn't say its agent shows the agent beside it", () => {
  expect(agentBesideProfile("fat-llm", "opencode")).toBe("opencode");
  expect(agentBesideProfile("Claude Qwen", "opencode")).toBe("opencode");
});

test("the agent's name counts only as a whole word, so a short one like pi isn't found inside another", () => {
  expect(agentBesideProfile("api tester", "pi")).toBe("pi");
  expect(agentBesideProfile("pi on the laptop", "pi")).toBeNull();
});

test("a conversation without its profile, deleted or never picked, shows the agent", () => {
  expect(agentBesideProfile(null, "claude")).toBe("Claude Code");
});
