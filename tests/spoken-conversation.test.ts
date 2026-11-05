import { describe, expect, test } from "bun:test";
import type { AskItem, ConversationEvent, StoredEvent } from "../shared/model.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { APPROVAL_NEEDED, SpokenConversation, KEEP_LISTENING_MS, NO_REPLY, SAID_ALOUD, type ReadingOutcome, type SpokenConversationEffects } from "../shared/spoken-conversation.ts";


const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Car mode with effects that write down what it did, speaking to the end unless told otherwise. */
function carMode({ connected = true, speaking = { kind: "heard" } as ReadingOutcome } = {}) {
  const did: string[] = [];
  const said: string[][] = [];
  const answers: { itemId: string; label: string; note?: string }[] = [];
  let now = 0;
  const effects: SpokenConversationEffects = {
    chime: async (chime) => void did.push(`chime ${chime}`),
    listen: () => {
      did.push("listen");
      loop.microphoneOpened();
    },
    stopListening: () => void did.push("stop listening"),
    send: (message) => {
      did.push(`send ${message}`);
      return connected;
    },
    readReply: async (key) => {
      did.push(`read ${key}`);
      return speaking;
    },
    say: async (key, sentences) => {
      did.push(`say ${key}`);
      said.push(sentences);
      return speaking;
    },
    stopSpeaking: () => void did.push("stop speaking"),
    answer: (itemId, answer) => void answers.push({ itemId, ...answer }),
    ticking: (on) => void did.push(on ? "tick" : "quiet"),
    changed: () => {},
    now: () => now,
  };
  const loop = new SpokenConversation(effects);
  return { loop, did, said, answers, later: (ms: number) => void (now += ms) };
}

const reply = { key: "r1", text: "The tests pass." };

const ask = (options: { label: string; recommended?: boolean }[]): AskItem =>
  ({ id: "a1", kind: "ask", status: "waiting", question: "Which way?", options }) as unknown as AskItem;

