import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  ["src/server/main.ts", "src/server/routes.ts", "docs/guide.md"].forEach((file) => {
    mkdirSync(join(host.projectDir, file, ".."), { recursive: true });
    writeFileSync(join(host.projectDir, file), "");
  });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("typing @ suggests paths: the workspace's files by name, or a path directory by directory, anywhere in the message", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  const menu = page.getByRole("listbox", { name: "Paths" });
  const picked = menu.locator('[aria-selected="true"]');

  await test.step("a bare @ lists the workspace's top level", async () => {
    await composer.fill("look at @");
    await expect(menu.getByRole("option")).toHaveText(["docs/", "src/"]);
  });

  await test.step("words find a file wherever it is, and Enter takes it", async () => {
    await composer.fill("look at @rout");
    await expect(picked).toHaveText("src/server/routes.ts");
    await composer.press("Enter");
    await expect(composer).toHaveValue("look at @src/server/routes.ts ");
    await expect(menu).toBeHidden();
    await expect(page.locator(".message.user")).toHaveCount(0);
  });

  await test.step("a path is completed directory by directory, each staying open for the next", async () => {
    await composer.fill("@./s");
    await expect(picked).toHaveText("./src/");
    await composer.press("Tab");
    await expect(composer).toHaveValue("@./src/");
    await expect(picked).toHaveText("./src/server/");
    await composer.press("Tab");
    await expect(menu.getByRole("option")).toHaveText(["./src/server/main.ts", "./src/server/routes.ts"]);
    await composer.press("ArrowDown");
    await composer.press("Tab");
    await expect(composer).toHaveValue("@./src/server/routes.ts ");
  });

  await test.step("an absolute path is completed too, and Esc puts the suggestions away", async () => {
    await composer.fill(`@${host.projectDir}/do`);
    await expect(picked).toHaveText(`${host.projectDir}/docs/`);
    await composer.press("Escape");
    await expect(menu).toBeHidden();
    await expect(composer).toHaveValue(`@${host.projectDir}/do`);
  });

  await test.step("a mention in the middle of the message is completed where the caret is", async () => {
    await composer.fill("compare @gui with this");
    for (const _ of " with this") await composer.press("ArrowLeft");
    await expect(picked).toHaveText("docs/guide.md");
    await composer.press("Enter");
    await expect(composer).toHaveValue("compare @docs/guide.md with this");
  });
});
