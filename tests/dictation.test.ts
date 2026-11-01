import { describe, expect, test } from "bun:test";
import { defaultVoiceSettings, type VoiceSettings } from "../shared/voice.ts";
import type { EngineServerState } from "../shared/voice-engine.ts";
import { dictationStatus, HOLD_MS, madeUpFromSilence, type MicrophonePlace, microphoneProblem, NO_MICROPHONE_API, onlyThinking, type Press, pressed, released, spacedAtCaret, voiceCommand } from "../web/dictation.ts";
import { KEEP_TALKING_WAIT_MS, NOTHING_HEARD_MS, PAUSE_ENDS_MS, pauseWatch } from "../web/pause-watch.ts";
import { wavOf } from "../web/wav.ts";

const up: Press = { kind: "up" };

describe("a press of the mic button or its key", () => {
  test("a tap starts listening, and the next press finishes", () => {
    const down = pressed(up, 1_000);
    expect(down).toEqual({ press: { kind: "down", at: 1_000 }, action: "start" });
    const tapped = released(down.press, 1_000 + HOLD_MS - 1);
    expect(tapped).toEqual({ press: { kind: "tapped" }, action: null });
    const again = pressed(tapped.press, 5_000);
    expect(again).toEqual({ press: up, action: "finish" });
    expect(released(again.press, 5_100), "letting go of the press that finished does nothing").toEqual({ press: up, action: null });
  });

  test("a hold listens until let go", () => {
    const down = pressed(up, 1_000).press;
    expect(pressed(down, 1_200), "a key's repeat while held changes nothing").toEqual({ press: down, action: null });
    expect(released(down, 1_000 + HOLD_MS)).toEqual({ press: up, action: "finish" });
  });

  test("letting go without a press does nothing", () => {
    expect(released(up, 1_000)).toEqual({ press: up, action: null });
    expect(released({ kind: "tapped" }, 1_000)).toEqual({ press: { kind: "tapped" }, action: null });
  });
});

describe("the pause watch", () => {
  const speech = 0.2;
  const room = 0.001;

  test("tells a pause once the user has been quiet a while after speaking", () => {
    const watch = pauseWatch(0);
    expect(watch.hear(room, 100)).toBe("go-on");
    expect(watch.heardSpeech()).toBe(false);
    expect(watch.hear(speech, 500)).toBe("go-on");
    expect(watch.hear(0.0, 600), "a gap between words is no pause").toBe("go-on");
    expect(watch.hear(speech, 700)).toBe("go-on");
    expect(watch.heardSpeech()).toBe(true);
    expect(watch.hear(room, 700 + PAUSE_ENDS_MS - 1)).toBe("go-on");
    expect(watch.hear(room, 700 + PAUSE_ENDS_MS)).toBe("paused");
  });

  test("tells when nothing is said at all", () => {
    const watch = pauseWatch(1_000);
    expect(watch.hear(room, 1_000 + NOTHING_HEARD_MS - 1)).toBe("go-on");
    expect(watch.hear(room, 1_000 + NOTHING_HEARD_MS)).toBe("nothing-heard");
  });

  test("tells where speech was heard, with half a second around it, so that only that part is sent", () => {
    const watch = pauseWatch(1_000, KEEP_TALKING_WAIT_MS);
    expect(watch.speechSpan()).toBeNull();
    watch.hear(room, 30_000);
    watch.hear(speech, 31_000);
    watch.hear(speech, 33_000);
    watch.hear(room, 34_000);
    expect(watch.speechSpan()).toEqual({ fromMs: 29_500, toMs: 32_500 });
    const early = pauseWatch(1_000);
    early.hear(room, 1_100);
    early.hear(speech, 1_200);
    expect(early.speechSpan(), "never before listening began").toEqual({ fromMs: 0, toMs: 700 });
  });

  test("keeping a spoken conversation going waits two minutes for the first word", () => {
    const watch = pauseWatch(1_000, KEEP_TALKING_WAIT_MS);
    expect(watch.hear(room, 1_000 + NOTHING_HEARD_MS)).toBe("go-on");
    expect(watch.hear(room, 1_000 + KEEP_TALKING_WAIT_MS - 1)).toBe("go-on");
    expect(watch.hear(room, 1_000 + KEEP_TALKING_WAIT_MS)).toBe("nothing-heard");
  });

  test("a noisy room is not speech, but speaking over it is", () => {
    const watch = pauseWatch(0);
    const noisy = 0.03;
    [100, 200, 300].forEach((at) => watch.hear(noisy, at));
    expect(watch.heardSpeech()).toBe(false);
    watch.hear(0.15, 400);
    expect(watch.heardSpeech()).toBe(true);
  });

  test("talking on and on doesn't become the room's noise", () => {
    const watch = pauseWatch(0);
    watch.hear(room, 0);
    const talking = Array.from({ length: 300 }, (_, index) => watch.hear(index % 4 === 0 ? 0.05 : speech, (index + 1) * 100));
    expect(talking.every((verdict) => verdict === "go-on")).toBe(true);
    expect(watch.hear(speech, 30_200)).toBe("go-on");
  });
});

