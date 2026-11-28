import { expect, test } from "bun:test";
import type { SandboxSetup, SetupStep } from "../shared/sandbox.ts";
import { clockText, progressOf, roomLineWaitingForSandbox, stepText } from "../web/sandbox-setup-steps.ts";
import { statusDetailOf } from "../web/status-detail.ts";

const preparing = { busyWith: "preparing-sandbox" as const, statusDetail: null, statusProblem: undefined };

const steps: SetupStep[] = [
  { piece: { kind: "service", runtime: "apple-container" }, state: "done" },
  { piece: { kind: "base-pull", image: "team/dev:1" }, state: "now" },
  { piece: { kind: "tool", tool: { kind: "guard" } }, state: "waiting" },
  { piece: { kind: "base-check", image: "team/dev:1" }, state: "waiting" },
];
const pulling: SandboxSetup = { stage: "pulling-image", image: "team/dev:1", percent: 45, steps };

test("a conversation whose sandbox is set up says the step it is on, of how many", () => {
  expect(statusDetailOf(preparing, pulling)).toBe("Setting up the sandbox, step 2 of 4: Pull team/dev:1");
});

test("a conversation whose sandbox waits behind another sandbox's setup says so", () => {
  const waiting = steps.map((step) => (step.state === "now" ? { ...step, state: "waiting" as const } : step));
  expect(statusDetailOf(preparing, { ...pulling, steps: waiting, waitingBehind: { kind: "tool", tool: { kind: "claude", version: "1" } } })).toBe(
    "Setting up the sandbox: waiting for another sandbox's setup…",
  );
});

test("a conversation whose sandbox setup has no steps yet says what the host is busy with", () => {
  expect(statusDetailOf(preparing, { stage: "starting-service" })).toBe(statusDetailOf(preparing));
});

test("a room's line says its agent waits for the room's sandbox: the setup's step, of how many, or its start", () => {
  expect(roomLineWaitingForSandbox("Builder", "preparing-sandbox", pulling)).toBe("Builder waits for the room's sandbox to be set up, step 2 of 4: Pull team/dev:1");
  expect(roomLineWaitingForSandbox("Builder", "starting-sandbox", pulling)).toBe("Builder waits for the room's sandbox to start…");
});

test("a room's line says its agent waits for the room's sandbox to be set up, where the setup has no steps yet or waits behind another sandbox's", () => {
  expect(roomLineWaitingForSandbox("Builder", "preparing-sandbox", { stage: "starting-service" })).toBe("Builder waits for the room's sandbox to be set up…");
  expect(roomLineWaitingForSandbox("Builder", "preparing-sandbox", { ...pulling, waitingBehind: { kind: "tool", tool: { kind: "claude", version: "1" } } })).toBe(
    "Builder waits for the room's sandbox to be set up: waiting for another sandbox's setup…",
  );
});

test("a room's line says nothing of the sandbox where its agent's conversation waits for none", () => {
  expect([undefined, "making-worktree" as const].map((busyWith) => roomLineWaitingForSandbox("Builder", busyWith, pulling))).toEqual([null, null]);
});

test("the steps count those done, and the one it is on goes by its place: under way or failed, else the first still to come", () => {
  expect(progressOf(steps)).toEqual({ done: 1, at: 2, of: 4, current: steps[1] });
  const pullingBesideTheOthers = steps.map((step, place) => (place === 2 ? { ...step, state: "done" as const } : step));
  expect(progressOf(pullingBesideTheOthers)).toMatchObject({ done: 2, at: 2 });
  const failedCheck = steps.map((step, place) => ({ ...step, state: place === 3 ? ("failed" as const) : ("done" as const) }));
  expect(progressOf(failedCheck)).toMatchObject({ done: 3, at: 4, current: failedCheck[3] });
  const waitingBehind = steps.map((step, place) => ({ ...step, state: place === 0 ? ("done" as const) : ("waiting" as const) }));
  expect(progressOf(waitingBehind)).toMatchObject({ done: 1, at: 2 });
  const allDone = steps.map((step) => ({ ...step, state: "done" as const }));
  expect(progressOf(allDone)).toEqual({ done: 4, at: 4, of: 4, current: null });
});

test("each step reads in plain words, the guard by its own name", () => {
  expect(steps.map(({ piece }) => stepText(piece))).toEqual([
    "Start Apple's container service",
    "Pull team/dev:1",
    "Build Mirador's guard",
    "Check that team/dev:1 has what the agents need",
  ]);
});

test("a stretch of time reads as a clock shows it", () => {
  expect([7_400, 750_000, 3_723_000].map(clockText)).toEqual(["0:07", "12:30", "1:02:03"]);
});
