import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, createProfile, dragOnto, pickProfileIfAsked, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

/** A folder as the page shows it, with home as ~: Windows keeps the temporary folders, and so the project, under home. */
const withHomeAsTilde = (folder: string) => (folder.startsWith(homedir() + sep) ? `~${folder.slice(homedir().length)}` : folder);

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a workspace is a card: its folder under the name, new conversations on top, the agent on a chip", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const card = workspaceCard(page, host.projectDir);
  await expect(card.locator(".workspace-folder")).toHaveText(withHomeAsTilde(dirname(host.projectDir)));

  const first = await startConversation(page);
  const second = await startConversation(page);
  const rows = card.locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveClass(/selected/);
  await expect(page).toHaveURL(new RegExp(`#/c/${second}$`));
  await rows.last().click();
  await expect(page).toHaveURL(new RegExp(`#/c/${first}$`));

  const chip = card.locator(".agent-chip-label");
  await expect(chip).toHaveText("Claude Code");
  const profiles = await createProfile(page, "home llama", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await card.getByLabel("Agent").selectOption({ label: "home llama · opencode" });
  await expect(chip).toHaveText("home llama · opencode");
});

test("a workspace folds to its heading, by its chevron or its name, stays folded in this browser, and unfolds when one of its conversations opens", async ({ page }) => {
  const foldedDir = join(host.root, "foldable");
  const otherDir = join(host.root, "stays-open");
  [foldedDir, otherDir].forEach((directory) => mkdirSync(directory, { recursive: true }));
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, foldedDir);
  await addWorkspaceFromSidebar(page, otherDir);
  const name = basename(foldedDir);
  const card = workspaceCard(page, foldedDir);
  await card.getByRole("button", { name: "+ New conversation" }).click();
  await expect(card.locator("li")).toHaveCount(1);
  await workspaceCard(page, otherDir).getByRole("button", { name: "+ New conversation" }).click();
  await expect(workspaceCard(page, otherDir).locator("li")).toHaveCount(1);

  await card.getByRole("button", { name: `Fold ${name}` }).click();
  await expect(card.getByRole("button", { name: `Unfold ${name}` })).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("li")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "+ New conversation" })).toHaveCount(0);
  await expect(card.locator(".workspace-name")).toBeVisible();

  await card.locator(".workspace-name").click();
  await expect(card.getByRole("button", { name: `Fold ${name}` })).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("li")).toHaveCount(1);
  await card.locator(".workspace-name").click();
  await expect(card.locator("li")).toHaveCount(0);

  await page.reload();
  await expect(card.getByRole("button", { name: `Unfold ${name}` })).toBeVisible();
  await expect(card.locator("li")).toHaveCount(0);
  await expect(workspaceCard(page, otherDir).locator("li")).toHaveCount(1);

  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Palette/ })
    .click();
  await page.getByPlaceholder(/Go to a conversation/).fill(`New conversation in ${name}`);
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: `Fold ${name}` })).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("li")).toHaveCount(2);

  await test.step("picking the open conversation again unfolds its workspace", async () => {
    await card.locator("li.selected .conversation-title").dblclick();
    await page.getByLabel("Conversation name").fill("Folded away");
    await page.getByLabel("Conversation name").press("Enter");
    await card.getByRole("button", { name: `Fold ${name}` }).click();
    await expect(card.locator("li")).toHaveCount(0);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /^Palette/ })
      .click();
    await page.getByPlaceholder(/Go to a conversation/).fill("Folded away");
    await page.keyboard.press("Enter");
    await expect(card.locator("li")).toHaveCount(2);
  });
});

