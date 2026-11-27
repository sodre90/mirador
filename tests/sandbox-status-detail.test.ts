import { expect, test } from "bun:test";
import { statusDetailOf } from "../web/status-detail.ts";

const preparing = { busyWith: "preparing-sandbox" as const, statusDetail: null, statusProblem: undefined };

test("a conversation whose sandbox pulls its base image says how far the pull got, where the runtime says", () => {
  expect(statusDetailOf(preparing, { stage: "pulling-image", image: "team/dev:1" })).toBe("Setting up the sandbox: pulling team/dev:1…");
  expect(statusDetailOf(preparing, { stage: "pulling-image", image: "team/dev:1", percent: 45 })).toBe("Setting up the sandbox: pulling team/dev:1… 45%");
  expect(statusDetailOf(preparing, { stage: "pulling-image", image: "team/dev:1", percent: 80, unpacking: true })).toBe("Setting up the sandbox: unpacking team/dev:1… 80%");
});
