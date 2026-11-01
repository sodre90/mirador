import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Conversation } from "../shared/model.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, bashPath, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { spawnProgram, TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
const mirador = resolve("bin/mirador");
/** What a script outside Git Bash runs: Windows runs no script without an extension, so there it is mirador.cmd. */
const miradorForScripts = process.platform === "win32" ? `${mirador}.cmd` : mirador;

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

function runMiradorMessage(args: string[]) {
  return new Promise<{ exitCode: number | null; stderr: string }>((settle) => {
    const environment = { ...process.env, MIRADOR_URL: host.origin, MIRADOR_SCRIPT_TOKEN: host.scriptToken };
    const script = spawnProgram(miradorForScripts, ["message", ...args], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    script.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    script.on("close", (exitCode) => settle({ exitCode, stderr }));
  });
}

const postMessage = (sessionId: string, body: string) =>
  fetch(`${host.origin}/sessions/${sessionId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${host.scriptToken}` }, body });

function recordAgentSessions(page: Page) {
  const sessionByConversation = new Map<string, string>();
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const conversation = (JSON.parse(String(payload)) as { conversation?: Conversation }).conversation;
      if (conversation?.acpSessionId) sessionByConversation.set(conversation.id, conversation.acpSessionId);
    }),
  );
  return sessionByConversation;
}

const messagesFromScripts = (page: Page) =>
  page.locator(".timeline-entry", { has: page.locator(".author", { hasText: "From a script" }) }).locator(".message.user");

const messagesFromMirador = (page: Page) =>
  page.locator(".timeline-entry", { has: page.locator(".author", { hasText: "From Mirador" }) }).locator(".message.user");

test("a script the agent starts, or anything with the agent's session, messages the conversation as the user would", async ({ page }) => {
  const sessionByConversation = recordAgentSessions(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const yolo = page.getByLabel("YOLO", { exact: true });
  await yolo.click();
  await expect(yolo).toBeChecked();

  await test.step("a command the agent runs reaches its own conversation, and the agent reads the message", async () => {
    await sendMessage(page, `RUN ${bashPath(mirador)} message "The build finished with 3 warnings."`);
    await expect(messagesFromScripts(page)).toHaveText(["The build finished with 3 warnings."]);
    await waitForTurnToEnd(page);
    expect(api.answered).toContain("The build finished with 3 warnings.");
  });

  const sessionId = sessionByConversation.get(conversationId)!;
  expect(sessionId).toBeTruthy();

  await test.step("while the agent is idle, a message for its session starts the next turn", async () => {
    expect(await runMiradorMessage(["--session", sessionId, "PONG"])).toEqual({ exitCode: 0, stderr: "" });
    await expect(messagesFromScripts(page)).toHaveCount(2);
    await expect(messagesFromScripts(page).last()).toHaveText("PONG");
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toHaveText("Answered: PONG");
  });

  await test.step("an unknown session, an empty message or one too long is refused with the reason", async () => {
    const unknown = await runMiradorMessage(["--session", "not-a-session", "hello"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("No Mirador conversation runs this agent session.");
    expect((await postMessage(sessionId, "  \n")).status).toBe(400);
    expect((await postMessage(sessionId, "x".repeat(64 * 1024 + 1))).status).toBe(413);
    await expect(messagesFromScripts(page)).toHaveCount(2);
  });

  await test.step("a script's turn whose reply stops at a step it announced is nudged on, until a reply ends otherwise", async () => {
    const nudges = messagesFromMirador(page).filter({ hasText: "your reply ended announcing a next step" });
    expect(await runMiradorMessage(["--session", sessionId, "Next I check the logs:"])).toEqual({ exitCode: 0, stderr: "" });
    await expect(nudges).toHaveCount(1);
    await expect(lastAgentMessage(page)).toHaveText(/^Answered: Continue where you left off/);
    await waitForTurnToEnd(page);
    await expect(nudges).toHaveCount(1);
  });
});
