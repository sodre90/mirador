import { describe, expect, test } from "bun:test";
import { environmentForSandbox, profileSandboxBlocker } from "../host/sandbox/sandbox-control.ts";
import { setupTokenCaught } from "../host/sandbox/sandbox-sign-in.ts";
import { Store } from "../host/store.ts";
import { MASKED_SECRET } from "../host/terminals.ts";
import type { HostProblem } from "../shared/host-problems.ts";
import type { ConversationEvent, Profile, StoredEvent } from "../shared/model.ts";
import { NO_ENVIRONMENT_CHOICES } from "../shared/room-agent-setup.ts";
import { wantsSandboxSignIn, type SandboxBlocker } from "../shared/sandbox.ts";
import { buildTimeline } from "../shared/timeline.ts";
import { messageLeftForSandboxSignIn } from "../shared/try-again.ts";

const TOKEN = `sk-ant-oat01-${"x".repeat(40)}`;

const claude: Profile = { id: "p1", name: "Claude Personal", harness: "claude", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 };

const signsInElsewhere = (how: "subscription" | "bedrock"): SandboxBlocker => ({ kind: "agent-signs-in-elsewhere", agent: "Claude Personal", how });

const refused = (blocker: SandboxBlocker, code: "sandbox-not-ready" | "workspace-sandbox-not-ready" = "sandbox-not-ready"): HostProblem => ({ code, why: { kind: "blocked", blocker } });

const refusedTurn = (problem: HostProblem): ConversationEvent => ({ type: "error", message: "The sandbox can't run it.", problem, endsTurn: true });

function stored(events: ConversationEvent[]): StoredEvent[] {
  return events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 1000, event }));
}

