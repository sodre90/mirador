import type { Conversation } from "../shared/model.ts";
import { toolNameOf, type SandboxSetup } from "../shared/sandbox.ts";
import { t } from "./i18n/index.ts";
import { problemText } from "./problem-text.ts";

/** How far a sandbox setting up for the conversation got, where it says: the step of the base image's build, or the tool it installs. */
function sandboxSetupStep(setup?: SandboxSetup) {
  if (setup?.stage === "building-image" && setup.step) return t.chat.sandboxImageStep(setup.step.at, setup.step.of);
  if (setup?.stage === "installing-tool" && setup.tool) return t.chat.sandboxInstalling(toolNameOf(setup.tool));
  if (setup?.stage === "pulling-image" && setup.image) return t.chat.sandboxPulling(setup.image);
  if (setup?.stage === "checking-image" && setup.image) return t.chat.sandboxChecking(setup.image);
  return null;
}

/**
 * What the conversation's status says beyond its state: what the host is busy with in the page's language, how far a
 * sandbox setting up for it got where the setup is given, or the agent's error.
 */
export const statusDetailOf = ({ busyWith, statusDetail, statusProblem }: Pick<Conversation, "busyWith" | "statusDetail" | "statusProblem">, setup?: SandboxSetup) => {
  const setupStep = busyWith === "preparing-sandbox" ? sandboxSetupStep(setup) : null;
  if (setupStep) return setupStep;
  return busyWith ? t.chat.busyWith[busyWith] : statusProblem ? problemText(statusProblem, t.problems) : statusDetail;
};
