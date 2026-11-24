import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SettingsFile } from "../shared/settings-file.ts";
import { addWorkspaceFromSidebar, createProfile, openProfiles, openSettings, sendMessage, signIn, workspaceCard } from "./helpers.ts";
import { scratchPath, TestHost, writeBunProgram } from "./test-host.ts";

const configFolder = scratchPath("config-file");
const configFile = join(configFolder, "config.json");
const fakeOpencode = join(import.meta.dirname, "fake-acp-agent.ts");

const transferPage = (page: Page) => openSettings(page, "Export and import");
const profileList = (profiles: Locator) => profiles.locator(".profile-list li");
const choice = (settings: Locator, name: string) => settings.getByRole("checkbox", { name });
const chooseFile = (settings: Locator, file: Partial<SettingsFile> | string) =>
  settings
    .getByLabel("Settings file")
    .setInputFiles({ name: "settings.json", mimeType: "application/json", buffer: Buffer.from(typeof file === "string" ? file : JSON.stringify({ schemaVersion: 1, ...file })) });

async function exported(page: Page, settings: Locator): Promise<SettingsFile> {
  const downloading = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export settings" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^mirador-settings-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(readFileSync(await download.path(), "utf8"));
}

async function closeSettings(page: Page, settings: Locator) {
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
}

