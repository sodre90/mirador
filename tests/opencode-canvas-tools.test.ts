import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launchEnvironment } from "../host/acp/harnesses.ts";
import type { Profile } from "../shared/model.ts";

const profileWith = (environment: string) => ({ name: "Work", environment }) as Profile;
const opencodeConfigOf = (profile: Profile | null) => JSON.parse(launchEnvironment("opencode", profile, "").OPENCODE_CONFIG_CONTENT!);

test("an opencode agent loads the plugin that gives it the canvas tools themselves, after the profile's own plugins", () => {
  const canvasTools = opencodeConfigOf(null).plugins.at(-1);
  expect(canvasTools.options).toEqual({ server: "canvas" });
  expect(existsSync(join(canvasTools.package, "index.ts"))).toBe(true);

  const profile = profileWith(`OPENCODE_CONFIG_CONTENT='{"model":"work/large","plugins":["their-plugin"]}'`);
  expect(opencodeConfigOf(profile)).toEqual({ model: "work/large", plugins: ["their-plugin", canvasTools] });
});

test("a configuration that is not plain JSON reaches opencode as it is, and Claude Code's agent gets no plugin", () => {
  const unchanged = (harness: "claude" | "opencode", config: string) =>
    launchEnvironment(harness, profileWith(`CLAUDE_CODE_EXECUTABLE=/opt/work/claude\nOPENCODE_CONFIG_CONTENT='${config}'`), "").OPENCODE_CONFIG_CONTENT;
  expect(unchanged("opencode", `{"model":"work/large",}`)).toBe(`{"model":"work/large",}`);
  expect(unchanged("opencode", `{"plugins":"their-plugin"}`)).toBe(`{"plugins":"their-plugin"}`);
  expect(unchanged("opencode", `["not","an","object"]`)).toBe(`["not","an","object"]`);
  expect(unchanged("claude", `{"model":"work/large"}`)).toBe(`{"model":"work/large"}`);
});
