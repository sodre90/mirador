import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, conversationSettings, createProfile, signIn, startConversation } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a conversation moved to an agent that has listed no commands stops suggesting those of the agent it left", async ({ page }) => {
  const guessesHeard: string[][] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"slash-commands.listed"')) return;
      const message = JSON.parse(frame);
      if (message.type === "slash-commands.listed") guessesHeard.push(message.commands.map(({ name }: { name: string }) => name));
    }),
  );
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Silent", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  const composer = page.locator(".composer:visible textarea");
  const menu = page.getByRole("listbox", { name: "Slash commands" });
  const command = (name: string) => menu.locator(".slash-command-name", { hasText: new RegExp(`^/${name}$`) });
  const suggestsClaudeCommands = async () => {
    await composer.fill("/");
    await expect(command("context")).toBeVisible({ timeout: 60_000 });
  };
  const suggestsClaudeCommandsGuessedFromAnotherConversation = async () => {
    const guessesBefore = guessesHeard.length;
    await suggestsClaudeCommands();
    await expect.poll(() => guessesHeard.slice(guessesBefore).some((names) => names.includes("context"))).toBe(true);
  };
  const moveToSilentAgent = async () => {
    await composer.fill("");
    await (await conversationSettings(page)).getByLabel("Profile", { exact: true }).selectOption({ label: "Silent · opencode" });
    await expect(page.locator(".chat-header:visible .conversation-settings-toggle")).toHaveAttribute("data-agent", "opencode");
  };
  const suggestsOnlyMiradorCommands = async () => {
    const guessesBefore = guessesHeard.length;
    await composer.fill("/");
    await expect.poll(() => guessesHeard.length).toBe(guessesBefore + 1);
    expect(guessesHeard.at(-1)).not.toContain("context");
    await expect(command("clear")).toBeVisible();
    await expect(command("context")).toHaveCount(0);
  };

  const beforeClaudeCodeLists = { withModels: false };
  await startConversation(page);
  await suggestsClaudeCommands();

  await test.step("from a conversation where Claude Code had listed its commands", async () => {
    await startConversation(page);
    await suggestsClaudeCommands();
    await moveToSilentAgent();
    await suggestsOnlyMiradorCommands();
  });

  await test.step("from a conversation showing the guess from another Claude Code conversation", async () => {
    await startConversation(page, beforeClaudeCodeLists);
    await suggestsClaudeCommandsGuessedFromAnotherConversation();
    await moveToSilentAgent();
    await suggestsOnlyMiradorCommands();
  });
});
