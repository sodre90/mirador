import type { Conversation } from "../shared/model.ts";
import type { SandboxSetup } from "../shared/sandbox.ts";
import { t } from "./i18n/index.ts";
import { problemText } from "./problem-text.ts";
import { setupStatusText } from "./sandbox-setup-steps.ts";

/**
 * What the conversation's status says beyond its state: what the host is busy with in the page's language, how far a
 * sandbox setting up for it got where the setup is given, or the agent's error.
 */
export const statusDetailOf = ({ busyWith, statusDetail, statusProblem }: Pick<Conversation, "busyWith" | "statusDetail" | "statusProblem">, setup?: SandboxSetup) => {
  const setupStep = busyWith === "preparing-sandbox" && setup ? setupStatusText(setup) : null;
  if (setupStep) return setupStep;
  return busyWith ? t.chat.busyWith[busyWith] : statusProblem ? problemText(statusProblem, t.problems) : statusDetail;
};