describe("the environment a profile's agent gets in a sandbox", () => {
  test("a Claude subscription gets the token kept for sandboxes", () => {
    expect(environmentForSandbox(claude, { ANTHROPIC_BASE_URL: "https://models.example" }, TOKEN)).toEqual({ ANTHROPIC_BASE_URL: "https://models.example", CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  });

  test("a key of its own, another cloud, another agent kind or no token kept leave it as it is", () => {
    expect(environmentForSandbox(claude, { ANTHROPIC_API_KEY: "key" }, TOKEN)).toEqual({ ANTHROPIC_API_KEY: "key" });
    expect(environmentForSandbox(claude, { CLAUDE_CODE_USE_BEDROCK: "1" }, TOKEN)).toEqual({ CLAUDE_CODE_USE_BEDROCK: "1" });
    expect(environmentForSandbox({ ...claude, harness: "pi" }, {}, TOKEN)).toEqual({});
    expect(environmentForSandbox(claude, {}, null)).toEqual({});
  });

  test("a Claude subscription can't run in a sandbox until its token is kept", () => {
    expect(profileSandboxBlocker(claude, NO_ENVIRONMENT_CHOICES, null)).toEqual(signsInElsewhere("subscription"));
    expect(profileSandboxBlocker(claude, NO_ENVIRONMENT_CHOICES, TOKEN)).toBeNull();
    expect(profileSandboxBlocker({ ...claude, environment: "CLAUDE_CODE_USE_BEDROCK=1" }, NO_ENVIRONMENT_CHOICES, TOKEN)).toEqual(signsInElsewhere("bedrock"));
  });
});

describe("the token `claude setup-token` prints", () => {
  test("is caught and masked, and the output around it shows", () => {
    const caught: string[] = [];
    expect(setupTokenCaught((token) => caught.push(token)).masked(`Your token:\r\n${TOKEN}\r\nStore it safely.`, true)).toEqual({ shown: `Your token:\r\n${MASKED_SECRET}\r\nStore it safely.`, held: "" });
    expect(caught).toEqual([TOKEN]);
  });

  test("waits for the output after it where it may go on there, and is caught whole once it ends", () => {
    const caught: string[] = [];
    const secret = setupTokenCaught((token) => caught.push(token));
    const first = secret.masked(`Token: ${TOKEN.slice(0, 30)}`, true);
    expect(first).toEqual({ shown: "Token: ", held: TOKEN.slice(0, 30) });
    expect(caught).toEqual([]);
    expect(secret.masked(`${first.held}${TOKEN.slice(30)}\r\n`, true)).toEqual({ shown: `${MASKED_SECRET}\r\n`, held: "" });
    expect(caught).toEqual([TOKEN]);
  });

  test("the start of a token's lead waits too, and nothing waits once the program ends", () => {
    const caught: string[] = [];
    const secret = setupTokenCaught((token) => caught.push(token));
    expect(secret.masked("Token: sk-an", true)).toEqual({ shown: "Token: ", held: "sk-an" });
    expect(secret.masked(`Token: ${TOKEN}`, false)).toEqual({ shown: `Token: ${MASKED_SECRET}`, held: "" });
    expect(caught).toEqual([TOKEN]);
    expect(secret.masked("Bye.", true)).toEqual({ shown: "Bye.", held: "" });
  });
});

describe("a turn the sandbox refused for want of a sandbox sign-in", () => {
  test("is one where a Claude subscription can't sign in there", () => {
    expect(wantsSandboxSignIn(refused(signsInElsewhere("subscription")))).toBe(true);
    expect(wantsSandboxSignIn(refused(signsInElsewhere("subscription"), "workspace-sandbox-not-ready"))).toBe(true);
    expect(wantsSandboxSignIn(refused(signsInElsewhere("bedrock")))).toBe(false);
    expect(wantsSandboxSignIn({ code: "sandbox-not-ready", why: { kind: "could-not-start", cause: "no VM" } })).toBe(false);
    expect(wantsSandboxSignIn(undefined)).toBe(false);
  });

  test("leaves its message to go again once signed in, while it is still the latest turn", () => {
    const message: ConversationEvent = { type: "user-message", text: "hi", authorId: "owner" };
    const refusal = refusedTurn(refused(signsInElsewhere("subscription")));
    expect(messageLeftForSandboxSignIn(stored([message, refusal, { type: "sandbox-sign-in-ended", signedIn: true }]))).toEqual(message);
    expect(messageLeftForSandboxSignIn(stored([message, refusal, { type: "user-message", text: "never mind" }]))).toBeNull();
    expect(messageLeftForSandboxSignIn(stored([message, refusal, { type: "context-cleared" }]))).toBeNull();
    expect(messageLeftForSandboxSignIn(stored([message, refusedTurn(refused(signsInElsewhere("bedrock")))]))).toBeNull();
    expect(messageLeftForSandboxSignIn(stored([message, { ...refusal, continuable: true } as ConversationEvent]))).toBeNull();
  });

  test("offers the sign-in on its error until one succeeds, and each sign-in says how it ended", () => {
    const refusal = refusedTurn(refused(signsInElsewhere("subscription")));
    const errorsOf = (events: ConversationEvent[]) =>
      buildTimeline(stored(events)).flatMap((block) => (block.kind === "error" ? [{ wants: block.wantsSandboxSignIn, since: block.sandboxSignedInSince }] : []));
    const noticesOf = (events: ConversationEvent[]) => buildTimeline(stored(events)).flatMap((block) => (block.kind === "notice" ? [block.about.kind] : []));
    const unfinished: ConversationEvent = { type: "sandbox-sign-in-ended", signedIn: false };
    const signedIn: ConversationEvent = { type: "sandbox-sign-in-ended", signedIn: true };
    expect(errorsOf([{ type: "user-message", text: "hi" }, refusal, unfinished])).toEqual([{ wants: true, since: undefined }]);
    expect(errorsOf([{ type: "user-message", text: "hi" }, refusal, unfinished, signedIn])).toEqual([{ wants: true, since: true }]);
    expect(noticesOf([refusal, unfinished, signedIn])).toEqual(["sandbox-sign-in-unfinished", "sandbox-signed-in"]);
    expect(errorsOf([refusedTurn(refused(signsInElsewhere("bedrock")))])).toEqual([{ wants: undefined, since: undefined }]);
  });
});

describe("a profile's sandbox sign-in, as the store keeps it", () => {
  test("the profile only says it has one, and saving the profile again keeps it until it is taken away", () => {
    const store = new Store(":memory:");
    store.saveProfile(claude);
    expect(store.sandboxSignInOf("p1")).toBeNull();
    store.setSandboxSignIn("p1", TOKEN);
    expect(store.sandboxSignInOf("p1")).toBe(TOKEN);
    expect(store.findProfile("p1")).toEqual({ ...claude, sandboxSignedIn: true });
    expect(JSON.stringify(store.findProfile("p1"))).not.toContain(TOKEN);
    store.saveProfile({ ...claude, name: "Personal" });
    expect(store.sandboxSignInOf("p1")).toBe(TOKEN);
    store.setSandboxSignIn("p1", null);
    expect(store.findProfile("p1")).toEqual({ ...claude, name: "Personal" });
  });
});
