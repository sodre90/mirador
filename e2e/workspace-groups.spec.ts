import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, callCanvasTool, dragOnto, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const alphaDir = join(host.root, "alpha");
const betaDir = join(host.root, "beta");
const gammaDir = join(host.root, "gamma");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  [alphaDir, betaDir, gammaDir].forEach((directory) => mkdirSync(directory, { recursive: true }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const group = (page: Page, name: string) => page.locator(".workspace-group", { has: page.locator(".group-name", { hasText: new RegExp(`^${name}$`) }) });
const heading = (page: Page, name: string) => group(page, name).locator(":scope > header");
const workspaceHeader = (page: Page, directory: string) => workspaceCard(page, directory).locator(":scope > header");
const names = (cards: Locator) => cards.locator(".workspace-name").allTextContents();
const namesIn = (page: Page, groupName: string) => names(group(page, groupName).locator("section.workspace"));
const groupNames = (page: Page) => page.locator(".workspace-group .group-name").allTextContents();
/** The sidebar's rows that are in no group, from top to bottom: a workspace by its name, a group as [its name]. */
const topLevel = (page: Page) =>
  page
    .locator(".sidebar-scroll > section.workspace, .sidebar-scroll > section.workspace-group")
    .evaluateAll((sections) =>
      sections.map((section) =>
        section.classList.contains("workspace-group") ? `[${section.querySelector(".group-name")!.textContent}]` : section.querySelector(".workspace-name")!.textContent,
      ),
    );

async function newGroup(page: Page, name: string) {
  await page.getByRole("button", { name: "New group" }).click();
  const field = page.getByLabel("New group name");
  await field.fill(name);
  await field.press("Enter");
  await expect(group(page, name)).toBeVisible();
}

async function drop(page: Page, item: Locator, target: Locator, edge: "top" | "bottom") {
  await dragOnto(page, item, target, edge);
  await page.mouse.up();
}

async function startConversationIn(page: Page, directory: string) {
  const previousUrl = page.url();
  await workspaceCard(page, directory).getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function runFromPalette(page: Page, label: string) {
  await page.locator(".window-bar").getByRole("button", { name: /^Conversations and actions/ }).click();
  await page.getByPlaceholder(/Go to a conversation/).fill(label);
  await page.keyboard.press("Enter");
}

test("workspaces and groups share one order: workspaces gather in groups that fold, land between groups, and stay in place when their group goes", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, alphaDir);
  await addWorkspaceFromSidebar(page, betaDir);
  await addWorkspaceFromSidebar(page, gammaDir);

  await test.step("new workspaces and groups go first, a group named in place", async () => {
    expect(await topLevel(page)).toEqual(["gamma", "beta", "alpha"]);
    await newGroup(page, "Clients");
    await newGroup(page, "Own");
    expect(await topLevel(page)).toEqual(["[Own]", "[Clients]", "gamma", "beta", "alpha"]);
    await expect(heading(page, "Clients").locator(".group-name")).toHaveCSS("text-transform", "uppercase");
    await expect(heading(page, "Clients").locator(".group-count")).toHaveText("0");
    await expect(group(page, "Clients")).toContainText("Drag a workspace here by its heading");
  });

  await test.step("a workspace dragged by its heading low onto a group's heading goes last in it, indented, and onto a workspace's top edge, just before it", async () => {
    await drop(page, workspaceHeader(page, betaDir), heading(page, "Clients"), "bottom");
    await expect.poll(() => namesIn(page, "Clients")).toEqual(["beta"]);
    await expect(workspaceCard(page, betaDir)).toHaveCSS("margin-left", "12px");
    await dragOnto(page, workspaceHeader(page, alphaDir), workspaceCard(page, betaDir), "top");
    await expect(workspaceCard(page, betaDir)).toHaveClass(/drop-before/);
    await page.mouse.up();
    await expect.poll(() => namesIn(page, "Clients")).toEqual(["alpha", "beta"]);
    await drop(page, workspaceHeader(page, gammaDir), heading(page, "Own"), "bottom");
    await expect.poll(() => namesIn(page, "Own")).toEqual(["gamma"]);
    expect(await topLevel(page)).toEqual(["[Own]", "[Clients]"]);
    await expect(heading(page, "Clients").locator(".group-count")).toHaveText("2");
  });

  await test.step("a workspace dragged onto the top edge of a group's heading lands above the group, out of its own; below everything, last of all", async () => {
    await dragOnto(page, workspaceHeader(page, gammaDir), heading(page, "Clients"), "top");
    await expect(group(page, "Clients")).toHaveClass(/drop-before/);
    await page.mouse.up();
    await expect.poll(() => topLevel(page)).toEqual(["[Own]", "gamma", "[Clients]"]);
    await dragOnto(page, workspaceHeader(page, alphaDir), page.locator(".sidebar > footer"), "top");
    await expect(group(page, "Clients")).toHaveClass(/drop-after/);
    await page.mouse.up();
    await expect.poll(() => topLevel(page)).toEqual(["[Own]", "gamma", "[Clients]", "alpha"]);
    expect(await namesIn(page, "Clients")).toEqual(["beta"]);
  });

  await test.step("a folded group hides its workspaces, counts them and what waits in them, and stays folded in this browser only", async () => {
    const waiting = await startConversationIn(page, betaDir);
    await startConversationIn(page, gammaDir);
    await page.getByRole("button", { name: "Fold Clients" }).click();
    await expect(page.getByRole("button", { name: "Unfold Clients" })).toHaveAttribute("aria-expanded", "false");
    await expect(group(page, "Clients").locator("section.workspace")).toHaveCount(0);
    await expect(heading(page, "Clients").locator(".group-count")).toHaveText("1");
    void callCanvasTool(host, waiting, "ask", { question: "Which layout?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
    await expect(heading(page, "Clients").locator(".waiting-count")).toHaveText("1");
    await expect(heading(page, "Own").locator(".waiting-count")).toHaveCount(0);

    await page.reload();
    await expect(group(page, "Clients").locator("section.workspace")).toHaveCount(0);
    const otherBrowser = await browser.newContext();
    const otherPage = await otherBrowser.newPage();
    await signIn(otherPage, host);
    expect(await topLevel(otherPage)).toEqual(["[Own]", "gamma", "[Clients]", "alpha"]);
    expect(await namesIn(otherPage, "Clients")).toEqual(["beta"]);
    await otherBrowser.close();
  });

  await test.step("opening a conversation in a folded group unfolds it", async () => {
    await runFromPalette(page, "New conversation in beta");
    await expect(page.getByRole("button", { name: "Fold Clients" })).toHaveAttribute("aria-expanded", "true");
    expect(await namesIn(page, "Clients")).toEqual(["beta"]);
  });

  await test.step("a group is renamed in place, Esc keeping its name and clicking away saving the new one, and dragged by its heading above a workspace in none", async () => {
    const startRenaming = async () => {
      await heading(page, "Clients").hover();
      await heading(page, "Clients").getByRole("button", { name: "Rename group" }).click();
      return page.getByLabel("Group name", { exact: true });
    };
    const field = await startRenaming();
    await field.fill("Nobody");
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    expect(await groupNames(page)).toEqual(["Own", "Clients"]);
    await (await startRenaming()).fill("Customers");
    await page.locator(".sidebar h1").click();
    await expect(group(page, "Customers")).toBeVisible();
    await dragOnto(page, heading(page, "Customers"), workspaceCard(page, gammaDir), "top");
    await expect(workspaceCard(page, gammaDir)).toHaveClass(/drop-before/);
    await page.mouse.up();
    await expect.poll(() => topLevel(page)).toEqual(["[Own]", "[Customers]", "gamma", "alpha"]);
    await page.reload();
    expect(await topLevel(page)).toEqual(["[Own]", "[Customers]", "gamma", "alpha"]);
  });

  await test.step("deleting a group keeps its workspaces where it was", async () => {
    await drop(page, workspaceHeader(page, alphaDir), heading(page, "Customers"), "bottom");
    await expect.poll(() => namesIn(page, "Customers")).toEqual(["beta", "alpha"]);
    await heading(page, "Customers").hover();
    const remove = heading(page, "Customers").getByRole("button", { name: "Delete group" });
    await remove.click();
    await remove.click();
    await expect(group(page, "Customers")).toHaveCount(0);
    await expect.poll(() => topLevel(page)).toEqual(["[Own]", "beta", "alpha", "gamma"]);
  });
});

test("the palette makes a group and moves a workspace into one or out of its own, to just below it", async ({ page }) => {
  await signIn(page, host);
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("New group name").fill("Never");
  await page.getByLabel("New group name").press("Escape");
  await expect(page.getByLabel("New group name")).toHaveCount(0);
  expect(await groupNames(page)).toEqual(["Own"]);

  await runFromPalette(page, "New group");
  await page.getByLabel("New group name").fill("Later");
  await page.getByLabel("New group name").press("Enter");
  await expect(group(page, "Later")).toBeVisible();
  expect(await groupNames(page)).toEqual(["Later", "Own"]);

  await runFromPalette(page, "Move beta to group Later");
  await expect.poll(() => namesIn(page, "Later")).toEqual(["beta"]);
  await runFromPalette(page, "Move beta to group Own");
  await expect.poll(() => namesIn(page, "Own")).toEqual(["beta"]);
  await runFromPalette(page, "Take beta out of group Own");
  await expect.poll(() => topLevel(page)).toEqual(["[Later]", "[Own]", "beta", "alpha", "gamma"]);
});
