import { expect, test } from "bun:test";
import { englishProblem } from "../shared/host-problems.ts";
import { ideaLauncherMissing } from "../host/idea.ts";

test("without IDEA's launcher, the host says how IDEA sets one up on the host's platform", () => {
  expect(englishProblem(ideaLauncherMissing("darwin"))).toContain("In IDEA, choose Tools › Create Command Line Launcher…");
  expect(englishProblem(ideaLauncherMissing("win32"))).toContain(`Tick Add "bin" folder to the PATH in IDEA's installer, or install IDEA with the Toolbox App, then try again.`);
  expect(englishProblem(ideaLauncherMissing("win32"))).not.toContain("Create Command Line Launcher");
});
