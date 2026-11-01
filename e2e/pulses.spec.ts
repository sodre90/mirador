import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addWorkspace, createProfile, openSettings, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

/** An opencode that is the scripted agent, which never finishes a WEDGE prompt, so its conversation stays running. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
}

test.beforeAll(async () => {
  fakeOpencode();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const linuxDesktopApp = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function signedInAs(browser: Browser, userAgent: string) {
  const page = await browser.newPage({ userAgent });
  await signIn(page, host);
  return page;
}

const runningDotAnimation = (page: Page) =>
  page
    .locator(".dot.status-running")
    .first()
    .evaluate((dot) => {
      const { animationName, animationTimingFunction } = getComputedStyle(dot);
      return { animationName, animationTimingFunction };
    });

const pulsePhases = (page: Page) =>
  page.evaluate(() => {
    const pulses = document.getAnimations().filter((animation) => animation instanceof CSSAnimation && animation.animationName === "pulse");
    return { pulses: pulses.length, startTimes: [...new Set(pulses.map((pulse) => pulse.startTime))] };
  });

test("on Linux the running dots pulse in a few steps rather than every frame and all in one phase, Settings can stop the pulse, and reduced motion stops it", async ({
  browser,
}) => {
  const linux = await signedInAs(browser, linuxDesktopApp);
  await addWorkspace(linux, host.projectDir);
  const profiles = await createProfile(linux, "wedged", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await linux.getByLabel("Agent", { exact: true }).selectOption({ label: "wedged · opencode" });
  await linux.getByRole("button", { name: "+ New conversation" }).click();
  await expect(linux).toHaveURL(/#\/c\/.+$/);
  await sendMessage(linux, "WEDGE");
  await expect(linux.locator(".chat-header:visible .badge")).toHaveText("running", { timeout: 30_000 });

  await test.step("Linux steps the pulse", async () => {
    const { animationName, animationTimingFunction } = await runningDotAnimation(linux);
    expect(animationName).toBe("pulse");
    expect(animationTimingFunction).toMatch(/^steps\(4/);
  });

  await test.step("a dot that starts later pulses in the same phase, so their steps change in one frame", async () => {
    await linux.getByRole("button", { name: "+ New conversation" }).click();
    await sendMessage(linux, "WEDGE");
    await expect(linux.locator(".chat-header:visible .badge")).toHaveText("running", { timeout: 30_000 });
    await expect.poll(() => pulsePhases(linux)).toEqual({ pulses: expect.any(Number), startTimes: [0] });
    expect((await pulsePhases(linux)).pulses).toBeGreaterThanOrEqual(2);
  });

  await test.step("turning the pulse off in Settings stops it, and stays remembered", async () => {
    const settings = await openSettings(linux);
    await settings.getByLabel("Pulse status dots").uncheck();
    await expect.poll(async () => (await runningDotAnimation(linux)).animationName).toBe("none");
    await linux.reload();
    await expect.poll(async () => (await runningDotAnimation(linux)).animationName).toBe("none");
  });

  const macPage = await signedInAs(browser, mac);
  await test.step("macOS keeps the smooth pulse", async () => {
    expect(await runningDotAnimation(macPage)).toEqual({ animationName: "pulse", animationTimingFunction: "ease" });
  });

  await test.step("a system asking for reduced motion stops it", async () => {
    await macPage.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => (await runningDotAnimation(macPage)).animationName).toBe("none");
  });
  await Promise.all([linux.close(), macPage.close()]);
});
