import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openRoomSettings, openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({
  fakePrograms: true,
  environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: "", MIRADOR_SELINUX_ENFORCE: join(host.root, "no-selinux") }),
});
const callsOf = (engine: "podman" | "docker") => join(host.root, `${engine}-calls`);
const callsSoFar = (engine: "podman" | "docker") => (existsSync(callsOf(engine)) ? readFileSync(callsOf(engine), "utf8").trim().split("\n") : []);
const dockerRunsAsRoot = () => join(host.root, "docker-runs-as-root");
const dockerDaemonDown = () => join(host.root, "docker-daemon-down");

test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "linux", "Podman and Docker sandboxes run on Linux only.");

const writeProgram = (name: string, script: string) => {
  writeFileSync(join(host.fakeProgramsDir, name), script);
  chmodSync(join(host.fakeProgramsDir, name), 0o755);
};

/** Rootless Podman and Docker on PATH, whose base images are there already and whose installs succeed; Docker runs as root, or its daemon doesn't answer, once told to. */
function writeFakeEngines() {
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeProgram(
    "podman",
    `#!/bin/sh
echo "$*" >> '${callsOf("podman")}'
case "$1" in
  info) echo '{"host":{"security":{"rootless":true}}}' ;;
  ps|images) echo '[]' ;;
esac
`,
  );
  writeProgram(
    "docker",
    `#!/bin/sh
echo "$*" >> '${callsOf("docker")}'
case "$1" in
  info)
    if [ -e '${dockerDaemonDown()}' ]; then echo 'Cannot connect to the Docker daemon' >&2; exit 1
    elif [ -e '${dockerRunsAsRoot()}' ]; then echo '{"ServerVersion":"29.1.0","SecurityOptions":["name=seccomp,profile=builtin"]}'
    else echo '{"ServerVersion":"29.1.0","SecurityOptions":["name=seccomp,profile=builtin","name=rootless"]}'; fi ;;
esac
`,
  );
  writeProgram("claude", `#!/bin/sh\necho "2.1.330 (Claude Code)"\n`);
}