describe("the status under the message box", () => {
  const settings = (recognition: VoiceSettings["recognition"], voiceModel: VoiceSettings["voiceModel"] = { kind: "off" }): VoiceSettings => ({ ...defaultVoiceSettings, recognition, voiceModel });
  const servers = (speech: EngineServerState, voiceModel: EngineServerState = "stopped") => ({ speech, voiceModel, speaking: "stopped" as const });
  const ownServer = { kind: "custom" as const, endpoint: { url: "http://box/v1", apiKey: "", model: "whisper" } };
  const thisMacRecognition = { kind: "this-mac" as const, model: "whisper-large-v3-turbo" };
  const thisMacVoiceModel = { kind: "this-mac" as const, model: "gemma-4-26b-a4b" };

  test("says what is happening, and what on this Mac is loading", () => {
    expect(dictationStatus("idle", settings(ownServer), servers("stopped"))).toBeNull();
    expect(dictationStatus("starting", settings(ownServer), servers("stopped"))).toBe("Starting the microphone…");
    expect(dictationStatus("listening", settings(ownServer), servers("stopped"))).toBe("Listening… It stops when you pause or let go. Esc cancels.");
    expect(dictationStatus("listening", settings(ownServer), servers("stopped"), "conversation"), "the words Keep talking takes").toBe(
      "Listening… Say “stop” to end, “repeat that” to hear it again, or “help” for more.",
    );
    expect(dictationStatus("listening", settings(ownServer), servers("stopped"), "answer"), "and those a question read aloud takes").toBe(
      "Listening… Say “yes”, “the others”, a number, or answer in your own words.",
    );
    expect(dictationStatus("transcribing", settings(ownServer), servers("stopped"))).toBe("Turning speech into text…");
    expect(dictationStatus("transcribing", settings(thisMacRecognition), servers("stopped"))).toBe("Loading speech recognition on this Mac…");
    expect(dictationStatus("transcribing", settings(thisMacRecognition), servers("loading"))).toBe("Loading speech recognition on this Mac…");
    expect(dictationStatus("transcribing", settings(thisMacRecognition, thisMacVoiceModel), servers("ready", "loading"))).toBe("Loading the voice model on this Mac…");
    expect(dictationStatus("transcribing", settings(thisMacRecognition, thisMacVoiceModel), servers("ready", "stopped"))).toBe("Turning speech into text…");
  });
});

describe("what was said goes in at the caret", () => {
  test("as words of their own", () => {
    expect(spacedAtCaret("", 0, 0, " Run the tests. ")).toBe("Run the tests.");
    expect(spacedAtCaret("Please", 6, 6, "run the tests.")).toBe(" run the tests.");
    expect(spacedAtCaret("Please ", 7, 7, "run the tests.")).toBe("run the tests.");
    expect(spacedAtCaret("Please now", 6, 6, "run the tests")).toBe(" run the tests");
    expect(spacedAtCaret("Please now", 7, 7, "run the tests")).toBe("run the tests ");
    expect(spacedAtCaret("Please XX now", 7, 9, "run")).toBe("run");
    expect(spacedAtCaret("Please\nnow", 7, 7, "run")).toBe("run ");
  });
});

describe("when the microphone doesn't start", () => {
  const browser: MicrophonePlace = { desktopApp: false, secure: true, system: "mac" };
  const desktopApp = (system: MicrophonePlace["system"]): MicrophonePlace => ({ desktopApp: true, secure: true, system });

  test("a browser points to its settings for the site, the desktop app to its own question and the system's setting", () => {
    expect(microphoneProblem("NotAllowedError", browser)).toBe("Mirador may not use the microphone. The browser's settings for this site can allow it.");
    expect(microphoneProblem("NotAllowedError", desktopApp("mac"))).toBe(
      "Mirador may not use the microphone. Allow it when the desktop app asks and in System Settings → Privacy & Security → Microphone. Blocking it in the app holds until the app quits.",
    );
    expect(microphoneProblem("NotAllowedError", desktopApp("windows"))).toBe(
      "Mirador may not use the microphone. Allow it when the desktop app asks and in Windows Settings → Privacy & security → Microphone, which desktop apps need too. Blocking it in the app holds until the app quits.",
    );
    expect(microphoneProblem("NotAllowedError", desktopApp("other"))).toBe("Mirador may not use the microphone. Allow it when the desktop app asks. Blocking it in the app holds until the app quits.");
  });

  test("a page without the microphone says why", () => {
    expect(microphoneProblem(NO_MICROPHONE_API, { ...browser, secure: false })).toBe("Pages may use the microphone only when opened over https or at localhost. Open Mirador at one of those to dictate.");
    expect(microphoneProblem(NO_MICROPHONE_API, browser)).toBe("This browser doesn't let pages use the microphone.");
    expect(microphoneProblem(NO_MICROPHONE_API, desktopApp("mac"))).toBe("This build of the desktop app can't use the microphone. Update or rebuild it, or dictate in a browser.");
  });

  test("no microphone, or another failure", () => {
    expect(microphoneProblem("NotFoundError", desktopApp("mac"))).toBe("There is no microphone to listen with.");
    expect(microphoneProblem("NotReadableError", browser, "Could not start audio source")).toBe("The microphone didn't start: Could not start audio source");
  });
});

