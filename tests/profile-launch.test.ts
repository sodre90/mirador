import { expect, test } from "bun:test";
import type { ConversationService } from "../host/conversations.ts";
import { Hub, socketData, type BrowserSocket } from "../host/hub.ts";
import { ProfileService } from "../host/profiles.ts";
import { Store } from "../host/store.ts";
import type { ServerMessage } from "../shared/protocol.ts";

test("a profile's environment and prelaunch command go only to pages that edit profiles, not to the phone app, which gets its colour", () => {
  const hub = new Hub();
  const socketThatReadsProfileLaunch = (readsProfileLaunch: boolean) => {
    const received: ServerMessage[] = [];
    const data = socketData("page", "a-device", "", undefined, false, readsProfileLaunch);
    hub.add({ data, send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket);
    return received;
  };
  const page = socketThatReadsProfileLaunch(true);
  const phone = socketThatReadsProfileLaunch(false);

  const launch = { environment: "ANTHROPIC_API_KEY=sk-secret", prelaunch: "source ~/.work-keys" };
  new ProfileService(new Store(":memory:"), hub, {} as ConversationService).save({ name: "Work", harness: "claude", ...launch, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: "rose" });

  expect(page).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", ...launch, color: "rose" } }]);
  expect(phone).toMatchObject([{ type: "profile.upserted", profile: { name: "Work", environment: "", prelaunch: "", color: "rose" } }]);
});

test("a profile takes one of the workspace colours, and changing it alone leaves its agent running", () => {
  const restarted: string[] = [];
  const profiles = new ProfileService(new Store(":memory:"), new Hub(), { restartProfile: (profileId: string) => restarted.push(profileId) } as unknown as ConversationService);
  const draft = { name: "Work", harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null } as const;
  const saved = profiles.save(draft);

  expect(profiles.save({ ...draft, id: saved.id, color: "teal" }).color).toBe("teal");
  expect(restarted).toEqual([]);
  expect(() => profiles.save({ ...draft, color: "plaid" as never })).toThrow("Unknown colour plaid.");
});
