import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import { Store } from "../host/store.ts";
import { englishProblem, HostProblemError } from "../shared/host-problems.ts";
import type { ProfileDraft } from "../shared/protocol.ts";
import { fakeProgram } from "./fake-program.ts";

const scratch = mkdtempSync(join(tmpdir(), "profile-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fakeAgent = join(import.meta.dirname, "..", "e2e", "fake-acp-agent.ts");

/** An `agy` in a folder of its own, running `script` on this Bun: Windows runs no script without an extension. */
function agyRunning(script: string) {
  const folder = join(scratch, `programs-${crypto.randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  return fakeProgram(folder, "agy", script);
}

/** An `agy` that is the fake ACP agent, so a profile's test starts an agent that says what it offers. */
const fakeAgy = () => agyRunning(`await import(${JSON.stringify(pathToFileURL(fakeAgent).href)});\n`);

const serviceWith = (drafts: ProfileDraft[] = []) => {
  const store = new Store(":memory:");
  drafts.forEach((draft) => store.saveProfile({ ...draft, id: draft.id!, name: draft.name, model: draft.model ?? null, mode: draft.mode ?? null, effort: draft.effort ?? null, createdAt: 1 }));
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) });
  return new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
};

const draftWith = (environment: string, prelaunch = ""): ProfileDraft => ({
  name: "tested",
  harness: "antigravity",
  environment,
  prelaunch,
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
});

const failureOf = async (service: ConversationService, draft: ProfileDraft) => {
  try {
    await service.testProfile(draft);
  } catch (error) {
    return error as HostProblemError;
  }
  throw new Error("the test was expected to fail");
};

describe("a profile's test", () => {
  test("lists what the agent offers, from an environment that is not saved yet", async () => {
    const result = await serviceWith().testProfile(draftWith(`AGY_PATH=${fakeAgy()}\nFAKE_ACP_MODES=1\nFAKE_ACP_MODELS=1`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configOptions.map(({ id }) => id)).toEqual(["model", "mode", "effort"]);
    expect(result.configOptions[0]).toMatchObject({ category: "model", currentValue: "default" });
    expect(result.tookMs).toBeGreaterThanOrEqual(0);
  });

  test("says the pre-launch command failed, and what it printed", async () => {
    const error = await failureOf(serviceWith(), draftWith(`AGY_PATH=${fakeAgy()}`, "echo gateway down >&2; exit 3"));
    expect(error).toBeInstanceOf(HostProblemError);
    expect(error.problem).toMatchObject({ code: "prelaunch-failed", failure: { kind: "exited", how: "3" } });
    expect(englishProblem(error.problem)).toContain("gateway down");
  });

  test("says the agent went away when it exits as it starts", async () => {
    const program = agyRunning(`console.error("cannot reach the gateway");\nprocess.exit(1);\n`);
    const error = await failureOf(serviceWith(), draftWith(`AGY_PATH=${program}`));
    expect(error.problem).toMatchObject({ code: "agent-gone", gone: { kind: "exited", how: "1" } });
  });
});

describe("a profile editor's silent probe", () => {
  test("keeps what its conversations knew when the agent cannot answer", async () => {
    const service = serviceWith([{ ...draftWith(`AGY_PATH=${fakeAgy()}`, "exit 2"), id: "p1" }]);
    expect(await service.profileChoices("p1")).toBeNull();
  });
});
