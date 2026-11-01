import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const PAGES_PATH = "/mirador/";
const TRAILER = "ZMpbOZdF4bU";
const INSTALL = "curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh";
const WINDOWS_INSTALL = "irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex";
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

let site: string;
let server: Server;
let siteUrl: string;

/** Serves the built site under /mirador/, as GitHub Pages serves a project's site, so a path that only works at the root fails. */
function servedLikeGitHubPages(root: string) {
  return createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relative = path.startsWith(PAGES_PATH) ? path.slice(PAGES_PATH.length) : null;
    const file = relative === null ? null : join(root, relative || "index.html");
    if (!file || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
}

test.beforeAll(async () => {
  site = mkdtempSync(join(tmpdir(), "mirador-site-"));
  execFileSync("bun", [join(import.meta.dirname, "..", "scripts", "build-site.ts"), site]);
  server = servedLikeGitHubPages(site);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PAGES_PATH}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(site, { recursive: true, force: true });
});

/** Opens the site with YouTube cut off, recording every request made to it, and the page's errors. */
async function openSite(page: Page) {
  const youtubeRequests: string[] = [];
  const problems: string[] = [];
  await page.route(/youtube|ytimg|googlevideo/, (route) => {
    youtubeRequests.push(route.request().url());
    return route.abort();
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("response", (response) => response.url().startsWith(siteUrl) && !response.ok() && problems.push(`${response.status()} ${response.url()}`));
  await page.goto(siteUrl);
  return { youtubeRequests, problems };
}

test("the first screen says what Mirador is, with the install line, the way to the Windows one, a download and the GitHub repository", async ({ page }) => {
  await openSite(page);
  await expect(page).toHaveTitle("Mirador: a canvas for your coding agent");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See what your coding agent means.");
  const hero = page.locator(".hero");
  await expect(hero.locator(".command code")).toHaveText(INSTALL);
  await expect(hero.getByText("brew install --cask sodre90/tap/mirador")).toBeVisible();
  await hero.getByRole("link", { name: "Windows" }).click();
  await expect(page.locator("#install .command code").filter({ hasText: WINDOWS_INSTALL })).toBeInViewport();
  await expect(hero.getByRole("link", { name: "Download" })).toHaveAttribute("href", "https://github.com/sodre90/mirador/releases/latest");
  await expect(hero.getByRole("link", { name: "Star on GitHub" })).toHaveAttribute("href", "https://github.com/sodre90/mirador");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://mirador.sodre90.com/og.jpg");
});

test("Copy puts each command on the clipboard as it is shown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSite(page);
  const commands = page.locator(".command");
  await expect(commands).toHaveCount(4);
  for (const command of await commands.all()) {
    const copy = command.getByRole("button", { name: "Copy" });
    await copy.click();
    await expect(command.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await command.locator("code").textContent());
  }
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("brew install --cask sodre90/tap/mirador");
});

test("the trailer loads nothing from YouTube until it is clicked, then plays in place", async ({ page }) => {
  const { youtubeRequests } = await openSite(page);
  const trailer = page.getByRole("link", { name: /The trailer/ });
  await trailer.scrollIntoViewIfNeeded();
  await expect(trailer).toHaveAttribute("href", `https://youtu.be/${TRAILER}`);
  expect(youtubeRequests).toEqual([]);

  await trailer.click();
  const player = page.locator(".trailer iframe");
  await expect(player).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${TRAILER}?autoplay=1&rel=0`);
  await expect(page).toHaveURL(siteUrl);
});

test("every picture and the font load from the site's own folder, without errors", async ({ page }) => {
  const { problems } = await openSite(page);
  const images = page.locator("img");
  expect(await images.count()).toBeGreaterThan(8);
  for (const image of await images.all()) {
    await image.evaluate((element: HTMLImageElement) => {
      element.loading = "eager";
    });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(async () => (await document.fonts.load('700 20px "Inter"')).length)).toBe(1);
  for (const anchor of ["#features", "#install", "#faq"]) await expect(page.locator(anchor)).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("on a phone the page fits the screen without sideways scrolling, and the questions open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await openSite(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const question = page.locator("details", { hasText: "Does my code leave my computer?" });
  await question.locator("summary").click();
  await expect(question.getByText("There is no telemetry.")).toBeVisible();
});

test("the footer leads to the privacy policy, which loads without errors and leads back home", async ({ page }) => {
  const { problems } = await openSite(page);
  await page.locator("footer").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(`${siteUrl}privacy.html`);
  await expect(page).toHaveTitle("Privacy policy · Mirador");
  await expect(page.getByRole("heading", { level: 2, name: "Mirador for Android" })).toBeVisible();
  await expect(page.getByText("The microphone is used only while you hold the send button to dictate.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator(".brand").click();
  await expect(page).toHaveURL(siteUrl);
  expect(problems).toEqual([]);
});
