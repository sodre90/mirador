import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import {
  ScriptedModel,
  antigravityProgram,
  codexProgram,
  copilotProgram,
  forgetPiAcpSessionsUnder,
  piProgram,
  scriptedAntigravityEnvironment,
  scriptedCodexEnvironment,
  scriptedCopilotEnvironment,
  scriptedOpencodeEnvironment,
  scriptedPiEnvironment,
} from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const gateway = new FakeGateway();
let page: Page;

const PROBE_SERVER = "reload-probe";
const PROBE_TOOL = "reload_probe";
const PROBE_TOOL_DESCRIPTION = "Says that the agent picked up the reload-probe MCP server";
const probeArguments = [join(import.meta.dirname, "probe-mcp-server.ts")];

test.beforeAll(async ({ browser }) => {
  await Promise.all([model.start(), gateway.start()]);
  await host.start();
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
});
test.afterAll(async () => {
  await page.close();
  if (process.platform !== "win32") spawnSync("pkill", ["-f", join(host.root, "codex-home")]);
  await host.stop();
  forgetPiAcpSessionsUnder(realpathSync(host.root));
  forgetPiAcpSessionsUnder(host.root);
  await host.cleanUp();
  model.stop();
  gateway.stop();
});

/**
 * Offered as a tool of its own, or by opencode 2 in its Code Mode catalog: in the instructions of a session that starts
 * with it, or in a note among the user's messages of one that goes on with a catalog changed since. Antigravity lists the
 * server and its tools under its own name in its instructions, without their descriptions.
 */
const probeOffered = () =>
  model.toolDescription(PROBE_TOOL) === PROBE_TOOL_DESCRIPTION ||
  [model.systemPromptInContext(), ...model.userMessagesInContext()].some((text) => text.includes(PROBE_TOOL_DESCRIPTION) || text.includes(`# ${PROBE_SERVER}`));

const reloadedNotices = () => page.locator(".timeline:visible .notice-line", { hasText: "Agent reloaded" });

/** A conversation on a new profile of `agent`; Copilot on a bring-your-own-key provider offers no model choice to wait for. */
async function startOnNewProfile(profile: string, environment: string, agent: string) {
  const dialog = await createProfile(page, profile, environment, "", agent);
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · ${agent}` });
  await startConversation(page, { withModels: agent !== "Copilot" });
}

async function reload() {
  const composer = page.locator(".composer:visible textarea");
  await composer.fill("/reload");
  await composer.press("Enter");
  await expect(reloadedNotices()).toHaveCount(1);
  await waitForTurnToEnd(page);
}

/** The agent works on a message, gets the probe server in its settings, and is offered its tool only once it reloads, in the session it had. */
async function expectReloadToPickUpAddedServer(agent: string, environment: string, addServer: () => void) {
  await startOnNewProfile(`scripted ${agent}`, environment, agent);
  await sendMessage(page, `before the reload, on ${agent}`);
  await waitForTurnToEnd(page);
  expect(probeOffered()).toBe(false);

  addServer();
  await reload();
  await sendMessage(page, `after the reload, on ${agent}`);
  await waitForTurnToEnd(page);
  expect(probeOffered()).toBe(true);
  expect(model.userMessagesInContext().join("\n")).toContain(`before the reload, on ${agent}`);
  await expect(page.locator(".timeline:visible")).not.toContainText("Could not resume");
}

test("/reload has Claude Code pick up an MCP server added with claude mcp add, in the same session", async () => {
  await startOnNewProfile("fake gateway", gatewayEnvironment(gateway), "Claude Code");
  const listsProbe = async (expected: boolean) => {
    // The space keeps the slash menu from writing /mcp out with its hint, so Enter sends it.
    await sendMessage(page, "/mcp ");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toContainText("MCP servers");
    if (expected) await expect(lastAgentMessage(page)).toContainText(PROBE_SERVER);
    else await expect(lastAgentMessage(page)).not.toContainText(PROBE_SERVER);
  };
  await listsProbe(false);

  execFileSync("claude", ["mcp", "add", "--scope", "user", PROBE_SERVER, "--", "bun", ...probeArguments], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: host.claudeConfigDir },
    shell: process.platform === "win32",
  });
  await listsProbe(false);

  await test.step("the slash menu offers /reload before Claude Code's /reload-plugins and /reload-skills", async () => {
    const composer = page.locator(".composer:visible textarea");
    await composer.fill("/rel");
    await expect(page.getByRole("listbox", { name: "Slash commands" }).locator('[aria-selected="true"] .slash-command-name')).toHaveText("/reload");
    await composer.press("Enter");
    await expect(reloadedNotices()).toHaveCount(1);
    await waitForTurnToEnd(page);
  });
  await listsProbe(true);
  await expect(page.locator(".timeline:visible")).not.toContainText("Could not resume");
});

test("/reload has opencode pick up an MCP server added to its opencode.json, restarting its agent", async () => {
  await expectReloadToPickUpAddedServer("opencode", scriptedOpencodeEnvironment(model, host.root), () => {
    const configFolder = join(host.root, "opencode-config", "opencode");
    mkdirSync(configFolder, { recursive: true });
    writeFileSync(join(configFolder, "opencode.json"), JSON.stringify({ mcp: { servers: { [PROBE_SERVER]: { type: "local", command: ["bun", ...probeArguments] } } } }));
  });
});

test("/reload has pi pick up an MCP server added to its mcp.json", async () => {
  test.skip(piProgram() === null, "pi is not installed");
  await expectReloadToPickUpAddedServer("pi", scriptedPiEnvironment(model, host.root), () =>
    writeFileSync(join(host.root, "pi-agent", "mcp.json"), JSON.stringify({ mcpServers: { [PROBE_SERVER]: { command: "bun", args: probeArguments, exposure: "direct" } } })),
  );
});

test("/reload has Antigravity pick up an MCP server added to its mcp_config.json", async () => {
  test.skip(antigravityProgram() === null, "Antigravity e2e runs only where the Antigravity CLI, agy, is installed");
  await expectReloadToPickUpAddedServer("Antigravity", scriptedAntigravityEnvironment(model, host.root), () => {
    const configFolder = join(host.root, "antigravity-home", ".gemini", "config");
    mkdirSync(configFolder, { recursive: true });
    writeFileSync(join(configFolder, "mcp_config.json"), JSON.stringify({ mcpServers: { [PROBE_SERVER]: { command: "bun", args: probeArguments, disabled: false } } }));
  });
});

test("/reload has Codex pick up an MCP server added to its config.toml", async () => {
  test.skip(process.env.MIRADOR_E2E_CODEX !== "1" || codexProgram() === null, "Codex e2e runs only with MIRADOR_E2E_CODEX=1 and codex installed");
  await expectReloadToPickUpAddedServer("Codex", scriptedCodexEnvironment(model, host.root), () =>
    appendFileSync(join(host.root, "codex-home", "config.toml"), `\n[mcp_servers.${PROBE_SERVER}]\ncommand = "bun"\nargs = ${JSON.stringify(probeArguments)}\n`),
  );
});

test("/reload has Copilot pick up an MCP server added to its mcp-config.json", async () => {
  test.skip(copilotProgram() === null, "Copilot e2e runs only where the Copilot CLI is installed");
  await expectReloadToPickUpAddedServer("Copilot", scriptedCopilotEnvironment(model, host.root), () =>
    writeFileSync(
      join(host.root, "copilot-home", "mcp-config.json"),
      JSON.stringify({ mcpServers: { [PROBE_SERVER]: { type: "local", command: "bun", args: probeArguments, tools: ["*"] } } }),
    ),
  );
});
