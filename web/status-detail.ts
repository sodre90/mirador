import type { Conversation } from "../shared/model.ts";
import type { SandboxSetup } from "../shared/sandbox.ts";
import { t } from "./i18n/index.ts";
import { problemText } from "./problem-text.ts";

/**
 * What the conversation's status says beyond its state: what the host is busy with in the page's language, the step of
 * the image a sandbox setting up for it builds where the setup is given, or the agent's error.
 */
export const statusDetailOf = ({ busyWith, statusDetail, statusProblem }: Pick<Conversation, "busyWith" | "statusDetail" | "statusProblem">, setup?: SandboxSetup) => {
  if (busyWith === "preparing-sandbox" && setup?.stage === "building-image" && setup.step) return t.chat.sandboxImageStep(setup.step.at, setup.step.of);
  return busyWith ? t.chat.busyWith[busyWith] : statusProblem ? problemText(statusProblem, t.problems) : statusDetail;
};
