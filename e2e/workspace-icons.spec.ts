import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, addWorkspaceFromSidebar, chooseInSettings, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const shopDir = join(host.root, "web-shop");
const plainDir = join(host.root, "plain-notes");
const hostileDir = join(host.root, "hostile-clone");
const brokenDir = join(host.root, "broken-icon");
const filteredDir = join(host.root, "drop-shadow");
const tracedDir = join(host.root, "traced-logo");

const square = (colour: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${colour}"/></svg>`;

/** Were its filter drawn, it would be blue all over. */
const filteredYellowSquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><filter id="s"><feFlood flood-color="rgb(0, 0, 255)"/></filter></defs><rect width="24" height="24" fill="rgb(255, 255, 0)" filter="url(#s)"/></svg>`;

const tracedMagentaSquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="rgb(255, 0, 255)" d="M0 0h24v24H0z${"M6 6h.1v.1z".repeat(14_000)}"/></svg>`;

/** Drawn at 24 pixels it takes a browser minutes, on the page's own thread. */
const fanOut = `<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="l0"><rect width="1" height="1"/></g>${[1, 2, 3, 4, 5, 6, 7]
  .map((level) => `<g id="l${level}">${`<use href="#l${level - 1}"/>`.repeat(10)}</g>`)
  .join("")}</defs><use href="#l7"/></svg>`;

const pngSaying64PixelsWithNoPicture = Buffer.from("89504e470d0a1a0a0000000d49484452000000400000004008060000000000000000", "hex");

function write(directory: string, path: string, content: string | Buffer) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), content);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  [shopDir, plainDir, hostileDir, brokenDir, filteredDir, tracedDir].forEach((directory) => mkdirSync(directory, { recursive: true }));
  write(shopDir, "public/favicon.svg", square("rgb(255, 0, 0)"));
  write(hostileDir, ".idea/icon.svg", fanOut);
  write(brokenDir, ".mirador/icon.png", pngSaying64PixelsWithNoPicture);
  write(filteredDir, ".idea/icon.svg", filteredYellowSquare);
  write(tracedDir, ".idea/icon.svg", tracedMagentaSquare);
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const mark = (page: Page, directory: string) => workspaceCard(page, directory).getByRole("button", { name: "Workspace colour" });
const icon = (page: Page, directory: string) => mark(page, directory).locator("img");
const colourShown = (page: Page, directory: string) =>
  icon(page, directory).evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [24, 24];
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 24, 24);
    return [...context.getImageData(12, 12, 1, 1).data].slice(0, 3).join(" ");
  });

test("a workspace shows its folder's icon in place of its initials, and one without an icon keeps them", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, shopDir);
  await addWorkspaceFromSidebar(page, plainDir);
  await expect(icon(page, shopDir)).toBeVisible();
  expect(await colourShown(page, shopDir)).toBe("255 0 0");
  await expect(mark(page, shopDir)).toHaveText("");
  await expect(mark(page, plainDir)).toHaveText("PN");
  await expect(icon(page, plainDir)).toHaveCount(0);
});

test("an icon with a filter shows without it, and one traced from a picture shows though its outlines are long", async ({ page }) => {
  expect(tracedMagentaSquare.length).toBeGreaterThan(150 * 1024);
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, filteredDir);
  await addWorkspaceFromSidebar(page, tracedDir);
  await expect(icon(page, filteredDir)).toBeVisible();
  expect(await colourShown(page, filteredDir)).toBe("255 255 0");
  await expect(icon(page, tracedDir)).toBeVisible();
  expect(await colourShown(page, tracedDir)).toBe("255 0 255");
});

test("the icon opens the workspace's colours as the initials do", async ({ page }) => {
  await signIn(page, host);
  await mark(page, shopDir).click();
  await page.getByRole("radiogroup", { name: /^Colour of / }).getByRole("radio", { name: "Lavender" }).click();
  await expect(workspaceCard(page, shopDir)).toHaveAttribute("data-color", "lavender");
  await expect(icon(page, shopDir)).toBeVisible();
});

test("a dark theme shows the dark icon beside the icon, and a reload an icon that changed", async ({ page }) => {
  write(shopDir, ".mirador/icon.svg", square("rgb(0, 255, 0)"));
  write(shopDir, ".mirador/icon_dark.svg", square("rgb(0, 0, 255)"));
  await signIn(page, host);
  await expect.poll(() => colourShown(page, shopDir)).toBe("0 255 0");
  await chooseInSettings(page, "Theme", "Dark");
  await expect.poll(() => colourShown(page, shopDir)).toBe("0 0 255");
  rmSync(join(shopDir, ".mirador"), { recursive: true });
  await page.reload();
  await expect.poll(() => colourShown(page, shopDir)).toBe("255 0 0");
});

/** The workspaces the host has answered about, with whether it gave the page an icon. */
function iconsAnswered(page: Page) {
  const answered = new Map<string, boolean>();
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (!String(payload).startsWith('{"type":"workspace.icon"')) return;
      const { workspaceId, icon } = JSON.parse(String(payload));
      answered.set(workspaceId, icon !== null);
    }),
  );
  return () => [...answered.values()].sort();
}

test("an icon made to freeze the page, and one that is broken, leave the initials", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceFromSidebar(page, hostileDir);
  await addWorkspaceFromSidebar(page, brokenDir);
  await expect(workspaceCard(page, brokenDir)).toBeVisible();
  const answers = iconsAnswered(page);
  await page.reload();
  await expect.poll(answers, "only the plain and the hostile folder give no icon").toEqual([false, false, true, true, true, true]);
  await expect(mark(page, brokenDir)).toHaveText("BI");
  await expect(mark(page, hostileDir)).toHaveText("HC");
  await expect(icon(page, shopDir)).toBeVisible();
});
