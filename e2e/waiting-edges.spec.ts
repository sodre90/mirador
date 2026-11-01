import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, callCanvasTool, dragOnto, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const sideProjectDir = join(host.root, "side-project");

test.beforeAll(async () => {
  mkdirSync(sideProjectDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

async function startConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

test("a chip at the sidebar's edge shows conversations waiting for you out of view, and brings the nearest into view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (let started = 0; started < 18; started++) await startConversation(page);
  const sidebar = page.locator("nav.sidebar");
  const list = page.locator(".sidebar-scroll");
  const rows = workspaceCard(page, host.projectDir).locator("li");
  await expect(rows).toHaveCount(18);
  const firstId = (await rows.first().getAttribute("data-reorder-id"))!;
  const lastId = (await rows.last().getAttribute("data-reorder-id"))!;
  await rows.nth(5).click();
  const chipAbove = sidebar.getByRole("button", { name: /waiting for you above$/ });
  const chipBelow = sidebar.getByRole("button", { name: /waiting for you below$/ });

  await test.step("a conversation waiting below the view shows a chip at the bottom", async () => {
    await list.evaluate((element) => (element.scrollTop = 0));
    await expect(rows.last()).not.toBeInViewport();
    askInBackground(lastId, "Below?");
    await expect(chipBelow).toHaveText("↓ 1 waiting");
    await expect(chipBelow).toBeInViewport();
    await expect(chipBelow).toHaveClass(/tone-decision/);
    await expect(chipAbove).toHaveCount(0);
  });

  await test.step("clicking the chip brings that conversation into view, and the chip goes", async () => {
    await chipBelow.click();
    await expect(rows.last()).toBeInViewport();
    await expect(chipBelow).toHaveCount(0);
  });

  await test.step("a conversation waiting above the view shows a chip at the top that brings it into view", async () => {
    askInBackground(firstId, "Above?");
    await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(rows.first()).not.toBeInViewport();
    await expect(rows.last()).toBeInViewport();
    await expect(chipAbove).toHaveText("↑ 1 waiting");
    await expect(chipAbove).toBeInViewport();
    await chipAbove.click();
    await expect(rows.first()).toBeInViewport();
    await expect(chipAbove).toHaveCount(0);
  });

  await test.step("a folded group's heading out of view counts both conversations waiting in it, beside the first conversation still waiting", async () => {
    await list.evaluate((element) => (element.scrollTop = 0));
    await addWorkspaceFromSidebar(page, sideProjectDir);
    await page.getByRole("button", { name: "New group" }).click();
    await page.getByLabel("New group name").fill("Side");
    await page.getByLabel("New group name").press("Enter");
    const group = sidebar.locator(".workspace-group", { has: page.locator(".group-name", { hasText: /^Side$/ }) });
    const groupHeading = group.locator(":scope > header");
    await expect(groupHeading).toBeVisible();
    await dragOnto(page, workspaceCard(page, sideProjectDir).locator(":scope > header"), groupHeading, "bottom");
    await page.mouse.up();
    await expect(group.locator("section.workspace")).toHaveCount(1);
    const waitingInGroup = [await startConversationIn(page, sideProjectDir), await startConversationIn(page, sideProjectDir)];
    await rows.nth(5).click();
    await page.getByRole("button", { name: "Fold Side", exact: true }).click();
    await expect(group.locator("section.workspace")).toHaveCount(0);
    waitingInGroup.forEach((conversationId) => askInBackground(conversationId, "In the group?"));
    await expect(groupHeading.locator(".waiting-count")).toHaveText("2");
    await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(groupHeading).not.toBeInViewport();
    await expect(rows.first()).not.toBeInViewport();
    await expect(rows.last()).toBeInViewport();
    await expect(chipAbove).toHaveText("↑ 3 waiting");
  });

  await test.step("a folded workspace's heading out of view counts its conversations waiting, as a folded group's does", async () => {
    await list.evaluate((element) => (element.scrollTop = 0));
    await page.getByRole("button", { name: "Unfold Side", exact: true }).click();
    const sideCard = workspaceCard(page, sideProjectDir);
    await sideCard.getByRole("button", { name: "Fold side-project", exact: true }).click();
    await expect(sideCard.locator("li")).toHaveCount(0);
    await expect(sideCard.locator(":scope > header .waiting-count")).toHaveText("2");
    await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(sideCard).not.toBeInViewport();
    await expect(chipAbove).toHaveText("↑ 3 waiting");
  });

  await test.step("the footer's Settings… button stays in the viewport at both scroll ends", async () => {
    const settings = sidebar.getByRole("button", { name: "Settings…" });
    await list.evaluate((element) => (element.scrollTop = 0));
    await expect(settings).toBeInViewport();
    await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(settings).toBeInViewport();
  });
});
