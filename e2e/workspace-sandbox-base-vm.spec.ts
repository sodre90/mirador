import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, clickWorkspaceButton, createProfile, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { modelServerStatus } from "./model-server.ts";
import { TestHost } from "./test-host.ts";

/**
 * A sandboxed workspace on an image of the owner's own, on Apple's real `container`, opted into with
 * MIRADOR_SANDBOX_VM_E2E=1 on macOS 26 on Apple silicon: an image without bash and glibc is pulled and its check says
 * so, and one with all the agents need runs a real Claude Code turn. The images the test pulled are removed after it.
 */
const containerProgram = ["/usr/local/bin/container", "/opt/homebrew/bin/container"].find((path) => existsSync(path));
const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;
const optedIn = process.env.MIRADOR_SANDBOX_VM_E2E === "1";
const LACKING = "alpine/git:latest";
const USABLE = "buildpack-deps:bookworm-scm";
const PULLED = ["docker.io/alpine/git:latest", "docker.io/library/buildpack-deps:bookworm-scm"];

const host = new TestHost({ environment: () => ({ MIRADOR_SANDBOX: containerProgram ?? "off" }) });
const container = (...args: string[]) => execFileSync(containerProgram!, args, { encoding: "utf8", timeout: 60_000 });
const hostLabel = () => createHash("sha256").update(host.dataDir).digest("hex").slice(0, 10);
const ourVms = () =>
  (JSON.parse(container("list", "--all", "--format", "json")) as { configuration: { id: string; labels?: Record<string, string> } }[]).flatMap(({ configuration }) =>
    configuration.labels?.["mirador.host"] === hostLabel() ? [configuration.id] : [],
  );
const imagesHere = () => (JSON.parse(container("image", "list", "--format", "json")) as { reference: string }[]).map(({ reference }) => reference);
const asAgent = (vm: string, ...command: string[]) => container("exec", "--user", "1000:1000", "-w", realpathSync(host.projectDir), vm, ...command);

test.describe.configure({ mode: "serial" });
test.skip(!optedIn || !containerProgram || !sandboxesRunHere, "Set MIRADOR_SANDBOX_VM_E2E=1 on macOS 26 on Apple silicon with Apple's container installed.");

let pulledByTheTest: string[] = [];

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  writeFileSync(join(host.projectDir, "README.md"), "A workspace on the owner's own base image.\n");
  execFileSync("git", ["init", "-q", host.projectDir]);
  const before = imagesHere();
  pulledByTheTest = PULLED.filter((image) => !before.includes(image));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  if (optedIn && containerProgram && sandboxesRunHere) {
    expect(ourVms()).toEqual([]);
    const left = pulledByTheTest.filter((image) => imagesHere().includes(image));
    if (left.length > 0) container("image", "delete", ...left);
  }
  await host.cleanUp();
});

async function useBaseImage(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "Sandbox for project" });
  await dialog.getByRole("textbox", { name: "Base image" }).fill(name);
  await dialog.getByRole("button", { name: "Use" }).click();
  await expect(dialog.getByRole("textbox", { name: "Base image" })).toHaveValue(name);
  return dialog;
}

test("a workspace's sandbox on the owner's own image: one without bash and glibc is refused for what it lacks, and one with all the agents need runs Claude Code", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const builder = await createProfile(page, "Builder", "");
  await builder.getByRole("button", { name: "Close" }).click();
  const card = workspaceCard(page, host.projectDir);
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });

  await clickWorkspaceButton(card, "Sandbox…");
  const dialog = page.getByRole("dialog", { name: "Sandbox for project" });
  await expect(dialog.getByText("Checking whether this workspace can have a sandbox…")).toBeHidden();
  await dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" }).check();
  await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.", { timeout: 30 * 60_000 });

  await test.step("Alpine's git image is pulled and checked, and found to lack bash and a glibc", async () => {
    await useBaseImage(page, LACKING);
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText(
      `Setting it up failed: The sandbox's base image ${LACKING} lacks what the agents need: bash, a glibc for this computer's processor, which Bun and Node.js run on.`,
      { timeout: 10 * 60_000 },
    );
    expect(imagesHere()).toContain(PULLED[0]);
  });

  await test.step("buildpack-deps' image with the version control tools runs Claude Code's turn in a VM of its own", async () => {
    await useBaseImage(page, USABLE);
    await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.", { timeout: 15 * 60_000 });
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect.poll(modelServerStatus, { message: "the model server answers", timeout: 180_000, intervals: [5_000] }).toBe(200);
    const previousUrl = page.url();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await sendMessage(page, "Use your Bash tool to run `svn --version --quiet > svn-version.txt`. Reply with what the file holds.");
    await waitForTurnToEnd(page, 10 * 60_000);
    await expect.poll(() => existsSync(join(host.projectDir, "svn-version.txt")) && readFileSync(join(host.projectDir, "svn-version.txt"), "utf8")).toMatch(/^1\.\d+\.\d+/);

    const [vm] = ourVms();
    expect(vm).toBeDefined();
    expect(asAgent(vm!, "id", "-u").trim()).toBe("1000");
    expect(asAgent(vm!, "sh", "-c", ". /etc/os-release && echo $ID")).toBe("debian\n");
  });
});
