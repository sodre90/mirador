import type { JobWait, JobWaitEnd, WaitedJob } from "./model.ts";

/** What `mirador when-done` asks the host for; without a message, the agent or you are told the job ended. */
export type JobWaitRequest = Pick<JobWait, "job" | "sshHost" | "resume"> & { message: string | null };

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** user@host or a name from the ssh config; it must not start with "-", which ssh would read as an option. */
const SSH_HOST = /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/;

export const isPid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export const isContainerName = (value: unknown): value is string => typeof value === "string" && CONTAINER_NAME.test(value);
export const isSshHost = (value: unknown): value is string => typeof value === "string" && SSH_HOST.test(value);

function waitedJob(job: unknown): WaitedJob | null {
  const { kind, pid, name } = (job ?? {}) as Record<string, unknown>;
  if (kind === "process" && isPid(pid)) return { kind, pid };
  if (kind === "container" && isContainerName(name)) return { kind, name };
  return null;
}

/** The request a script sent, or what is wrong with it. */
export function readJobWaitRequest(body: unknown): JobWaitRequest | string {
  const { job, sshHost = null, message = null, resume = true } = (body ?? {}) as Record<string, unknown>;
  const waited = waitedJob(job);
  if (!waited) return "Name the job: a process by its pid, or a container by its name or id.";
  if (sshHost !== null && !isSshHost(sshHost)) return `"${sshHost}" is not a host ssh can reach: give user@host or a name from your ssh config.`;
  if (message !== null && typeof message !== "string") return "The message must be text.";
  if (typeof resume !== "boolean") return "resume must be true or false.";
  return { job: waited, sshHost, message: message?.trim() || null, resume };
}

/** Looking at a process costs nothing; a container asks Docker, and another machine an ssh connection. */
export const checkInterval = ({ job, sshHost }: Pick<JobWait, "job" | "sshHost">) => (sshHost ? 20_000 : job.kind === "process" ? 1_000 : 5_000);

/** A failed check over ssh cannot tell an ended job from a dropped connection, so only one that sees the job gone ends the wait. */
export const FAILED_CHECKS_BEFORE_GIVING_UP = 30;

export const minutesOfFailedChecks = (wait: Pick<JobWait, "job" | "sshHost">) => Math.round((FAILED_CHECKS_BEFORE_GIVING_UP * checkInterval(wait)) / 60_000);

export const describeJob = ({ job, sshHost }: Pick<JobWait, "job" | "sshHost">) =>
  `${job.kind === "process" ? `process ${job.pid}` : `container ${job.name}`}${sshHost ? ` on ${sshHost}` : ""}`;

export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const jobEndedMessage = (wait: Pick<JobWait, "job" | "sshHost">) => `${capitalized(describeJob(wait))} ended.`;

const gaveUpReason = (wait: Pick<JobWait, "job" | "sshHost">) => `it could not be checked for ${minutesOfFailedChecks(wait)} minutes, so it may still run`;

/** What the agent gets, or you are told, when the wait ends by itself. */
export function messageAtEnd(wait: JobWait, end: Exclude<JobWaitEnd, "stopped">) {
  if (end === "ended") return wait.message;
  return `${wait.message}\n\n(Mirador stopped waiting for ${describeJob(wait)}: ${gaveUpReason(wait)}.)`;
}

/** What the agent is told once the host waits for its job. */
export function waitSetUpReply(wait: JobWait) {
  const whoHears = wait.resume ? "you get this as the user's next message" : "Mirador tells the user";
  return `Mirador waits for ${describeJob(wait)}. When it ends, ${whoHears}:\n${wait.message}${wait.resume ? "\nEnd your turn now rather than wait for it." : ""}`;
}

/** The line the conversation shows where the wait ended. */
export function jobWaitEndedNotice(wait: JobWait, end: JobWaitEnd) {
  switch (end) {
    case "ended":
      return wait.resume ? `${capitalized(describeJob(wait))} ended` : `${capitalized(describeJob(wait))} ended: ${wait.message}`;
    case "gave-up":
      return `Stopped waiting for ${describeJob(wait)}: ${gaveUpReason(wait)}`;
    case "stopped":
      return `Stopped waiting for ${describeJob(wait)}`;
  }
}