describe("a clip in WAV", () => {
  test("is 16-bit mono PCM at the rate given, its samples clipped to range", () => {
    const wav = wavOf(new Float32Array([0, 1, -1, 2, 0.5]), 16_000);
    const view = new DataView(wav.buffer);
    const text = (offset: number) => String.fromCharCode(...wav.slice(offset, offset + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true))).toEqual([0, 32767, -32767, 32767, 16384]);
  });
});

describe("a command said while keeping a spoken conversation going", () => {
  test("stop and repeat are heard in their usual wordings, whatever the case, punctuation or politeness", () => {
    expect(voiceCommand("Stop.")).toBe("stop");
    expect(voiceCommand("Stop listening, please!")).toBe("stop");
    expect(voiceCommand("Please repeat that.")).toBe("repeat");
    expect(voiceCommand("Say that again?")).toBe("repeat");
  });

  test("repeat asked for as a question, or with this or again, is still repeat", () => {
    for (const said of ["Repeat this, please.", "Can you repeat that?", "Could you say that again?", "Repeat that again.", "Um, repeat it, thanks."]) {
      expect(voiceCommand(said), said).toBe("repeat");
    }
  });

  test("a typographic apostrophe, and more than one polite word, still make a command", () => {
    expect(voiceCommand("That’s all.")).toBe("stop");
    expect(voiceCommand("OK, please stop.")).toBe("stop");
    expect(voiceCommand("Okay, please, repeat that, please.")).toBe("repeat");
  });

  test("only English counts, as what was said in another language is translated first", () => {
    expect(voiceCommand("Elég.")).toBeNull();
    expect(voiceCommand("Enough.")).toBe("stop");
  });

  test("a command inside a longer message goes to the agent", () => {
    expect(voiceCommand("Stop the build and repeat the tests.")).toBeNull();
    expect(voiceCommand("Can you repeat that function for the other file?")).toBeNull();
    expect(voiceCommand("Thank you, that works.")).toBeNull();
    expect(voiceCommand("")).toBeNull();
  });

  test("a lone thanks ends the conversation, said once or more, or before another stop", () => {
    expect(voiceCommand("Thanks!")).toBe("stop");
    expect(voiceCommand("Thank you. Thank you.")).toBe("stop");
    expect(voiceCommand("Thank you. Stop.")).toBe("stop");
  });

  test("sentences that ask for different things go to the agent", () => {
    expect(voiceCommand("Stop. Repeat that.")).toBeNull();
    expect(voiceCommand("Thank you. Now run the tests.")).toBeNull();
  });
});

describe("what speech recognition makes up from silence", () => {
  test("its usual phrases, alone or repeated, and nothing at all, are not worth sending", () => {
    expect(madeUpFromSilence("Thanks for watching!")).toBe(true);
    expect(madeUpFromSilence("Thank you for watching. Thank you for watching.")).toBe(true);
    expect(madeUpFromSilence("You")).toBe(true);
    expect(madeUpFromSilence(" . ")).toBe(true);
    expect(madeUpFromSilence("")).toBe(true);
  });

  test("anything more is what the user said, and a lone thanks is a command", () => {
    expect(madeUpFromSilence("Thank you, that works.")).toBe(false);
    expect(madeUpFromSilence("Thanks for watching. Now run the tests.")).toBe(false);
    expect(madeUpFromSilence("Thank you.")).toBe(false);
    expect(madeUpFromSilence("Bye.")).toBe(false);
  });
});

describe("thinking aloud while keeping a spoken conversation going", () => {
  test("only the sounds of thinking aren't sent, as the user hasn't said anything yet", () => {
    expect(onlyThinking("Hmm.")).toBe(true);
    expect(onlyThinking("Hmm. Well. Hmm, hmm.")).toBe(true);
    expect(onlyThinking("Um, let me think.")).toBe(true);
    expect(onlyThinking("Hmm, the second one.")).toBe(false);
    expect(onlyThinking("Well done.")).toBe(false);
    expect(onlyThinking("")).toBe(false);
  });

  test("help asks what can be said", () => {
    expect(voiceCommand("Help.")).toBe("help");
    expect(voiceCommand("What can I say?")).toBe("help");
    expect(voiceCommand("Help me fix the build.")).toBeNull();
  });
});
