import type { JobWait } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

const words = t.shell.sidebar;

type DescribedWait = Pick<JobWait, "job" | "sshHost" | "resume">;

function describeJob({ job, sshHost }: DescribedWait) {
  const named = job.kind === "process" ? words.process(job.pid) : words.container(job.name);
  return sshHost ? words.jobOnHost(named, sshHost) : named;
}

/** What the sidebar says of a conversation that waits on jobs, a line for each. */
export const waitingOnJobsHint = (waits: DescribedWait[]) =>
  waits.map((wait) => (wait.resume ? words.waitingForJob(describeJob(wait)) : words.waitingForJobToTellYou(describeJob(wait)))).join("\n");
