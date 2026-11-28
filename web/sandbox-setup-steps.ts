import { toolNameOf, type SandboxSetup, type SetupPiece, type SetupStep } from "../shared/sandbox.ts";
import { t } from "./i18n/index.ts";

const words = t.rooms.sandbox.steps;

/** A step of setting a sandbox up in plain words, the same in its settings and in the conversations that wait for it. */
export function stepText(piece: SetupPiece) {
  switch (piece.kind) {
    case "service":
      return words.service[piece.runtime];
    case "base-build":
      return words.baseBuild;
    case "base-pull":
      return words.basePull(piece.image);
    case "base-check":
      return words.baseCheck(piece.image);
    case "tool":
      return piece.tool.kind === "guard" ? words.guard : words.tool(toolNameOf(piece.tool));
    case "agent-check":
      return words.agentCheck(toolNameOf(piece.tool), piece.image);
  }
}

/**
 * How far the steps got: how many are done, and the one it is on, by its place among them: the one under way or failed,
 * else the first still to come, as steps are not always taken in their order.
 */
export function progressOf(steps: SetupStep[]) {
  const done = steps.filter(({ state }) => state === "done").length;
  const current = steps.find(({ state }) => state === "now" || state === "failed") ?? steps.find(({ state }) => state !== "done") ?? null;
  return { done, at: current ? steps.indexOf(current) + 1 : steps.length, of: steps.length, current };
}

/** A stretch of time as a clock shows it: 0:07, 12:30, 1:02:03. */
export function clockText(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const [hours, minutes] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60)];
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds % 60)}` : `${minutes}:${twoDigits(seconds % 60)}`;
}

/** The status line of a conversation that waits for its sandbox: the step it is on, of how many, or that it waits for another sandbox's. */
export function setupStatusText({ steps, waitingBehind }: SandboxSetup) {
  if (!steps) return null;
  if (waitingBehind) return t.chat.sandboxSetupWaiting;
  const { at, of, current } = progressOf(steps);
  return current ? t.chat.sandboxSetupStep(at, of, stepText(current.piece)) : null;
}
