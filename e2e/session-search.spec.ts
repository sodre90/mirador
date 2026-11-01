import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const gateway = new FakeGateway();
const SPOKEN_WORD = "platypus";
const SESSION_COUNT = 35;
const HIDDEN_INDEX = SESSION_COUNT - 1;

const configDir = join(host.root, "claude-config");
let transcriptsDir = "";

const sessionIds: string[] = [];

function writeFakeSession(index: number) {
  const sessionId = crypto.randomUUID();
  sessionIds[index] = sessionId;
  const said = index === HIDDEN_INDEX ? `We should revisit the ${SPOKEN_WORD} hatchery plan.` : `Nothing special ${index}.`;
  const when = new Date(Date.now() - (index + 1) * 3_600_000);
  const record = (type: "user" | "assistant", text: string, uuid: string) =>
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      userType: "external",
      cwd: host.projectDirInTerminal,
      sessionId,
      version: "2.0.0",
      entrypoint: "cli",
      type,
      timestamp: when.toISOString(),
      uuid,
      ...(type === "user" ? { origin: { kind: "human" }, promptId: uuid } : {}),
      message: { role: type, content: [{ type: "text", text }] },
    });
  const path = join(transcriptsDir, `${sessionId}.jsonl`);
  writeFileSync(path, [record("user", `Nightly backup drill ${index}`, "u1"), record("assistant", `Ran the backup drill ${index}.`, "a1"), record("user", said, "u2"), record("assistant", `Noted: ${said}`, "a2")].join("\n") + "\n");
  utimesSync(path, when, when);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await gateway.start();
  await host.start();
  transcriptsDir = join(configDir, "projects", host.projectDirInTerminal.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(transcriptsDir, { recursive: true });
  for (const index of Array.from({ length: SESSION_COUNT }, (_, i) => i)) writeFakeSession(index);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
});

test("the Continue dialog finds a session older than its list by a word said in it and continues it", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "fake gateway", `${gatewayEnvironment(gateway)}\nCLAUDE_CONFIG_DIR=${configDir}`);
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });

  await page.getByRole("button", { name: "Continue a session…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue a session" });
  await expect(dialog.locator(".session-list")).toBeVisible({ timeout: 30_000 });

  const newest = dialog.locator(".session-list li", { hasText: sessionIds[0]!.slice(0, 8) });
  const hidden = dialog.locator(".session-list li", { hasText: sessionIds[HIDDEN_INDEX]!.slice(0, 8) });
  await expect(newest).toBeVisible();
  await expect(hidden).toHaveCount(0);

  await dialog.getByLabel("Search sessions by what was said in them").fill(SPOKEN_WORD);
  await expect(hidden).toBeVisible({ timeout: 30_000 });
  await expect(hidden.locator(".session-match")).toContainText(`revisit the ${SPOKEN_WORD} hatchery`);
  await expect(newest).toHaveCount(0);
  await expect(dialog.locator(".session-list li")).toHaveCount(1);

  await hidden.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".chat-header h2")).toContainText(`Nightly backup drill ${HIDDEN_INDEX}`);
  await expect(page.locator(".timeline")).toContainText(`${SPOKEN_WORD} hatchery`, { timeout: 30_000 });
});