test("a folded workspace's tooltip offers to unfold it, it moves by its heading and stays folded, and its fold is forgotten once it is removed", async ({ page }) => {
  const movedDir = join(host.root, "moved-folded");
  const besideDir = join(host.root, "beside-it");
  [movedDir, besideDir].forEach((directory) => mkdirSync(directory, { recursive: true }));
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, movedDir);
  await addWorkspaceFromSidebar(page, besideDir);
  const name = basename(movedDir);
  const card = workspaceCard(page, movedDir);
  const besideCard = workspaceCard(page, besideDir);
  const workspaceId = (await card.getAttribute("data-reorder-id"))!;
  const cardOrder = () => page.locator("section.workspace").evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-label")));
  const foldedIds = () => page.evaluate(() => JSON.parse(localStorage.getItem("mirador-folded-workspaces") ?? "[]") as string[]);

  await expect(card.getByRole("button", { name: `Fold ${name}` })).toHaveAttribute("data-hint", /^Fold this workspace/);
  await card.getByRole("button", { name: `Fold ${name}` }).click();
  await expect(card.getByRole("button", { name: `Unfold ${name}` })).toHaveAttribute("data-hint", /^Show this workspace's conversations/);

  const before = await cardOrder();
  const movedWasFirst = before.indexOf(name) < before.indexOf(basename(besideDir));
  await dragOnto(page, card.locator(":scope > header"), besideCard, movedWasFirst ? "bottom" : "top");
  await page.mouse.up();
  await expect.poll(async () => (await cardOrder()).indexOf(name) < (await cardOrder()).indexOf(basename(besideDir))).toBe(!movedWasFirst);
  await expect(card.getByRole("button", { name: `Unfold ${name}` })).toHaveAttribute("aria-expanded", "false");

  expect(await foldedIds()).toContain(workspaceId);
  await card.hover();
  await card.getByRole("button", { name: "Remove workspace" }).click();
  await card.getByRole("button", { name: "Confirm: Remove workspace" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(foldedIds).not.toContain(workspaceId);
});

test("a workspace added while the page reconnects to the host is added once it has", async ({ page }) => {
  await signIn(page, host);
  await host.stop();
  await expect(page.locator(".banner")).toHaveText("Connection lost, reconnecting…");
  const directory = join(host.root, "added-offline");
  mkdirSync(directory, { recursive: true });
  await page.getByRole("button", { name: "Add workspace" }).click();
  const input = page.getByLabel("Workspace directory");
  await input.fill(directory);
  await input.press("Enter");
  await pickProfileIfAsked(page, directory);
  await host.start();
  await expect(workspaceCard(page, directory)).toBeVisible({ timeout: 30_000 });
});

test("a folder that is not there yet is made and added, in a folder that is", async ({ page }) => {
  const parent = join(host.root, "new-projects");
  mkdirSync(parent, { recursive: true });
  const directory = join(parent, "fresh");
  await signIn(page, host);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const input = page.getByLabel("Workspace directory");
  const hint = page.locator(".add-workspace .hint");

  await input.fill(directory);
  await expect(hint).toHaveText("Enter creates the folder and adds it, Esc cancels");
  await input.fill(join(parent, "missing", "fresh"));
  await expect(hint).toHaveText("Enter adds, Tab completes, Esc cancels");
  await input.fill(directory);
  await expect(hint).toHaveText("Enter creates the folder and adds it, Esc cancels");
  await input.press("Enter");
  await pickProfileIfAsked(page, directory);
  await expect(workspaceCard(page, directory)).toBeVisible();
  expect(statSync(directory).isDirectory()).toBe(true);
});

test("⇧Enter makes a new folder whose name begins a folder's that is there, which Enter would take", async ({ page }) => {
  const parent = join(host.root, "prefixes");
  mkdirSync(join(parent, "api-server"), { recursive: true });
  const directory = join(parent, "api");
  await signIn(page, host);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const input = page.getByLabel("Workspace directory");

  await input.fill(directory);
  await expect(page.locator(".add-workspace .completions li.highlighted")).toHaveText(`${parent}${sep}api-server/`);
  await expect(page.locator(".add-workspace .hint")).toHaveText("Enter or Tab takes the highlighted folder, ⇧Enter creates api, Esc cancels");
  await input.press("Shift+Enter");
  await pickProfileIfAsked(page, directory);
  await expect(workspaceCard(page, directory)).toBeVisible();
  expect(statSync(directory).isDirectory()).toBe(true);
});

test("a new folder whose name begins a folder's that is there is made by a click too, and ⇧Enter adds what is typed as it is", async ({ page }) => {
  const parent = join(host.root, "prefixes-by-click");
  mkdirSync(join(parent, "web-app"), { recursive: true });
  mkdirSync(join(parent, "webby"), { recursive: true });
  const directory = join(parent, "web");
  await signIn(page, host);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const input = page.getByLabel("Workspace directory");
  const newFolder = page.locator(".add-workspace .create-folder");

  await input.fill(join(parent, "webb"));
  await expect(page.locator(".add-workspace .completions li.highlighted")).toHaveText(`${parent}${sep}webby/`);
  await expect(newFolder).toHaveText("+ New folder webb");
  await input.fill(directory);
  await expect(page.locator(".add-workspace .completions li.highlighted")).toHaveText(`${parent}${sep}web-app/`);
  await newFolder.click();
  await pickProfileIfAsked(page, directory);
  await expect(workspaceCard(page, directory)).toBeVisible();
  expect(statSync(directory).isDirectory()).toBe(true);

  await page.getByRole("button", { name: "Add workspace" }).click();
  await input.fill(join(parent, "webby"));
  await expect(page.locator(".add-workspace .completions li")).toHaveCount(1);
  await input.press("ArrowDown");
  await expect(page.locator(".add-workspace .hint")).toHaveText("Enter or Tab takes the highlighted folder, ⇧Enter adds webby, Esc cancels");
  await expect(newFolder).toHaveCount(0);
  await input.press("Shift+Enter");
  await pickProfileIfAsked(page, join(parent, "webby"));
  await expect(workspaceCard(page, join(parent, "webby"))).toBeVisible();
});

test("Enter takes the highlighted folder while its name is being typed, and adds a path that names a folder", async ({ page }) => {
  const parent = join(host.root, "completions");
  ["alpha-one", "alpha-two", "beta"].forEach((name) => mkdirSync(join(parent, name), { recursive: true }));
  await signIn(page, host);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const input = page.getByLabel("Workspace directory");
  const highlighted = page.locator(".add-workspace .completions li.highlighted");

  await input.fill(`${parent}/alp`);
  await expect(highlighted).toHaveText(`${parent}/alpha-one/`);
  await expect(page.locator(".add-workspace .hint")).toHaveText("Enter or Tab takes the highlighted folder, ⇧Enter creates alp, Esc cancels");
  await input.press("Enter");
  await expect(input).toHaveValue(`${parent}/alpha-one/`);
  await expect(highlighted).toHaveCount(0);

  await input.fill(`${parent}/`);
  await expect(page.locator(".add-workspace .completions li")).toHaveCount(3);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await expect(highlighted).toHaveText(`${parent}/alpha-two/`);
  await input.press("Enter");
  await expect(input).toHaveValue(`${parent}/alpha-two/`);
  await expect(page.locator(".add-workspace .hint")).toHaveText("Enter adds, Tab completes, Esc cancels");
  await input.press("Enter");
  await pickProfileIfAsked(page, join(parent, "alpha-two"));
  await expect(workspaceCard(page, join(parent, "alpha-two"))).toBeVisible();
});