describe("a spoken conversation", () => {
  test("a tap listens, what is said is sent, the reply is read, then it listens again", async () => {
    const { loop, did } = carMode();
    loop.tap();
    await settle();
    expect(loop.phase).toBe("listening");
    loop.heard("Run the tests.");
    expect(loop.phase).toBe("working");
    loop.turnEnded(reply);
    await settle();
    expect(did).toEqual(["chime listening", "listen", "chime heard", "send Run the tests.", "tick", "quiet", "read r1", "chime listening", "listen"]);
    expect(loop.phase).toBe("listening");
  });

  test("it says it listens only once the recognizer has started, and listens until two minutes after the tap", async () => {
    const states: boolean[] = [];
    const until: number[] = [];
    const { loop } = carMode();
    const effects = (loop as unknown as { effects: SpokenConversationEffects }).effects;
    effects.changed = (state) => void states.push(state.microphoneOpen);
    effects.listen = (deadline) => void until.push(deadline);
    loop.tap();
    await settle();
    expect(states).toEqual([false]);
    loop.microphoneOpened();
    expect(states).toEqual([false, true]);
    expect(until).toEqual([KEEP_LISTENING_MS]);
  });

  test("stop or thanks, in English or Hungarian, ends it without sending", async () => {
    for (const words of ["Thanks.", "Köszönöm szépen!", "állj meg"]) {
      const { loop, did } = carMode();
      loop.tap();
      await settle();
      loop.heard(words);
      expect(loop.phase).toBe("idle");
      expect(did.some((each) => each.startsWith("send"))).toBe(false);
    }
  });

  test("noise listens on while its two minutes last, then the microphone closes", async () => {
    const { loop, did, later } = carMode();
    loop.tap();
    await settle();
    loop.heard("Öö. Hát.");
    await settle();
    expect(did.filter((each) => each === "chime listening")).toHaveLength(2);
    loop.heardNothing();
    expect(did.filter((each) => each === "listen")).toHaveLength(3);
    later(KEEP_LISTENING_MS);
    loop.heardNothing();
    expect(loop.phase).toBe("idle");
  });

  test("repeat reads the last reply again; help says what can be said", async () => {
    const { loop, did, said } = carMode();
    loop.tap();
    await settle();
    loop.heard("Run the tests");
    loop.turnEnded(reply);
    await settle();
    loop.heard("ismételd meg");
    await settle();
    expect(did.filter((each) => each === "read r1")).toHaveLength(2);
    loop.heard("help");
    await settle();
    expect(said.at(-1)![0]).toContain("Say stop");
    expect(loop.phase).toBe("listening");
  });

  test("a turn without a reply says so and listens again; one the machine can't take says why", async () => {
    const { loop, said } = carMode();
    loop.tap();
    await settle();
    loop.heard("Run the tests");
    loop.turnEnded(null);
    await settle();
    expect(said).toEqual([NO_REPLY]);
    expect(loop.phase).toBe("listening");

    const offline = carMode({ connected: false });
    offline.loop.tap();
    await settle();
    offline.loop.heard("Run the tests");
    expect(offline.loop.phase).toBe("idle");
    expect(offline.did.filter((each) => each === "tick")).toHaveLength(0);
    expect(offline.did).toContain("chime trouble");
  });

  test("a reply voice that fails stops the loop with its problem rather than staying silent", async () => {
    const changes: string[] = [];
    const { loop } = carMode({ speaking: { kind: "failed", problem: "voice not loaded" } });
    const effects = (loop as unknown as { effects: SpokenConversationEffects }).effects;
    effects.changed = (state) => void changes.push(state.problem ?? "");
    loop.tap();
    await settle();
    loop.heard("Run the tests");
    loop.turnEnded(reply);
    await settle();
    expect(loop.phase).toBe("idle");
    expect(changes.at(-1)).toBe("voice not loaded");
  });

  test("a question is asked aloud: yes takes the recommended option, in Hungarian too", async () => {
    const { loop, answers } = carMode();
    loop.tap();
    await settle();
    loop.heard("Refactor the parser");
    loop.asked(ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]));
    await settle();
    expect(loop.phase).toBe("listening");
    loop.heard("Igen.");
    expect(answers).toEqual([{ itemId: "a1", label: "Small steps" }]);
    expect(loop.phase).toBe("working");
    loop.asked(ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]));
    expect(loop.phase).toBe("working");
  });

  test("the others are read before a number picks one; other words go to the agent as the answer", async () => {
    const { loop, answers, said } = carMode();
    loop.tap();
    await settle();
    loop.heard("Refactor the parser");
    loop.asked(ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]));
    await settle();
    loop.heard("a többit");
    await settle();
    expect(said.at(-1)).toContain("Two: Rewrite.");
    loop.heard("kettes");
    expect(answers).toEqual([{ itemId: "a1", label: "Rewrite" }]);

    const free = carMode();
    free.loop.tap();
    await settle();
    free.loop.heard("Refactor the parser");
    free.loop.asked(ask([{ label: "Small steps" }, { label: "Rewrite" }]));
    await settle();
    free.loop.heard("Whichever is faster to review");
    expect(free.answers).toEqual([{ itemId: "a1", label: "Whichever is faster to review", note: SAID_ALOUD }]);
  });

  test("an approval only the screen can give is said, and the reply is read once the turn ends", async () => {
    const { loop, said, did } = carMode();
    loop.tap();
    await settle();
    loop.heard("Deploy it");
    loop.needsApproval();
    expect(loop.phase).toBe("waiting-for-approval");
    expect(said).toEqual([APPROVAL_NEEDED]);
    loop.turnEnded(reply);
    await settle();
    expect(did).toContain("read r1");
  });

  test("a message dictated in the message box goes on as in car mode: its reply is read, then it listens again", async () => {
    const { loop, did } = carMode();
    loop.sentFromTheMessageBox([]);
    expect(loop.phase).toBe("working");
    loop.asked(ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]));
    await settle();
    expect(loop.phase).toBe("listening");
    loop.heard("yes");
    loop.turnEnded(reply);
    await settle();
    expect(did).toContain("read r1");
    expect(loop.phase).toBe("listening");
  });

  test("ending car mode stops everything, and a reply that ends meanwhile isn't read", async () => {
    const { loop, did } = carMode();
    loop.tap();
    await settle();
    loop.heard("Run the tests");
    loop.end();
    loop.turnEnded(reply);
    await settle();
    expect(loop.phase).toBe("idle");
    expect(did).not.toContain("read r1");
  });

  test("following what is shown, the reply of the turn the message started is read, not one before it", async () => {
    const { loop, did } = carMode();
    const stored = (...events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: index, event }));
    const ended: ConversationEvent = { type: "turn-end", stopReason: "end_turn" };
    const before = stored({ type: "user-message", text: "Earlier." }, ended);
    const timeline: TimelineBlock[] = [{ kind: "user", key: "u1", at: 0, text: "Run the tests." }, { kind: "agent", key: "a1", at: 1, text: "All passed." }];
    loop.sentFromTheMessageBox(before);
    loop.follow({ events: before, timeline, ask: null, awaitingApproval: false });
    expect(did).not.toContain("read a1");
    loop.follow({ events: stored({ type: "user-message", text: "Earlier." }, ended, { type: "user-message", text: "Run the tests." }, ended), timeline, ask: null, awaitingApproval: false });
    await settle();
    expect(did).toContain("read a1");
    expect(loop.phase).toBe("listening");
  });

  test("following what is shown, a question waiting is asked aloud, and one answered on the screen is let go", async () => {
    const { loop, did } = carMode();
    const question = ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]);
    loop.sentFromTheMessageBox([]);
    loop.follow({ events: [], timeline: [], ask: question, awaitingApproval: false });
    await settle();
    expect(loop.answeringAQuestion).toBe(true);
    loop.follow({ events: [], timeline: [], ask: null, awaitingApproval: false });
    expect(loop.answeringAQuestion).toBe(false);
    expect(loop.phase).toBe("working");
    expect(did).toContain("say ask:a1:0");
  });

  test("once the approval is given, the turn goes on: a question asked after it is read aloud", async () => {
    const { loop, said } = carMode();
    loop.sentFromTheMessageBox([]);
    loop.follow({ events: [], timeline: [], ask: null, awaitingApproval: true });
    expect(loop.phase).toBe("waiting-for-approval");
    loop.follow({ events: [], timeline: [], ask: ask([{ label: "Small steps", recommended: true }, { label: "Rewrite" }]), awaitingApproval: false });
    await settle();
    expect(loop.answeringAQuestion).toBe(true);
    expect(said.at(-1)!.join(" ")).toContain("Which way?");
  });
});