test.describe("a running Mirador", () => {
  const host = new TestHost({ fakePrograms: true });
  const pluginRepo = () => join(host.root, "counter-repo");

  function counterRepo() {
    cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), pluginRepo(), { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-C", pluginRepo(), "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args]);
    git("init", "--quiet", "-b", "main");
    git("add", ".");
    git("commit", "--quiet", "-m", "Count by one");
  }

  test.beforeAll(async () => {
    writeBunProgram(host.fakeProgramsDir, "opencode", fakeOpencode);
    counterRepo();
    await host.start();
  });
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
  });

  test("Settings downloads the settings, with the values of environments only when secrets are included", async ({ page }) => {
    await signIn(page, host);
    const created = await createProfile(page, "gateway", "TOKEN=sk-secret\nKEY=$(pass show key)", "", "opencode");
    await created.getByRole("button", { name: "Close" }).click();
    const settings = await transferPage(page);

    const withoutSecrets = await exported(page, settings);
    expect(withoutSecrets.profiles!.find(({ name }) => name === "gateway")).toMatchObject({ harness: "opencode", environment: { TOKEN: { needsValue: true }, KEY: { command: "pass show key" } } });
    expect(JSON.stringify(withoutSecrets)).not.toContain("sk-secret");

    await settings.getByLabel("Include secrets").check();
    await expect(settings.getByText("Keep it safe.")).toBeVisible();
    expect((await exported(page, settings)).profiles!.find(({ name }) => name === "gateway")!.environment).toMatchObject({ TOKEN: "sk-secret" });
  });

  test("Settings brings in what is new in a file, and overwrites only what is ticked", async ({ page }) => {
    const folder = join(host.root, "brought-in");
    mkdirSync(folder);
    await signIn(page, host);
    const created = await createProfile(page, "kept", "", "echo mine", "opencode");
    await created.getByRole("button", { name: "Close" }).click();
    const settings = await transferPage(page);

    await chooseFile(settings, {
      profiles: [
        { name: "kept", harness: "opencode", prelaunch: "echo theirs" },
        { name: "brought in", harness: "opencode", environment: { TOKEN: { needsValue: true } } },
        { name: "Claude Code", harness: "claude" },
      ],
      promptTemplates: [{ name: "Standup", text: "What did we do on {{day}}?" }],
      workspaces: [{ group: "Work", workspaces: [{ group: "Clients", workspaces: [{ path: folder, profile: "brought in", sandbox: { on: false, workFreely: true } }] }] }, { path: join(host.root, "not-there") }],
      preferences: { olderAfter: "2-weeks", conversationsShown: "12" },
    });

    await expect(choice(settings, "brought in")).toBeChecked();
    await expect(choice(settings, "Standup")).toBeChecked();
    await expect(choice(settings, "Fold under Older after")).toBeChecked();
    await expect(choice(settings, "Conversations per workspace")).toBeChecked();
    await expect(choice(settings, "Work / Clients")).toBeChecked();
    const overwriting = choice(settings, "kept Overwrites what is here: Pre-launch command");
    await expect(overwriting).not.toBeChecked();
    await expect(settings.getByText("Fill in after the import: TOKEN")).toBeVisible();
    await expect(settings.getByText("1 is here already as in the file.")).toBeVisible();
    await expect(settings.getByText("not-there")).toBeVisible();
    await choice(settings, "Standup").uncheck();
    await settings.getByRole("button", { name: "Import", exact: true }).click();

    await expect(settings.getByRole("status")).toContainText("6 added");
    await closeSettings(page, settings);
    await expect(workspaceCard(page, folder), "the workspace shows without a reload").toBeVisible();
    const clients = page.getByText("Clients", { exact: true });
    await expect(clients).toBeVisible();
    await page.getByText("Work", { exact: true }).click();
    await expect(clients, "a group in a group folds with it").toBeHidden();
    await page.getByText("Work", { exact: true }).click();
    const profiles = await openProfiles(page);
    await profileList(profiles).filter({ hasText: "brought in" }).click();
    await profiles.getByRole("button", { name: "Edit environment" }).click();
    await expect(profiles.getByLabel("Environment", { exact: true })).toHaveValue("# TOKEN= needs a value");
    await profileList(profiles).filter({ hasText: "kept" }).click();
    await expect(profiles.getByLabel("Pre-launch command")).toHaveValue("echo mine");
    await profiles.getByRole("button", { name: "Close" }).click();

    const again = await transferPage(page);
    await chooseFile(again, { profiles: [{ name: "kept", harness: "opencode", prelaunch: "echo theirs" }] });
    await overwriting.check();
    await again.getByRole("button", { name: "Import", exact: true }).click();
    await expect(again.getByRole("status")).toContainText("1 overwritten");
    await closeSettings(page, again);
    await openProfiles(page);
    await profileList(profiles).filter({ hasText: "kept" }).click();
    await expect(profiles.getByLabel("Pre-launch command")).toHaveValue("echo theirs");
  });

  test("Settings says what is wrong with a file it can't read, and when there is nothing in it to bring in", async ({ page }) => {
    await signIn(page, host);
    const settings = await transferPage(page);

    await chooseFile(settings, "profiles: []");
    await expect(settings.getByRole("alert")).toHaveText("The settings file is not JSON.");
    await chooseFile(settings, { profiles: [{ name: "Claude Code", harness: "claude" }] });
    await expect(settings.getByText("All of it is here already.")).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  });

  test("a plugin of the file that isn't installed is installed after its own question", async ({ page }) => {
    await signIn(page, host);
    const settings = await transferPage(page);
    await chooseFile(settings, { plugins: [{ name: "counter", repository: pluginRepo(), branch: "main", commit: "0000000" }] });

    await settings.getByRole("button", { name: "Install: counter" }).click();
    const consent = settings.getByRole("group", { name: "Install Counter?" });
    await expect(consent).toBeVisible({ timeout: 30_000 });
    await expect(settings.getByText("The exported one was at commit 0000000, so this is not the same code.")).toBeVisible();
    await consent.getByRole("button", { name: "Install", exact: true }).click();
    await expect(settings.getByText("Installed, used from the next start")).toBeVisible({ timeout: 30_000 });

    const file = await exported(page, settings);
    expect(file.plugins).toMatchObject([{ name: "counter", branch: "main" }]);
  });

  test("the commands write the settings to a file and bring one into the running Mirador, shown without a reload", async ({ page }) => {
    await signIn(page, host);
    const out = join(host.root, "settings.json");
    host.mirador("export-settings", "--out", out);
    const file: SettingsFile = JSON.parse(readFileSync(out, "utf8"));
    expect(file.profiles!.map(({ name }) => name)).toContain("Claude Code");

    writeFileSync(out, JSON.stringify({ schemaVersion: 1, profiles: [{ name: "from a command", harness: "opencode" }, { name: "Claude Code", harness: "claude", model: "opus" }] }));
    const profiles = await openProfiles(page);
    expect(host.mirador("import-settings", "--dry-run", out)).toContain("New here:\n  profile from a command");
    await expect(profileList(profiles).filter({ hasText: "from a command" })).toHaveCount(0);
    const printed = host.mirador("import-settings", out);
    expect(printed).toContain("Added:\n  profile from a command");
    expect(printed, "with no one to ask, what is here stays").toContain("Kept as here:\n  profile Claude Code (model)");
    await expect(profileList(profiles).filter({ hasText: "from a command" })).toBeVisible();

    expect(host.mirador("import-settings", "--overwrite", out)).toContain("Overwritten:\n  profile Claude Code (model)");
  });

  test("a test host reads no config file, and Settings says it is turned off", async ({ page }) => {
    await signIn(page, host);
    const settings = await transferPage(page);
    await expect(settings.getByRole("region", { name: "Config file" })).toContainText("Turned off with MIRADOR_CONFIG_FILE.");
  });
});

