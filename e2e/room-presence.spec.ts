import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, inviteIntoRoom, joinRoom, nameMachine, nameOwnProfile, openRoomSettings, reachedAtOwnPort, roomCard, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

/** The owner's machine, with the room and its agent. */
const owners = new TestHost({ fakePrograms: true, environment: reachedAtOwnPort });
/** The invited person's own Mirador, which joins the owner's machine. */
const visitors = new TestHost();
const builderPrompts = () => join(owners.root, "builder-prompts");
const answerHeldUntil = () => join(owners.root, "answer-held-until");

test.beforeAll(async () => {
  writeBunProgram(owners.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  writeFileSync(builderPrompts(), "");
  await Promise.all([owners.start(), visitors.start()]);
});
test.afterAll(async () => {
  await Promise.all([owners.stop(), visitors.stop()]);
  await Promise.all([owners.cleanUp(), visitors.cleanUp()]);
});

const roomMessages = (page: Page | FrameLocator) => page.locator(".room-timeline .room-entry .message");
const hereCount = (page: Page | FrameLocator) => page.locator(".room-header .room-here-count");
const writingLine = (page: Page | FrameLocator) => page.locator(".room-timeline .room-writing");

/** The room's people as the page lists them, each "name, role, here" as far as the page knows them, then its agents. */
async function peopleListed(page: Page | FrameLocator) {
  await hereCount(page).click();
  const listed = page.getByRole("dialog", { name: "People in the room" });
  const rowsOf = (list: Locator) =>
    list.getByRole("listitem").evaluateAll((rows) =>
      rows.map((row) =>
        [row.querySelector(".person-name, span:not(.avatar)")?.textContent, row.querySelector(".room-role-label")?.textContent, row.querySelector(".room-here-mark")?.getAttribute("aria-label"), row.querySelector(".room-agent-working")?.textContent]
          .filter(Boolean)
          .join(", "),
      ),
    );
  const shown = { people: await rowsOf(listed.getByRole("list", { name: "People" })), agents: await rowsOf(listed.getByRole("list", { name: "Agents" })) };
  await hereCount(page).click();
  await expect(listed).toHaveCount(0);
  return shown;
}

async function tagBuilder(composer: Locator, agentsMenu: Locator, rest: string) {
  await composer.fill("@Bu");
  await agentsMenu.getByRole("option", { name: "@Builder" }).click();
  await composer.pressSequentially(rest);
  await composer.press("Enter");
}

test("the owner and a person in the room see who of them is here and who writes, and the owner reads what the room's agents took for whom", async ({ page, browser }) => {
  await signIn(page, owners);
  await nameOwnProfile(page, "Ann");
  const profiles = await createProfile(page, "Builder", `OPENCODE_FAKE_ACP_PROMPTS=${builderPrompts()}`, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await addWorkspace(page, owners.projectDir, "Builder · opencode");
  await nameMachine(page, "Ann's machine");
  const ownersComposer = page.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });

  const invite = await test.step("the owner makes a room and an invite into it for a member", async () => {
    await createRoom(page, "Garden", ["Builder"]);
    return inviteIntoRoom(page, "Garden", { role: "Member" });
  });

  await test.step("alone in the room, the owner is the one here", async () => {
    await expect(hereCount(page)).toHaveText("1 here");
    expect(await peopleListed(page)).toEqual({ people: ["Ann, Owner, Here now"], agents: ["Builder"] });
  });

  const visitor = await browser.newPage();
  await signIn(visitor, visitors);
  await nameOwnProfile(visitor, "Dora");
  const frame = visitor.frameLocator('iframe[title="Ann\'s machine"]');
  const rail = visitor.getByRole("navigation", { name: "Machines" });
  const visitorsComposer = frame.getByRole("textbox", { name: "Write in Garden, @ tags an agent…" });

  await test.step("the person joins the room from their own Mirador, which opens it", async () => {
    const join = await joinRoom(visitor, invite);
    await expect(join).toHaveCount(0);
    await expect(frame.getByRole("heading", { name: "# Garden" })).toBeVisible();
  });

  await test.step("each of them sees the other here while their page shows the room", async () => {
    await expect(hereCount(page)).toHaveText("2 here");
    await expect(hereCount(frame)).toHaveText("2 here");
    expect(await peopleListed(page)).toEqual({ people: ["Ann, Owner, Here now", "Dora, Member, Here now"], agents: ["Builder"] });
    expect(await peopleListed(frame)).toEqual({ people: ["Ann, Owner, Here now", "Dora, Member, Here now"], agents: ["Builder"] });
  });

  await test.step("the person is no longer here once their Mirador shows another machine, and is again when it shows the room", async () => {
    await rail.getByRole("button", { name: "This computer" }).click();
    await expect(hereCount(page)).toHaveText("1 here");
    expect((await peopleListed(page)).people).toEqual(["Ann, Owner, Here now", "Dora, Member"]);
    await rail.getByRole("button", { name: "Ann's machine" }).click();
    await expect(hereCount(page)).toHaveText("2 here");
  });

  await test.step("the owner is no longer here for the person while the owner's page shows another room, which the person learns nothing of", async () => {
    await createRoom(page, "Shed", []);
    await expect(hereCount(frame)).toHaveText("1 here");
    expect((await peopleListed(frame)).people).toEqual(["Ann, Owner", "Dora, Member, Here now"]);
    await expect(frame.locator(".sidebar .rooms .room-card-name")).toHaveText(["Garden"]);
    await roomCard(page, "Garden").click();
    await expect(hereCount(frame)).toHaveText("2 here");
  });

  await test.step("the other side reads who is writing, which clears once the message is sent, the box is emptied, or a few seconds after the last keystroke", async () => {
    await visitorsComposer.fill("Hello");
    await expect(writingLine(page)).toHaveText("Dora is writing…");
    await expect(writingLine(frame)).toHaveText("");
    await visitorsComposer.press("Enter");
    await expect(roomMessages(page)).toHaveText(["Hello"]);
    await expect(writingLine(page)).toHaveText("");

    await ownersComposer.fill("Planting today");
    await expect(writingLine(frame)).toHaveText("Ann is writing…");
    await ownersComposer.fill("");
    await expect(writingLine(frame)).toHaveText("");

    await ownersComposer.fill("Watering");
    await expect(writingLine(frame)).toHaveText("Ann is writing…");
    await expect(writingLine(frame)).toHaveText("", { timeout: 10_000 });
    await ownersComposer.fill("");
  });

  await test.step("the person's task, allowed by the owner, and the owner's own reach the agent, which shows as working while it answers", async () => {
    await tagBuilder(visitorsComposer, frame.getByRole("listbox", { name: "Agents and people of the room" }), "TOKENS 1200 300 0.05 SAY Seeds are in");
    await page.locator(".room-timeline ~ .room-approvals").getByRole("button", { name: "Allow", exact: true }).click();
    await expect(roomMessages(page).last()).toHaveText("Seeds are in");

    await tagBuilder(ownersComposer, page.getByRole("listbox", { name: "Agents and people of the room" }), `WAIT ${answerHeldUntil()} TOKENS 800 100 SAY Rows are dug`);
    await expect.poll(async () => (await peopleListed(frame)).agents).toEqual(["Builder, Working"]);
    writeFileSync(answerHeldUntil(), "");
    await expect(roomMessages(frame).last()).toHaveText("Rows are dug");
    expect((await peopleListed(page)).agents).toEqual(["Builder"]);
  });

  await test.step("someone writing in a thread shows as writing in that thread alone", async () => {
    await page.locator(".room-timeline .room-entry", { hasText: "Rows are dug" }).getByRole("button", { name: "Open thread" }).click();
    await frame.locator(".room-timeline .room-entry", { hasText: "Rows are dug" }).getByRole("button", { name: "Open thread" }).click();
    const ownersThread = page.getByRole("complementary", { name: "Thread of Builder" });
    const visitorsThread = frame.getByRole("complementary", { name: "Thread of Builder" });
    await ownersThread.getByRole("textbox", { name: "Follow up with Builder…" }).fill("And the beans?");
    await expect(visitorsThread.locator(".room-writing")).toHaveText("Ann is writing…");
    await expect(writingLine(frame)).toHaveText("");
    await ownersThread.getByRole("button", { name: "Close thread" }).click();
    await expect(visitorsThread.locator(".room-writing")).toHaveText("");
    await visitorsThread.getByRole("button", { name: "Close thread" }).click();
  });

  await test.step("the owner reads in the room's settings what the agent took, by agent and by the person whose message started each turn; the person sees no settings", async () => {
    const dialog = await openRoomSettings(page, "Garden", "Usage");
    const byAgent = dialog.getByRole("table", { name: "By agent" });
    const byPerson = dialog.getByRole("table", { name: "By person who asked" });
    const rows = (table: Locator) => table.locator("tbody tr, tfoot tr").evaluateAll((all) => all.map((row) => [...row.children].map((cell) => cell.textContent)));
    await expect(byAgent).toBeVisible();
    expect(await rows(byAgent)).toEqual([
      ["Builder", "2", "2k", "400", "0", "$0.05"],
      ["All agents", "2", "2k", "400", "0", "$0.05"],
    ]);
    expect(await rows(byPerson)).toEqual([
      ["Dora", "1", "1.2k", "300", "0", "$0.05"],
      ["Ann", "1", "800", "100", "0", "$0.00"],
    ]);
    await dialog.getByLabel("Period").selectOption({ label: "All time" });
    await expect(byAgent.locator("tbody tr").first()).toContainText("Builder");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(frame.getByRole("button", { name: "More for Garden" })).toHaveCount(0);
    await expect(frame.getByText("Usage")).toHaveCount(0);
  });

  await test.step("the owner sees the person leave at once as their Mirador's page closes", async () => {
    await visitor.close();
    await expect(hereCount(page)).toHaveText("1 here");
  });
});
