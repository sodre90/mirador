import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addWorkspace, openCanvasHistory, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/**
 * vcs-60h.9: do agents reach for the canvas without being told? Opt-in (MIRADOR_EXPERIMENT=1) because it
 * runs real turns on the chosen model, e.g. MIRADOR_TEST_MODEL=default MIRADOR_TEST_EFFORT=default.
 */
const prompts = [
  "Explain how a request flows through a typical web app that has a CDN, a load balancer, several app servers, a cache and a database.",
  "I want to add a settings page to my web app. Should it use tabs or one long page with sections? Help me decide.",
  "Compare three ways to manage state in a mid-sized React app and recommend one.",
];

test.skip(!process.env.MIRADOR_EXPERIMENT, "set MIRADOR_EXPERIMENT=1 to run the unprompted-use experiment");
test.setTimeout(30 * 60_000);

test("records whether the agent uses show/ask when nobody asks it to", async ({ page }) => {
  const host = new TestHost({ usesClaudeLogin: true });
  await host.start();
  const results: { prompt: string; toolCalls: string[]; canvasItems: string[]; errors: string[] }[] = [];
  page.on("websocket", (socket) => socket.on("close", () => console.log(`${new Date().toISOString()} browser saw close of ${socket.url()}`)));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.log(`${new Date().toISOString()} page ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`${new Date().toISOString()} page error: ${error.message}`));
  page.on("framenavigated", (frame) => frame === page.mainFrame() && console.log(`${new Date().toISOString()} navigated ${frame.url()}`));
  try {
    await signIn(page, host);
    await addWorkspace(page, host.projectDir);
    for (const prompt of prompts) {
      await startConversation(page);
      await sendMessage(page, prompt);
      await answerQuestionsUntilIdle(page);
      results.push({
        prompt,
        toolCalls: await page.locator(".tool-title, .shell .shell-typed").allInnerTexts(),
        canvasItems: await canvasTitles(page),
        errors: [...(await page.locator(".error-line").allInnerTexts()), ...(await page.locator(".status-detail").allInnerTexts())],
      });
    }
  } finally {
    await host.stop();
    await host.cleanUp();
    writeFileSync("test-results/unprompted-experiment.json", JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
});

async function answerQuestionsUntilIdle(page: import("@playwright/test").Page) {
  const badge = page.locator(".chat-header .badge");
  const firstOption = page.locator(".ask-option input[type=radio]:enabled").first();
  const deadline = Date.now() + 10 * 60_000;
  await expect(badge).not.toHaveText("idle", { timeout: 30_000 });
  while (Date.now() < deadline) {
    if (await firstOption.isVisible()) {
      await firstOption.check();
      await page.locator(".ask").getByRole("button", { name: "Submit" }).click();
    }
    if (["idle", "error"].includes(await badge.innerText())) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("turn did not finish in 10 minutes");
}

async function canvasTitles(page: import("@playwright/test").Page) {
  if ((await page.locator(".history-toggle:visible").isDisabled())) return [];
  return (await openCanvasHistory(page)).locator(".entry-title").allInnerTexts();
}
