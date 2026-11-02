import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, openSettings, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("choosing Magyar in Settings shows Mirador in Hungarian after the page reloads, and English comes back the same way", async ({ page }) => {
  await signIn(page, host);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const settings = await openSettings(page);

  await Promise.all([page.waitForEvent("load"), settings.getByLabel("Language").selectOption("hu")]);

  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  await page.getByRole("button", { name: "Beállítások…" }).click();
  const beallitasok = page.getByRole("dialog", { name: "Beállítások" });
  await expect(beallitasok.getByRole("tablist", { name: "Beállítási oldalak" }).getByRole("tab")).toHaveText([
    "Megjelenés",
    "Beszélgetések",
    "Ágensek",
    "Hang",
    "Terminál",
    "Vászon",
    "Bővítmények",
    "Elrendezés",
    "Készülékek",
    "Értesítések",
    "Névjegy",
  ]);
  await expect(beallitasok.getByRole("radiogroup", { name: "Téma" }).getByRole("radio")).toHaveText(["Világos", "Sötét", "Rendszer szerint"]);
  await expect(beallitasok.locator(".picture-choice").filter({ hasText: "Téma" })).toHaveAttribute("data-hint", "Világos, sötét, vagy a rendszerbeállítást követi.");

  await beallitasok.getByRole("tab", { name: "Terminál" }).click();
  await expect(beallitasok.getByLabel("Visszagörgethető sorok").locator("option").first()).toHaveText(/^1\s?000 sor$/);

  await beallitasok.getByRole("tab", { name: "Bővítmények" }).click();
  await expect(beallitasok.getByRole("button", { name: "Bővítmények megnyitása…" })).toBeVisible();

  await beallitasok.getByRole("tab", { name: "Megjelenés" }).click();
  await Promise.all([page.waitForEvent("load"), beallitasok.getByLabel("Nyelv").selectOption("en")]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect((await openSettings(page)).getByRole("radiogroup", { name: "Theme" })).toBeVisible();
});

test("in Hungarian, the sidebar, the palette and the chat's header, message box and buttons speak Hungarian", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
  await page.reload();

  const sidebar = page.locator("nav.sidebar");
  await expect(sidebar.getByRole("heading", { name: "Munkaterületek" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "+ Új beszélgetés" })).toBeVisible();
  await expect(sidebar.locator(".footer-buttons > button")).toHaveText([/^Beállítások…/, /^Bővítmények…/, "Profilok…", "Gépek…", "Keresés…", /^Billentyűk/]);

  await sidebar.getByRole("button", { name: /^Beszélgetések és műveletek…/ }).click();
  const palette = page.getByRole("dialog", { name: "Paletta" });
  await expect(palette.getByRole("textbox", { name: "Beszélgetések és műveletek keresése" })).toBeVisible();
  const entries = palette.getByRole("option");
  await expect(entries.filter({ hasText: `Új beszélgetés itt: ${basename(host.projectDir)}` })).toHaveCount(1);
  await expect(entries.filter({ hasText: "Teljes képernyő: beszélgetés" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "Elrendezés visszaállítása az alapértelmezettre" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  await sidebar.getByRole("button", { name: "Profilok…" }).click();
  const profilok = page.getByRole("dialog", { name: "Profilok" });
  await expect(profilok.getByRole("heading", { name: "Profilok" })).toBeVisible();
  const colours = profilok.getByRole("radiogroup", { name: "Profil színe" }).getByRole("radio");
  await expect(colours.first()).toHaveAccessibleName("Nincs szín");
  await expect(profilok.getByRole("radio", { name: "Levendula" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profilok).toBeHidden();

  const header = page.locator(".chat-header:visible");
  await expect(header.locator("h2")).toHaveText("Új beszélgetés");
  await expect(sidebar.locator(".conversation-title").first()).toHaveText("Új beszélgetés");
  await expect(header.getByRole("button", { name: "Vászon elrejtése" }).or(header.getByRole("button", { name: "Vászon mutatása" }))).toBeVisible();
  await expect(header.getByLabel("Kérdések").locator("option")).toHaveText(["Az ágens vár a válaszomra", "A válaszom a következő üzenetként megy el"]);

  const showCanvas = header.getByRole("button", { name: "Vászon mutatása" });
  if (await showCanvas.isVisible()) await showCanvas.click();
  const canvas = page.locator(".canvas-panel:visible");
  await expect(canvas.locator(".canvas-title")).toHaveText("Vászon");
  await expect(canvas.getByRole("button", { name: "Elrejtés" })).toBeVisible();

  const showTerminal = header.getByRole("button", { name: "Terminál mutatása" });
  if (await showTerminal.isVisible()) await showTerminal.click();
  const terminals = page.locator(".terminal-pane:visible");
  await expect(terminals.getByRole("button", { name: "Új terminállap" })).toBeVisible();
  await expect(terminals.getByRole("button", { name: "Felosztás jobbra" })).toBeVisible();

  await header.getByRole("button", { name: "Keresés" }).click();
  await expect(page.getByRole("search").getByPlaceholder("Keresés ebben a beszélgetésben")).toBeVisible();
  await page.keyboard.press("Escape");
  const composer = page.locator(".composer-area:visible");
  await expect(composer.locator("[placeholder^='Üzenet ide:'], [aria-placeholder^='Üzenet ide:']").first()).toBeAttached();
  await expect(composer.getByRole("button", { name: "Küldés" })).toBeDisabled();
  await expect(composer.getByRole("button", { name: "Sablonok" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("mirador-language"));
});

test("Español in Settings shows Mirador in Spanish", async ({ page }) => {
  await signIn(page, host);
  await Promise.all([page.waitForEvent("load"), (await openSettings(page)).getByLabel("Language").selectOption("es")]);

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const sidebar = page.locator("nav.sidebar");
  await expect(sidebar.getByRole("heading", { name: "Espacios de trabajo" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Configuración…" }).click();
  const configuracion = page.getByRole("dialog", { name: "Configuración" });
  await expect(configuracion.getByRole("tab")).toHaveText([
    "Apariencia",
    "Conversaciones",
    "Agentes",
    "Voz",
    "Terminal",
    "Lienzo",
    "Complementos",
    "Diseño",
    "Dispositivos",
    "Notificaciones",
    "Acerca de",
  ]);
  await expect(configuracion.getByRole("radiogroup", { name: "Tema" }).getByRole("radio")).toHaveText(["Claro", "Oscuro", "Igual que el sistema"]);

  await configuracion.getByRole("tab", { name: "Dispositivos" }).click();
  await expect(configuracion.getByRole("heading", { name: "Cómo llegan otros dispositivos a Mirador" })).toBeVisible();
  await configuracion.getByRole("tab", { name: "Apariencia" }).click();
  await Promise.all([page.waitForEvent("load"), configuracion.getByLabel("Idioma").selectOption("en")]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test.describe("with a Hungarian browser", () => {
  test.use({ locale: "hu-HU" });

  test("Mirador opens in Hungarian without being told, and English chosen in Settings stays", async ({ page }) => {
    await page.goto(host.authUrl);
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await expect(page.locator("nav.sidebar").getByRole("heading", { name: "Munkaterületek" })).toBeVisible();

    await page.getByRole("button", { name: "Beállítások…" }).click();
    const beallitasok = page.getByRole("dialog", { name: "Beállítások" });
    await Promise.all([page.waitForEvent("load"), beallitasok.getByLabel("Nyelv").selectOption("en")]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("简体中文 in Settings shows Mirador in Simplified Chinese, and a Traditional Chinese browser stays in English", async ({ page }) => {
  await signIn(page, host);
  await Promise.all([page.waitForEvent("load"), (await openSettings(page)).getByLabel("Language").selectOption("zh")]);

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  const sidebar = page.locator("nav.sidebar");
  await expect(sidebar.getByRole("heading", { name: "工作区" })).toBeVisible();
  await sidebar.getByRole("button", { name: "设置…" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings.getByRole("tab")).toHaveText(["外观", "对话", "智能体", "语音", "终端", "画布", "插件", "布局", "设备", "通知", "关于"]);
  await expect(settings.getByRole("radiogroup", { name: "主题" }).getByRole("radio")).toHaveText(["浅色", "深色", "跟随系统"]);

  await Promise.all([page.waitForEvent("load"), settings.getByLabel("语言").selectOption("en")]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test.describe("with a Swiss German browser", () => {
  test.use({ locale: "de-CH" });

  test("Mirador opens in German, and Settings names its tabs and themes in German", async ({ page }) => {
    await page.goto(host.authUrl);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const sidebar = page.locator("nav.sidebar");
    await expect(sidebar.getByRole("heading", { name: "Arbeitsbereiche" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Einstellungen…" }).click();
    const einstellungen = page.getByRole("dialog", { name: "Einstellungen" });
    await expect(einstellungen.getByRole("tab")).toHaveText(["Darstellung", "Unterhaltungen", "Agenten", "Stimme", "Terminal", "Canvas", "Plugins", "Layout", "Geräte", "Benachrichtigungen", "Über"]);
    await expect(einstellungen.getByRole("radiogroup", { name: "Design" }).getByRole("radio")).toHaveText(["Hell", "Dunkel", "Wie das System"]);

    await Promise.all([page.waitForEvent("load"), einstellungen.getByLabel("Sprache").selectOption("en")]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("with a Traditional Chinese browser", () => {
  test.use({ locale: "zh-TW" });

  test("Mirador stays in English rather than show Simplified Chinese", async ({ page }) => {
    await signIn(page, host);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
