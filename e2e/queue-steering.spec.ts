import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, eventsInOrderOn, lastAgentMessage, openSettings, pasteImage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });
const QUEUED = "Also, which colour fills [Image #1] - answer with the colour's name.";
const AFTER_TURN = "Reply after the turn.";
const keptOutLines = () => host.log.split("\n").filter((line) => line.includes("wait outside its running turn"));

test.describe.configure({ mode: "serial" });

// Claude Code refuses a foreground `sleep 30` in the command itself, so the long tool call runs a script that waits.
const SLOW_SCRIPT = "wait-then-print.sh";

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
  writeFileSync(join(host.projectDir, SLOW_SCRIPT), "sleep 30\necho slept\n");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a message sent with Enter while Claude Code runs a tool joins the turn once the tool finishes, with its image; one sent the other way waits for the turn to end", async ({ page }) => {
  const eventsInOrder = eventsInOrderOn(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const yolo = page.getByLabel("YOLO", { exact: true });
  await yolo.click();
  await expect(yolo).toBeChecked();
  await sendMessage(page, `RUN sh ${SLOW_SCRIPT}`);
  await expect(page.locator(".timeline").locator(".tool-pending, .tool-in_progress").filter({ has: page.locator(".shell-command", { hasText: SLOW_SCRIPT }) })).toBeVisible();

  const composer = page.locator(".composer textarea");
  await composer.fill("Also, which colour fills ");
  await pasteImage(composer, { width: 64, height: 64, color: "#e11d1d" });
  await page.keyboard.type("- answer with the colour's name.");
  await expect(composer).toHaveValue(QUEUED);
  await expect(page.locator(".pasted-images img")).toHaveJSProperty("naturalWidth", 64);
  await composer.press("Enter");
  await expect(page.locator(".queue .queued-text")).toHaveText([QUEUED]);
  await expect(page.locator(".queued-delivery")).toHaveText(["joins the turn"]);
  await test.step("the host log says once what keeps it out of the turn, naming the tool call by its id and kind rather than its command", async () => {
    await expect.poll(keptOutLines).toEqual([expect.stringMatching(/ wait outside its running turn: the agent's own tool call \S+ \(execute\) is still open$/)]);
  });

  await test.step("with Enter set to wait for the turn, Enter and the buttons swap roles", async () => {
    const settings = await openSettings(page, "Conversations");
    await settings.getByLabel("Enter").selectOption({ label: "Sends the message after the turn ends" });
    await settings.getByRole("button", { name: "Close" }).click();
    await composer.fill(AFTER_TURN);
    await expect(page.locator(".composer .queue-message")).toHaveText(["After turn", "Steer"]);
    const [message, buttons] = await Promise.all([composer.boundingBox(), page.locator(".composer-actions").boundingBox()]);
    expect(buttons!.y, "the buttons sit under the message").toBeGreaterThanOrEqual(message!.y + message!.height);
    expect(message!.width, "and leave the message the box's full width").toBeCloseTo(buttons!.width, 0);
    await expect(composer).toHaveAttribute("placeholder", /Enter sends your message after its turn/);
    await composer.press("Enter");
    const afterTurnTag = page.locator(".queued", { hasText: AFTER_TURN }).locator(".queued-delivery");
    await expect(afterTurnTag).toHaveText("after the turn");
    await afterTurnTag.click();
    await expect(afterTurnTag).toHaveText("joins the turn");
    await afterTurnTag.click();
    await expect(afterTurnTag).toHaveText("after the turn");
  });

  const userMessages = page.locator(".message.user");
  await expect(userMessages.filter({ hasText: QUEUED })).toHaveCount(1, { timeout: 60_000 });
  await expect(userMessages.last()).toHaveText(AFTER_TURN, { timeout: 120_000 });
  await expect(page.locator(".queue")).toHaveCount(0);
  await waitForTurnToEnd(page);
  await expect(page.locator(".message.agent", { hasText: "Answered: Also, which colour fills" })).toHaveCount(1);
  await expect(lastAgentMessage(page)).toHaveText(`Answered: ${AFTER_TURN}`);
  const [steeredRequest] = [...api.images].filter(([typed]) => typed.includes("Also, which colour fills"));
  expect(steeredRequest?.[1], "the image went to the model with the message that joined the turn").toEqual(["image/png"]);
  await expect(userMessages.filter({ hasText: QUEUED }).locator(".message-images img")).toHaveJSProperty("naturalWidth", 64);
  expect(eventsInOrder).toEqual([expect.stringContaining(SLOW_SCRIPT), QUEUED, "turn-end", AFTER_TURN, "turn-end"]);
  expect(keptOutLines(), "the message waiting for the turn to end is no stall to log").toHaveLength(1);
});

test("a message sent while Claude Code writes, with no tool running, joins the turn at once, and so does a waiting one switched to join it", async ({ page }) => {
  const eventsInOrder = eventsInOrderOn(page);
  await signIn(page, host);
  await page.goto(host.origin);
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  const userMessages = page.locator(".timeline .message.user");
  const story = (keeper: string) => `Tell a story about a lighthouse keeper called ${keeper}.`;
  const stopWith = (word: string) => `Stop the story there and reply with only the word ${word}.`;
  const startWriting = async (keeper: string) => {
    api.hold();
    await sendMessage(page, story(keeper));
    await expect.poll(() => api.held.includes(story(keeper))).toBe(true);
  };

  await test.step("sent with Enter", async () => {
    await startWriting("Ada");
    await composer.fill(stopWith("PINEAPPLE"));
    await composer.press("Enter");
    await expect(userMessages).toHaveText([story("Ada"), stopWith("PINEAPPLE")]);
    api.answerHeld();
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toContainText(stopWith("PINEAPPLE"));
  });

  await test.step("waiting for the turn to end, then switched to join it", async () => {
    await startWriting("Bo");
    await composer.fill(stopWith("MANGO"));
    await page.locator(".composer .queue-message", { hasText: "After turn" }).click();
    const delivery = page.locator(".queued", { hasText: stopWith("MANGO") }).locator(".queued-delivery");
    await expect(delivery).toHaveText("after the turn");
    await delivery.click();
    await expect(userMessages.last()).toHaveText(stopWith("MANGO"));
    api.answerHeld();
    await waitForTurnToEnd(page);
    await expect(lastAgentMessage(page)).toContainText(stopWith("MANGO"));
  });

  expect(eventsInOrder).toEqual([story("Ada"), stopWith("PINEAPPLE"), "turn-end", story("Bo"), stopWith("MANGO"), "turn-end"]);
});