test.beforeAll(async ({ browser }) => {
  writeFakeEngines();
  mkdirSync(host.projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", host.projectDir]);
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Builder", "ANTHROPIC_API_KEY=sk-e2e-docker-profile-key", "", "Claude Code");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const sandboxSwitch = (dialog: Locator) => dialog.getByRole("switch", { name: "Run the agents in a sandbox" });

async function sandboxSettings(page: Page) {
  const settings = await openSettings(page, "Agents");
  return { settings, section: settings.locator(".sandbox-engine-settings"), engine: settings.getByRole("combobox", { name: "Run sandboxes with" }) };
}

async function roomKind(page: Page, room: string) {
  await createRoom(page, room, ["Builder"], { workspace: "project" });
  const dialog = await openRoomSettings(page, room, "Permissions");
  return { dialog, kind: dialog.locator(".room-sandbox-kind") };
}

test("Settings lists the engines installed here, Podman in use where none is chosen, and choosing Docker says it applies when Mirador restarts", async ({ page }) => {
  await signIn(page, host);
  const { settings, section, engine } = await sandboxSettings(page);

  await expect(engine.locator("option")).toHaveText(["Podman", "Docker"]);
  await expect(engine).toHaveValue("podman");
  await expect(section.locator(".sandbox-engine-next-start")).toHaveCount(0);
  await expect(section.locator(".sandbox-engine-docker-read-only")).toHaveCount(0);

  await engine.selectOption("docker");
  await expect(section.locator(".sandbox-engine-next-start")).toHaveText("Mirador switches to Docker when it restarts. Until then its sandboxes run with Podman.");
  await expect(section.locator(".sandbox-engine-docker-read-only")).toHaveText("With Docker, agents see only what every user of this computer may read in the folders added read only.");
  await settings.getByRole("button", { name: "Close" }).click();

  const { kind } = await roomKind(page, "Before the restart");
  await expect(kind).toHaveText("Runs in a Podman container, which shares this computer's Linux kernel: weaker than a VM.");
});

test("once Mirador restarts, a room's sandbox runs on Docker, which warns it shares this computer's kernel, and is set up with Docker alone", async ({ page }) => {
  await host.restart();
  await signIn(page, host);
  const { settings, section, engine } = await sandboxSettings(page);
  await expect(engine).toHaveValue("docker");
  await expect(section.locator(".sandbox-engine-next-start")).toHaveCount(0);
  await expect(section.locator(".sandbox-engine-docker-read-only")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  const { dialog, kind } = await roomKind(page, "On Docker");
  await expect(kind).toHaveText("Runs in a Docker container, which shares this computer's Linux kernel: weaker than a VM.");
  await sandboxSwitch(dialog).click();
  const warning = dialog.locator(".room-sandbox-shared-kernel");
  await expect(warning).toContainText("On this computer the sandbox is a Docker container, not a VM.");
  const podmanCallsBefore = callsSoFar("podman");
  await warning.getByRole("button", { name: "Turn on anyway" }).click();
  await expect(sandboxSwitch(dialog)).toBeChecked();
  await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this computer.");
  expect(callsSoFar("docker").some((call) => call.startsWith("image inspect mirador-sandbox-base:"))).toBe(true);
  expect(callsSoFar("podman")).toEqual(podmanCallsBefore);
});

test("a chosen Docker that runs as root stays chosen, and Settings and the room tell why it runs no sandbox", async ({ page }) => {
  writeFileSync(dockerRunsAsRoot(), "");
  await host.restart();
  await signIn(page, host);
  const { settings, section, engine } = await sandboxSettings(page);

  await expect(engine).toHaveValue("docker");
  await expect(engine.locator("option")).toHaveText(["Podman", "Docker: can't run sandboxes here"]);
  const asRoot = "Sandboxes need Docker rootless, its daemon run as your own user: this Docker's runs as root. See docs.docker.com/engine/security/rootless.";
  await expect(section.locator(".sandbox-engine-why-not")).toHaveText(asRoot);
  await settings.getByRole("button", { name: "Close" }).click();

  const { dialog } = await roomKind(page, "On a rootful Docker");
  await expect(dialog.locator(".room-sandbox-reasons li")).toHaveText([asRoot]);
  await dialog.getByRole("button", { name: "Close" }).click();

  await sandboxSettings(page);
  await engine.selectOption("podman");
  await expect(section.locator(".sandbox-engine-next-start")).toHaveText("Mirador switches to Podman when it restarts. Until then its sandboxes run with Docker.");
  await expect(section.locator(".sandbox-engine-why-not")).toHaveCount(0);
  await settings.getByRole("button", { name: "Close" }).click();
  rmSync(dockerRunsAsRoot());
});

test("a Docker that runs sandboxes only after Mirador started is noticed as Settings or a room asks again, with no restart", async ({ page }) => {
  await signIn(page, host);
  const { settings, section, engine } = await sandboxSettings(page);
  await expect(engine.locator("option")).toHaveText(["Podman", "Docker"]);
  await engine.selectOption("docker");
  await settings.getByRole("button", { name: "Close" }).click();

  writeFileSync(dockerDaemonDown(), "");
  await host.restart();
  await signIn(page, host);
  await sandboxSettings(page);
  await expect(engine.locator("option")).toHaveText(["Podman", "Docker: can't run sandboxes here"]);
  const daemonDown = "Docker doesn't work for Mirador's user here: docker info tells why.";
  await expect(section.locator(".sandbox-engine-why-not")).toHaveText(daemonDown);
  await settings.getByRole("button", { name: "Close" }).click();
  const { dialog } = await roomKind(page, "Before Docker starts");
  await expect(dialog.locator(".room-sandbox-reasons li")).toHaveText([daemonDown]);
  await dialog.getByRole("button", { name: "Close" }).click();

  rmSync(dockerDaemonDown());
  const reopened = await openRoomSettings(page, "Before Docker starts", "Permissions");
  await expect(reopened.locator(".room-sandbox-kind")).toHaveText("Runs in a Docker container, which shares this computer's Linux kernel: weaker than a VM.");
  await sandboxSwitch(reopened).click();
  await reopened.locator(".room-sandbox-shared-kernel").getByRole("button", { name: "Turn on anyway" }).click();
  await expect(reopened.locator(".room-sandbox-setup")).toHaveText("Set up on this computer.");
  await reopened.getByRole("button", { name: "Close" }).click();

  await sandboxSettings(page);
  await expect(engine.locator("option")).toHaveText(["Podman", "Docker"]);
  await expect(section.locator(".sandbox-engine-why-not")).toHaveCount(0);
});
