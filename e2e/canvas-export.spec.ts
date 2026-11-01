import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, openSettings, signIn, startConversation, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** Agents are told the public canvas address, but this browser reaches the host locally and draws pages from the local one. */
const host = new TestHost({
  environment: { MIRADOR_PUBLIC_ORIGIN: "https://mirador.example.com", MIRADOR_PUBLIC_CANVAS_ORIGIN: "https://mirador.example.com:8443" },
});
const localAssetsOrigin = () => `http://127.0.0.1:${host.port + 1}`;
const cdnD3 = /https:\/\/cdn\.jsdelivr\.net\/npm\/d3@\d+\.\d+\.\d+\/dist\/d3\.min\.js/;

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const chart = () => ({
  title: "Sales by région",
  html: `<style>h1 { color: rgb(200, 0, 0); }</style><script src="${localAssetsOrigin()}/d3.min.js"></script><h1 id="drawn">waiting</h1>
<script>document.getElementById("drawn").textContent = "Drawn with d3 " + d3.version;</script>`,
});

const canvasPage = (page: Page) => page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame();
const exportToggle = (page: Page) => page.locator(".canvas-header:visible .page-export .bar-menu-toggle");
const exportStatus = (page: Page) => page.locator(".page-export-status");
const saveForm = (page: Page) => page.locator(".page-save");
const savedFile = join(host.projectDir, "docs", "sales-by-region.html");

async function exportBy(page: Page, action: string) {
  await exportToggle(page).click();
  await page.getByRole("menu", { name: "Export the page" }).getByRole("menuitem", { name: action }).click();
}

async function saveToProject(page: Page) {
  await exportBy(page, "Save to project…");
  await saveForm(page).getByRole("button", { name: "Save" }).click();
}

/** Copies the shown page as an image, and counts the pixels in it that are clearly red, green or blue. */
async function copyAsImage(page: Page) {
  await exportBy(page, "Copy as image");
  await expect(exportStatus(page)).toHaveText("Copied as an image", { timeout: 30_000 });
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await item!.getType("image/png"));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const pixelsWhereOnly = (channel: number) =>
      pixels.filter((value, index) => index % 4 === channel && value > 150 && [0, 1, 2].every((other) => other === channel || pixels[index - channel + other]! < 60)).length;
    return { types: item!.types, width: bitmap.width, height: bitmap.height, redPixels: pixelsWhereOnly(0), greenPixels: pixelsWhereOnly(1), bluePixels: pixelsWhereOnly(2) };
  });
}

async function chooseLibraries(page: Page, option: string) {
  const settings = await openSettings(page, "Canvas");
  await settings.getByLabel("Libraries").selectOption({ label: option });
  await settings.getByRole("button", { name: "Close" }).click();
}

