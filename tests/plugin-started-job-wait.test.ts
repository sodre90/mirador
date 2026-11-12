import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService, type HearReply } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { JobWaits } from "../host/job-waits.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import type { ConversationReply } from "../shared/canvas-plugins.ts";
import type { JobWait, JobWaitEnd } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "plugin-started-job-wait-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const quietAgent = {
  spec: { id: "opencode", label: "opencode" },
  start: async () => ({}),
  newSession: async () => ({ sessionId: `caller-${crypto.randomUUID()}` }),
  prompt: async () => ({ stopReason: "end_turn" }),
  closeSession: async () => {},
};

interface ConversationInternals {
  jobWaits: JobWaits;
  republish(conversationId: string): void;
  jobWaitEnded(conversationId: string, wait: JobWait, end: Exclude<JobWaitEnd, "stopped">): void;
}

/**
 * A caller whose plugin starts a helper whose first turn leaves a job running and has the host wait for it, as an agent
 * running a long test suite with nohup and `mirador when-done` does; every later turn ends at once. With `staysInItsTurn`,
 * that first turn goes on until it is stopped. The job runs until `endTheJob`, and the host looks at it every few milliseconds.
 */
function helperLeavingAJob({ resume, staysInItsTurn = false }: { resume: boolean; staysInItsTurn?: boolean }) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  const profile = { prelaunch: "", model: null, mode: null, bypassPermissions: false, askMode: "wait" as const, color: null, createdAt: 1 };
  store.saveProfile({ ...profile, id: "caller", name: "Caller", harness: "opencode", environment: "", effort: null });
  store.saveProfile({ ...profile, id: "helper", name: "Helper", harness: "opencode", environment: "", effort: null });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness: "opencode", profileId: "caller" }, createdAt: 1 });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  const notifier = { mute() {}, unmute() {} };
  const conversations = new ConversationService(store, new Hub(), config, notifier as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));

  let jobRuns = true;
  const internals = conversations as unknown as ConversationInternals;
  internals.jobWaits = new JobWaits(
    store,
    { changed: (conversationId) => internals.republish(conversationId), ended: (conversationId, wait, end) => internals.jobWaitEnded(conversationId, wait, end) },
    async () => (jobRuns ? "running" : "ended"),
    () => 5,
  );

  let helperId = "";
  let turns = 0;
  const jobLeft = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const helper = {
    spec: { id: "opencode", label: "opencode" },
    start: async () => ({}),
    newSession: async () => ({ sessionId: `helper-${crypto.randomUUID()}` }),
    prompt: async () => {
      turns += 1;
      if (turns > 1) return { stopReason: "end_turn" };
      await conversations.waitForJob(helperId, { job: { kind: "process", pid: 4242 }, sshHost: null, message: "The tests ended.", resume });
      jobLeft.resolve();
      if (!staysInItsTurn) return { stopReason: "end_turn" };
      await stopped.promise;
      return { stopReason: "cancelled" };
    },
    cancel: async () => stopped.resolve(),
    closeSession: async () => {},
  };
  const agentProcesses = (conversations as unknown as { agentProcesses: Map<string, unknown> }).agentProcesses;
  agentProcesses.set("caller", quietAgent);
  agentProcesses.set("helper", helper);

  const replies: ConversationReply[] = [];
  const replied = Promise.withResolvers<void>();
  const hearReply: HearReply = (_started, _startedBy, reply) => {
    replies.push(reply);
    replied.resolve();
  };
  conversations.hearRepliesWith(hearReply, () => true);
  const firstTurnEnded = Promise.withResolvers<void>();
  conversations.hearActivityWith((conversationId, activity) => {
    if (conversationId === helperId && activity.kind === "turn-ended") firstTurnEnded.resolve();
  });

  const caller = conversations.create("w1");
  helperId = conversations.startBeside(caller.id, "board", "Helper", "Fix the bug, then run the whole suite").id;
  return {
    conversations,
    callerId: caller.id,
    helperId,
    replies,
    replied: replied.promise,
    firstTurnEnded: firstTurnEnded.promise,
    jobLeft: jobLeft.promise,
    turns: () => turns,
    endTheJob: () => void (jobRuns = false),
    stopWatchingJobs: () => internals.jobWaits.stopAll(),
  };
}

const heardWithin = (replied: Promise<void>, ms = 60) => Promise.race([replied.then(() => true), Bun.sleep(ms).then(() => false)]);

test("a helper whose turn ends waiting for a job that wakes it is heard of once the turn after the wake-up ends", async () => {
  const { replies, replied, firstTurnEnded, turns, endTheJob, stopWatchingJobs } = helperLeavingAJob({ resume: true });

  await firstTurnEnded;
  expect(await heardWithin(replied), "waiting for its tests is not the end of its work").toBe(false);

  endTheJob();
  await replied;
  expect(turns(), "the job woke it for a second turn").toBe(2);
  expect(replies).toEqual([{ text: null, ended: "finished" }]);
  stopWatchingJobs();
});

test("a job that only tells the user when it ends doesn't hold the reply back", async () => {
  const { replies, replied, turns, stopWatchingJobs } = helperLeavingAJob({ resume: false });

  await replied;
  expect(turns()).toBe(1);
  expect(replies).toEqual([{ text: null, ended: "finished" }]);
  stopWatchingJobs();
});

test("stopping the wait while the helper rests hands the plugin its reply then, and the job wakes nobody", async () => {
  const { conversations, helperId, replies, replied, firstTurnEnded, turns, endTheJob, stopWatchingJobs } = helperLeavingAJob({ resume: true });
  await firstTurnEnded;

  const [wait] = conversations.get(helperId).jobWaits;
  conversations.stopWaitingForJob(helperId, wait!.id);
  await replied;
  expect(replies).toEqual([{ text: null, ended: "finished" }]);

  endTheJob();
  await Bun.sleep(40);
  expect(turns()).toBe(1);
  stopWatchingJobs();
});

test("the plugin stopping a helper that rests until its job ends hears it stopped, and the job no longer wakes it", async () => {
  const { conversations, callerId, helperId, replies, replied, firstTurnEnded, turns, endTheJob, stopWatchingJobs } = helperLeavingAJob({ resume: true });
  await firstTurnEnded;

  await conversations.stopStarted(callerId, "board", helperId);
  await replied;
  expect(replies).toEqual([{ text: null, ended: "stopped" }]);
  expect(conversations.get(helperId).jobWaits).toEqual([]);

  endTheJob();
  await Bun.sleep(40);
  expect(turns()).toBe(1);
  stopWatchingJobs();
});

test("the plugin stopping a helper mid-turn, after it left a job that would wake it, hears it stopped, and the job no longer wakes it", async () => {
  const { conversations, callerId, helperId, replies, replied, jobLeft, turns, endTheJob, stopWatchingJobs } = helperLeavingAJob({ resume: true, staysInItsTurn: true });
  await jobLeft;

  await conversations.stopStarted(callerId, "board", helperId);
  await replied;
  expect(replies).toEqual([{ text: null, ended: "stopped" }]);
  expect(conversations.get(helperId).jobWaits).toEqual([]);

  endTheJob();
  await Bun.sleep(40);
  expect(turns()).toBe(1);
  stopWatchingJobs();
});
