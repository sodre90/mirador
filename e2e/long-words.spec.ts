import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const FLAGS = `--disable-features=${Array.from({ length: 40 }, (_, index) => `SomeChromiumFeature${index}`).join(",")}`;
const LINK = `https://example.com/${Array.from({ length: 40 }, (_, index) => `segment${index}`).join("/")}`;
const LONG_COMMAND = `docker exec -e DISPLAY=:99 mirador-desktop ${Array.from({ length: 30 }, (_, index) => `--option-${index}=value`).join(" ")}`;

const turn = [
  { type: "user-message", text: `he sent me this:\n  PID COMMAND\n11966 /opt/mirador/bin/bun ${FLAGS}` },
  {
    type: "acp",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `The page is ${LINK} and the command:\n\n\`\`\`\n${LONG_COMMAND}\n\`\`\`` } },
  },
  { type: "turn-end", stopReason: "end_turn" },
];

const scrollsSideways = (element: Locator) => element.evaluate((box) => box.scrollWidth > box.clientWidth);

test("a word too long for the chat breaks onto the next line, in a message and in a reply, while a code block keeps scrolling on its own", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(turn)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const message = page.locator(".message.user");
  const reply = page.locator(".message.agent");
  await expect(message).toContainText(FLAGS);
  await expect(reply).toContainText(LINK);

  expect(await scrollsSideways(page.locator(".timeline")), "the chat has no sideways scroll").toBe(false);
  expect(await scrollsSideways(message), "the message wraps its long word").toBe(false);
  expect(await scrollsSideways(reply.locator("p").first()), "the reply wraps its long word").toBe(false);
  expect(await scrollsSideways(reply.locator("pre")), "a long line of code still scrolls inside its block").toBe(true);
});
