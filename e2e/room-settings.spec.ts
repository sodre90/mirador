import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openRoomAgent, openRoomSettings, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

const GIVEN_VALUES = Array.from({ length: 24 }, (_, index) => `OPENAI_SETTING_${index + 1}`);
const AGENTS = ["Full of values", "Reviewer", "Tester"];

test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const environments = { "Full of values": ["DEPLOY_TOKEN=kept", ...GIVEN_VALUES.map((name) => `${name}=1`)].join("\n"), Reviewer: "", Tester: "", Latecomer: "" };
  for (const [name, environment] of Object.entries(environments)) {
    const profiles = await createProfile(page, name, environment, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const PAGES = ["General", "People", "Agents", "Permissions", "Usage"] as const;

const agentNames = (settings: Locator) => settings.getByRole("list", { name: "Agents", exact: true }).locator(".room-settings-agent-name");

const bottomOf = async (locator: Locator) => {
  const { y, height } = (await locator.boundingBox())!;
  return y + height;
};

test("a room's settings keep one size on every page, are gone through with the arrow keys, and close on Esc or their ×", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Pages", ["Reviewer"]);
  const settings = await openRoomSettings(page, "Pages");
  await expect(settings.getByRole("tab")).toHaveText([...PAGES]);
  await expect(settings.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
  const size = await settings.boundingBox();
  for (const name of PAGES) {
    await settings.getByRole("tab", { name }).click();
    await expect(settings.getByRole("tabpanel", { name })).toBeVisible();
    expect(await settings.boundingBox()).toEqual(size);
  }
  await settings.getByRole("tab", { name: "Usage" }).press("ArrowDown");
  await expect(settings.getByRole("tab", { name: "General" })).toBeFocused();
  await expect(settings.getByRole("tabpanel", { name: "General" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await openRoomSettings(page, "Pages");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
});

test("a room is renamed on its General page", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Before", ["Reviewer"]);
  const settings = await openRoomSettings(page, "Before", "General");
  await settings.getByRole("textbox", { name: "Room name" }).fill("After");
  await settings.getByRole("textbox", { name: "Room name" }).press("Enter");
  await expect(page.getByRole("heading", { name: "# After" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Settings of After" })).toBeVisible();
});

test("an agent's many values open on its own page, held back first, and leave the list of agents as short as it was", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page, host);
  await createRoom(page, "Short", AGENTS);
  const settings = await openRoomSettings(page, "Short", "Agents");
  const agents = settings.getByRole("list", { name: "Agents", exact: true });

  await test.step("every agent is one row of the list, all of them in view", async () => {
    await expect(agentNames(settings)).toHaveText(AGENTS);
    await expect(agents.getByRole("listitem").first()).toContainText("24 of 25 profile values");
    expect(await bottomOf(agents)).toBeLessThan(await bottomOf(settings));
    await expect(agents.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  });

  await test.step("its page shows the value held back, and the given ones once their line is opened", async () => {
    await openRoomAgent(settings, "Full of values");
    await expect(agents).toHaveCount(0);
    const heldSwitch = settings.getByRole("list", { name: "Values held back from Full of values" }).getByRole("switch");
    await expect(heldSwitch).toHaveCount(1);
    expect(await heldSwitch.evaluate((element) => {
      const style = getComputedStyle(element);
      return { appearance: style.appearance, width: style.width, height: style.height, radius: style.borderRadius };
    })).toEqual({ appearance: "none", width: "36px", height: "20px", radius: "99px" });
    const given = settings.getByRole("list", { name: "Values Full of values gets from its profile" });
    await expect(given).toBeHidden();
    await settings.getByText("Given (24)").click();
    await expect(given.getByRole("switch")).toHaveCount(24);
    const size = (await settings.boundingBox())!;
    expect(size.y + size.height).toBeLessThanOrEqual(800);
    await expect(settings.getByRole("button", { name: "Remove Full of values" })).toBeInViewport();
  });

  await test.step("going back leaves the keyboard on the agent left, and the Agents page leads back to the list too", async () => {
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Settings of Full of values" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(settings.getByRole("heading", { name: "Full of values" })).toBeVisible();
    await settings.getByRole("tab", { name: "Agents" }).click();
    await expect(agentNames(settings)).toHaveText(AGENTS);
  });
});

test("a change that starts an agent afresh asks for a yes in view, wherever its long list of values is scrolled to", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page, host);
  await createRoom(page, "Asking", ["Full of values"]);
  const composer = page.getByRole("textbox", { name: "Write in Asking, @ tags an agent…" });
  await composer.fill("@Full");
  await page.getByRole("listbox", { name: "Agents and people of the room" }).getByRole("option", { name: "@Full of values" }).click();
  await composer.fill("@Full of values SAY Here");
  await composer.press("Enter");
  await expect(page.locator(".room-timeline .room-entry .message.agent", { hasText: "Here" })).toBeVisible();

  const settings = await openRoomSettings(page, "Asking", "Agents");
  await openRoomAgent(settings, "Full of values");
  await settings.getByText("Given (24)").click();
  await settings.getByRole("switch", { name: "OPENAI_SETTING_1", exact: true }).uncheck();
  const warning = settings.getByRole("alert");
  await expect(warning).toContainText("Full of values stops any turn under way, starts afresh and reads the room again, once.");
  await expect(settings.getByRole("switch", { name: "Everything from this computer's environment" })).not.toBeInViewport();
  await expect(warning.getByRole("button", { name: "Change" })).toBeInViewport({ ratio: 1 });
  expect(await bottomOf(warning)).toBeLessThanOrEqual(await bottomOf(settings));
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(settings.getByRole("switch", { name: "OPENAI_SETTING_1", exact: true })).toBeChecked();
});

test("Add an agent opens a box to find one by name, which Esc puts away, and an agent is removed on its own page", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Adding", ["Reviewer"]);
  const settings = await openRoomSettings(page, "Adding", "Agents");
  const search = settings.getByRole("combobox", { name: "Add an agent" });

  await settings.getByRole("button", { name: "Add an agent" }).click();
  await expect(search).toBeFocused();
  await expect(settings.getByRole("option", { name: "Latecomer" })).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(settings).toBeVisible();

  await settings.getByRole("button", { name: "Add an agent" }).click();
  await search.fill("late");
  await search.press("Enter");
  await expect(agentNames(settings)).toHaveText(["Reviewer", "Latecomer"]);
  await expect(search).toHaveCount(0);

  await openRoomAgent(settings, "Latecomer");
  await settings.getByRole("button", { name: "Remove Latecomer" }).click();
  await settings.getByRole("button", { name: "Confirm: Remove Latecomer" }).click();
  await expect(agentNames(settings)).toHaveText(["Reviewer"]);
});

test("in a narrow window the pages lie over what they show, and nothing runs out of the dialog", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Narrow", AGENTS);
  const settings = await openRoomSettings(page, "Narrow");
  await page.setViewportSize({ width: 460, height: 720 });
  for (const name of PAGES) {
    await settings.getByRole("tab", { name }).click();
    const panel = settings.getByRole("tabpanel", { name });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    const { x, width } = (await settings.boundingBox())!;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(460);
  }
});