test("a page the agent showed can be copied as an image or HTML, downloaded, and saved into the project, with its libraries from a CDN or inside it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", chart());
  await expect(canvasPage(page).locator("#drawn")).toHaveText(/^Drawn with d3 \d/);

  await test.step("Copy HTML puts a page of its own on the clipboard, loading D3 from the CDN", async () => {
    await exportBy(page, "Copy HTML");
    await expect(exportStatus(page)).toHaveText("Copied the HTML");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^<!doctype html>/);
    expect(copied).toContain("<title>Sales by région</title>");
    expect(copied).toMatch(cdnD3);
    expect(copied).not.toContain(localAssetsOrigin());
  });

  await test.step("Copy as image puts a PNG of the page, in its own colours, on the clipboard", async () => {
    const image = await copyAsImage(page);
    expect(image.types).toContain("image/png");
    expect(image.width).toBeGreaterThan(100);
    expect(image.height).toBeGreaterThan(20);
    expect(image.redPixels, "the page's own red title is drawn").toBeGreaterThan(200);
  });

  await test.step("Download saves the same page, named after its title", async () => {
    const downloading = page.waitForEvent("download");
    await exportBy(page, "Download");
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("sales-by-region.html");
    expect(readFileSync(await download.path(), "utf8")).toMatch(cdnD3);
    await expect(exportStatus(page)).toHaveText("Downloaded");
  });

  await test.step("Save to project writes it into the project at the path offered", async () => {
    await exportBy(page, "Save to project…");
    await expect(saveForm(page).getByLabel("Save in the project as")).toHaveValue("docs/sales-by-region.html");
    await saveForm(page).getByRole("button", { name: "Save" }).click();
    await expect(exportStatus(page)).toHaveText("Saved to docs/sales-by-region.html");
    expect(readFileSync(savedFile, "utf8")).toMatch(cdnD3);
  });

  await test.step("a path outside the project is refused, and the form stays for another", async () => {
    await exportBy(page, "Save to project…");
    await saveForm(page).getByLabel("Save in the project as").fill("../outside.html");
    await saveForm(page).getByRole("button", { name: "Save" }).click();
    await expect(saveForm(page).getByRole("alert")).toHaveText('"../outside.html" is not a file inside the project folder.');
    expect(existsSync(join(host.projectDir, "..", "outside.html"))).toBe(false);
    await page.keyboard.press("Escape");
    await expect(saveForm(page)).toHaveCount(0);
  });

  await test.step("in Hungarian, the host's refusal shows in Hungarian", async () => {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1920, height: viewport.height });
    await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
    await page.reload();
    await exportToggle(page).click();
    await page.getByRole("menuitem", { name: "Mentés a projektbe…" }).click();
    await saveForm(page).getByLabel("Mentés a projektbe ezen a néven").fill("../outside.html");
    await saveForm(page).getByRole("button", { name: "Mentés", exact: true }).click();
    await expect(saveForm(page).getByRole("alert")).toHaveText("Ez nem a projektmappán belüli fájl: „../outside.html”.");
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.removeItem("mirador-language"));
    await page.setViewportSize(viewport);
    await page.reload();
  });

  await test.step("with libraries inside the file, saving over the earlier file asks first, then puts D3 in it", async () => {
    await chooseLibraries(page, "Inside the file: works offline, but Mermaid adds about 3 MB");
    await saveToProject(page);
    await expect(saveForm(page).getByRole("alert")).toHaveText("docs/sales-by-region.html is already there. Replace it?");
    expect(readFileSync(savedFile, "utf8")).toMatch(cdnD3);
    await saveForm(page).getByRole("button", { name: "Replace" }).click();
    await expect(exportStatus(page)).toHaveText("Saved to docs/sales-by-region.html");
    const saved = readFileSync(savedFile, "utf8");
    expect(saved).toContain("https://d3js.org");
    expect(saved).not.toMatch(/<script[^>]*src=[^>]*d3\.min\.js/);
  });

  await test.step("Save image to project draws the page and writes it into the project as a PNG", async () => {
    await exportBy(page, "Save image to project…");
    await expect(saveForm(page).getByLabel("Save in the project as")).toHaveValue("docs/sales-by-region.png");
    await saveForm(page).getByRole("button", { name: "Save" }).click();
    await expect(exportStatus(page)).toHaveText("Saved to docs/sales-by-region.png");
    expect(readFileSync(join(host.projectDir, "docs", "sales-by-region.png")).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  await test.step("inside the desktop app, whose downloads land unannounced in ~/Downloads, Export offers no Download", async () => {
    await page.addInitScript(() => {
      window.__electrobunSendToHost = () => {};
    });
    await page.reload();
    await exportToggle(page).click();
    await expect(page.getByRole("menu", { name: "Export the page" }).getByRole("menuitem")).toHaveText([
      "Copy as image",
      "Copy HTML",
      "Ask agent for Markdown",
      "Ask agent to save Markdown file",
      "Save to project…",
      "Save image to project…",
    ]);
    await page.keyboard.press("Escape");
  });

  await test.step("only a shown page offers Export: not the Changes tab over it", async () => {
    await page.locator(".canvas-header:visible .changes-toggle").click();
    await expect(exportToggle(page)).toHaveCount(0);
  });
});

async function startConversationInProject(page: Page) {
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  return startConversation(page);
}

test("Copy as image draws shapes a page reuses with <use> in the page's own styles, and in the colour each <use> passes on", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const conversationId = await startConversationInProject(page);
  await callCanvasTool(host, conversationId, "show", {
    title: "Reused shapes",
    html: `<style>.tile { fill: rgb(0, 160, 0); }</style>
<svg width="0" height="0" style="position: absolute"><defs>
  <g id="tile"><rect class="tile" width="200" height="100"/></g>
  <symbol id="square" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
</defs></svg>
<svg id="drawn" width="340" height="100"><use href="#tile"/><use href="#square" x="240" width="100" height="100" fill="rgb(0, 0, 200)"/></svg>`,
  });
  await expect(canvasPage(page).locator("#drawn")).toBeVisible();

  const image = await copyAsImage(page);
  expect(image.greenPixels, "the tile in its class's green, not black").toBeGreaterThan(10_000);
  expect(image.bluePixels, "the square in the blue its <use> gives it").toBeGreaterThan(5_000);
});

test("Copy as image draws a three.js scene as it shows, though WebGL keeps a frame's drawing only until it is on screen", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const conversationId = await startConversationInProject(page);
  await callCanvasTool(host, conversationId, "show", {
    title: "A scene",
    html: `<canvas id="scene" width="300" height="150"></canvas>
<script type="module">
  import * as THREE from "three";
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("scene") });
  renderer.setClearColor(0x00ff00);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  document.getElementById("scene").dataset.drawing = "yes";
</script>`,
  });
  await expect(canvasPage(page).locator("#scene")).toHaveAttribute("data-drawing", "yes");

  const image = await copyAsImage(page);
  expect(image.greenPixels, "the scene's green, not a blank canvas").toBeGreaterThan(30_000);
});

test("Export asks the agent for the page as Markdown, in the chat or also as a file in the project, with the page's HTML in the request", async ({ page }) => {
  const conversationId = await startConversationInProject(page);
  await callCanvasTool(host, conversationId, "show", {
    title: "Release plan",
    html: "<h1>Release plan</h1><table><tr><th>Month</th><th>Goal</th></tr><tr><td>May</td><td>Beta</td></tr></table>",
  });
  await expect(canvasPage(page).locator("h1")).toHaveText("Release plan");
  const request = page.locator(".timeline:visible .message.user").last();

  await test.step("for the chat: the request goes to the page's conversation as the user's message, asking for no file", async () => {
    await exportBy(page, "Ask agent for Markdown");
    await expect(exportStatus(page)).toHaveText("Asked the agent. The Markdown comes in the chat.");
    await expect(request).toContainText('Write the canvas page "Release plan" as Markdown');
    await expect(request).toContainText("write no file");
    await expect(request).toContainText("<td>May</td><td>Beta</td>");
    await waitForTurnToEnd(page);
  });

  await test.step("as a file: the request names the path beside where Save to project offers the HTML, and asks before replacing a file there", async () => {
    await exportBy(page, "Ask agent to save Markdown file");
    await expect(exportStatus(page)).toHaveText("Asked the agent. The Markdown comes in the chat and in docs/release-plan.md.");
    await expect(request).toContainText("Save it as docs/release-plan.md in the project, but if a file is there already, ask me before replacing it.");
    await expect(request).toContainText("Reply with the same Markdown in one code block");
    await expect(request).toContainText("<td>May</td><td>Beta</td>");
  });
});
