import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, languageNames, languageTags, type Language } from "../shared/i18n/languages.ts";
import { de } from "../site/words/de.ts";
import { en, type SiteWords } from "../site/words/en.ts";
import { es } from "../site/words/es.ts";
import { hu } from "../site/words/hu.ts";
import { zh } from "../site/words/zh.ts";

const PAGES_PATH = "/mirador/";
const TRAILER = "ZMpbOZdF4bU";
const INSTALL = "curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh";
const WINDOWS_INSTALL = "irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex";
const wordsIn: Record<Language, SiteWords> = { en, hu, es, zh, de };
const TRANSLATED = LANGUAGES.filter((language) => language !== "en");
const folderOf = (language: Language) => (language === "en" ? "" : `${language}/`);
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
    const asked = relative === null ? null : join(root, relative);
    const file = asked && existsSync(asked) && statSync(asked).isDirectory() ? join(asked, "index.html") : asked;
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
async function openSite(page: Page, path = "") {
  const youtubeRequests: string[] = [];
  const problems: string[] = [];
  await page.route(/youtube|ytimg|googlevideo/, (route) => {
    youtubeRequests.push(route.request().url());
    return route.abort();
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("response", (response) => response.url().startsWith(siteUrl) && !response.ok() && problems.push(`${response.status()} ${response.url()}`));
  await page.goto(siteUrl + path);
  return { youtubeRequests, problems };
}

async function expectEveryPictureLoaded(page: Page) {
  for (const image of await page.locator("img").all()) {
    await image.evaluate((element: HTMLImageElement) => {
      element.loading = "eager";
    });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBeGreaterThan(0);
  }
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

for (const language of TRANSLATED) {
  const words = wordsIn[language];

  test(`${languageNames[language]}: the home page and the privacy policy are in it, load without errors and fit a phone`, async ({ page }) => {
    const { problems } = await openSite(page, folderOf(language));
    await expect(page).toHaveURL(`${siteUrl}${language}/`);
    await expect(page.locator("html")).toHaveAttribute("lang", languageTags[language]);
    await expect(page).toHaveTitle(words.attributes.title);
    await expect(page.locator(".hero .button.primary")).toHaveText(words.hero.download);
    expect(await page.locator("h1").evaluate((heading) => getComputedStyle(heading).hyphens), "headings break between words, never inside one").toBe("manual");
    await expect(page.locator("link[rel=alternate]")).toHaveCount(LANGUAGES.length + 1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://mirador.sodre90.com/${language}/`);
    await expectEveryPictureLoaded(page);
    expect(await page.evaluate(async () => (await document.fonts.load('700 20px "Inter"')).length)).toBeGreaterThan(0);

    await page.locator("footer").getByRole("link", { name: words.footer.privacy }).click();
    await expect(page).toHaveURL(`${siteUrl}${language}/privacy.html`);
    await expect(page).toHaveTitle(words.attributes.privacyTitle);
    const note = page.locator(".translation-note");
    await expect(note.getByRole("link")).toHaveAttribute("href", "../privacy.html");
    await page.setViewportSize({ width: 375, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.locator(".brand").click();
    await expect(page).toHaveURL(`${siteUrl}${language}/`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(problems).toEqual([]);
  });
}

test("the language picker leads to the same page in another language, and English picked there stays", async ({ page }) => {
  const { problems } = await openSite(page, "privacy.html");
  await page.locator(".languages summary").click();
  await page.getByRole("link", { name: "Deutsch" }).click();
  await expect(page).toHaveURL(`${siteUrl}de/privacy.html`);
  await expect(page.locator(".languages summary")).toHaveText("Deutsch");

  await page.locator(".brand").click();
  await page.locator(".languages summary").click();
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(siteUrl);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(problems).toEqual([]);
});

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });

  test("the home page goes to German once, and English picked there stays", async ({ page }) => {
    await openSite(page);
    await expect(page).toHaveURL(`${siteUrl}de/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(de.hero.title.replace(/<[^>]+>/g, ""));

    await page.locator(".languages summary").click();
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(siteUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("See what your coding agent means.");
    await page.goto(siteUrl);
    await expect(page).toHaveURL(siteUrl);
  });

  test("the home page suggests German only once, but a picked language is kept", async ({ page }) => {
    await openSite(page);
    await expect(page).toHaveURL(`${siteUrl}de/`);
    await page.goto(siteUrl);
    await expect(page).toHaveURL(siteUrl);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.locator(".languages summary").click();
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(`${siteUrl}es/`);
    await page.goto(`${siteUrl}#install`);
    await expect(page).toHaveURL(`${siteUrl}es/#install`);
  });

  test("the privacy policy stays in English when opened by its English address", async ({ page }) => {
    await openSite(page, "privacy.html");
    await expect(page).toHaveURL(`${siteUrl}privacy.html`);
  });
});

test.describe("with a Traditional Chinese browser", () => {
  test.use({ locale: "zh-TW" });

  test("the home page stays in English rather than show Simplified Chinese", async ({ page }) => {
    await openSite(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(siteUrl);
  });
});

test("the Hungarian headline puts Lásd on a line of its own", async ({ page }) => {
  await openSite(page, "hu/");
  const lines = await page.locator("h1").evaluate((heading: HTMLElement) => heading.innerText.split("\n"));
  expect(lines).toEqual(["Lásd,", "mire gondol az agent."]);
});
