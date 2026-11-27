import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, createProfile, createRoom, openRoomSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({
  fakePrograms: true,
  environment: () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", MIRADOR_SANDBOX: fakePodman(), MIRADOR_SELINUX_ENFORCE: selinuxEnforce() }),
});
const fakePodman = () => join(host.root, "fake-podman", "podman");
const selinuxEnforce = () => join(host.root, "selinux-enforce");
const selinuxEnforces = (enforcing: boolean) => writeFileSync(selinuxEnforce(), enforcing ? "1\n" : "0\n");
const podmanCalls = () => join(host.root, "podman-calls");
const callsSoFar = () => (existsSync(podmanCalls()) ? readFileSync(podmanCalls(), "utf8").trim().split("\n") : []);

test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "linux", "Podman sandboxes run on Linux only.");

/** Rootless Podman, whose base image is there already and whose installs succeed: the sandbox it gives shares this computer's kernel. */
function writeFakePodman() {
  mkdirSync(join(host.root, "fake-podman"), { recursive: true });
  writeFileSync(
    fakePodman(),
    `#!/bin/sh
echo "$*" >> '${podmanCalls()}'
case "$1" in
  info) echo '{"host":{"security":{"rootless":true}}}' ;;
  ps|images) echo '[]' ;;
esac
`,
  );
  chmodSync(fakePodman(), 0o755);
  const claude = join(host.fakeProgramsDir, "claude");
  writeFileSync(claude, `#!/bin/sh\necho "2.1.330 (Claude Code)"\n`);
  chmodSync(claude, 0o755);
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  writeFakePodman();
  selinuxEnforces(false);
  mkdirSync(host.projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", host.projectDir]);
  await host.start();
  const page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Builder", "ANTHROPIC_API_KEY=sk-e2e-podman-profile-key", "", "Claude Code");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.close();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const sandboxSwitch = (dialog: Locator) => dialog.getByRole("switch", { name: "Run the agents in a sandbox" });

test("a sandbox in a Podman container says it shares this computer's kernel, and turns on only once the owner says so", async ({ page }) => {
  await signIn(page, host);
  await createRoom(page, "Contained", ["Builder"], { workspace: "project" });
  const dialog = await openRoomSettings(page, "Contained", "Permissions");
  const kind = dialog.locator(".room-sandbox-kind");
  const warning = dialog.locator(".room-sandbox-shared-kernel");

  await expect(kind).toHaveText("Runs in a Podman container, which shares this computer's Linux kernel: weaker than a VM.");
  await expect(kind).toHaveClass(/shares-kernel/);

  await test.step("switching it on asks first, and keeping it off leaves it off", async () => {
    await sandboxSwitch(dialog).click();
    await expect(warning).toContainText("shares this computer's Linux kernel");
    await expect(warning).not.toContainText("krun");
    await expect(warning.locator(".room-sandbox-without-selinux")).toHaveCount(0);
    await expect(sandboxSwitch(dialog)).not.toBeChecked();
    await expect(sandboxSwitch(dialog)).toBeDisabled();
    await warning.getByRole("button", { name: "Keep it off" }).click();
    await expect(warning).toBeHidden();
    await expect(sandboxSwitch(dialog)).not.toBeChecked();
    expect(callsSoFar().filter((call) => call.startsWith("image"))).toEqual([]);
  });

  await test.step("turned on anyway, it is set up on this computer", async () => {
    await sandboxSwitch(dialog).click();
    await warning.getByRole("button", { name: "Turn on anyway" }).click();
    await expect(warning).toBeHidden();
    await expect(sandboxSwitch(dialog)).toBeChecked();
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this computer.");
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  await test.step("and stays on, allowed, when the room's settings open again", async () => {
    const again = await openRoomSettings(page, "Contained", "Permissions");
    await expect(sandboxSwitch(again)).toBeChecked();
    await expect(again.locator(".room-sandbox-shared-kernel")).toBeHidden();
  });
});

test("where SELinux enforces its rules, the warning says the container runs outside their confinement too", async ({ page }) => {
  selinuxEnforces(true);
  await host.restart();
  await signIn(page, host);
  await createRoom(page, "Unconfined", ["Builder"], { workspace: "project" });
  const dialog = await openRoomSettings(page, "Unconfined", "Permissions");
  const warning = dialog.locator(".room-sandbox-shared-kernel");

  await sandboxSwitch(dialog).click();
  await expect(warning.locator(".room-sandbox-without-selinux")).toHaveText(
    "This computer enforces SELinux, but the container also runs without SELinux's confinement, so that your workspace's files aren't relabelled for it.",
  );
  await warning.getByRole("button", { name: "Keep it off" }).click();
  await expect(sandboxSwitch(dialog)).not.toBeChecked();
});