test.describe("the config file", () => {
  const host = new TestHost({ fakePrograms: true, environment: { MIRADOR_CONFIG_FILE: configFile } });
  const writeConfigFile = (file: Partial<SettingsFile>) => {
    mkdirSync(configFolder, { recursive: true });
    writeFileSync(configFile, JSON.stringify({ schemaVersion: 1, ...file }));
  };
  const named = { profiles: [{ name: "from the file", harness: "opencode", prelaunch: "echo file" }], promptTemplates: [{ name: "Standup", text: "What did we do?" }] } satisfies Partial<SettingsFile>;

  test.beforeAll(async () => {
    writeBunProgram(host.fakeProgramsDir, "opencode", fakeOpencode);
    await host.start();
  });
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
    rmSync(configFolder, { recursive: true, force: true });
  });

  test("adds what it names as Mirador starts, over what was changed in Mirador, and the editors say so", async ({ page }) => {
    await signIn(page, host);
    const beforeAny = await transferPage(page);
    await expect(beforeAny.getByRole("region", { name: "Config file" })).toContainText("No file there when Mirador started.");

    writeConfigFile(named);
    await host.restart();
    await signIn(page, host);
    const profiles = await openProfiles(page);
    await profileList(profiles).filter({ hasText: "from the file" }).click();
    const note = "Set by the config file: what you change here lasts until Mirador's next start.";
    await expect(profiles.getByText(note)).toBeVisible();
    await profiles.getByLabel("Pre-launch command").fill("echo changed");
    await profiles.getByRole("button", { name: "Save", exact: true }).click();
    await expect(profiles.locator(".saved")).toHaveText("Saved");
    await profileList(profiles).filter({ hasText: "Claude Code" }).click();
    await expect(profiles.getByText(note)).toHaveCount(0);
    await profiles.getByRole("button", { name: "Close" }).click();
    const conversations = await openSettings(page, "Conversations");
    await conversations.locator(".profile-list li", { hasText: "Standup" }).click();
    await expect(conversations.getByText(note)).toBeVisible();
    await closeSettings(page, conversations);

    writeConfigFile({ ...named, workspaces: [{ path: join(host.root, "not-there") }] });
    await host.restart();
    await signIn(page, host);
    const settings = await transferPage(page);
    const status = settings.getByRole("region", { name: "Config file" });
    await expect(status).toContainText(configFile);
    await expect(status).toContainText("Read when Mirador started: 0 added, 1 overwritten, 1 already as in the file.");
    await expect(status).toContainText("not-there");
    await closeSettings(page, settings);
    await openProfiles(page);
    await profileList(profiles).filter({ hasText: "from the file" }).click();
    await expect(profiles.getByLabel("Pre-launch command")).toHaveValue("echo file");
  });
});

test.describe("an environment variable that is a command", () => {
  const host = new TestHost({ fakePrograms: true });

  test.beforeAll(async () => {
    writeBunProgram(host.fakeProgramsDir, "opencode", fakeOpencode, { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
    await host.start();
  });
  test.afterAll(async () => {
    await host.stop();
    await host.cleanUp();
  });

  test("has what the command prints in the agent, and a command that fails is named in the profile's test", async ({ page }) => {
    await signIn(page, host);
    await addWorkspaceFromSidebar(page, host.projectDir);
    const broken = await createProfile(page, "no vault", "VAULT_TOKEN=$(echo vault sealed >&2; exit 4)", "", "opencode");
    await broken.getByRole("button", { name: "Test", exact: true }).click();
    await expect(broken.getByLabel("Profile test result")).toContainText("VAULT_TOKEN");
    await expect(broken.getByLabel("Profile test result")).toContainText("vault sealed");
    await broken.getByRole("button", { name: "Close" }).click();

    const created = await createProfile(page, "vault", "VAULT_TOKEN=$(echo from the vault)", "", "opencode");
    await created.getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: "vault · opencode" });
    await page.getByRole("button", { name: "+ New conversation" }).click();
    const written = join(host.projectDir, "token.txt");
    await sendMessage(page, `WRITE ${JSON.stringify([{ shell: written, content: "{{env:VAULT_TOKEN}}" }])}`);
    await expect.poll(() => readIfThere(written)).toBe("from the vault");
  });
});

function readIfThere(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
