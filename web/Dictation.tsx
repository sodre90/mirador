import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { isCanvasFrameMessage } from "../shared/canvas-document.ts";
import { speaksReplies, type Dictation as Dictated, type VoiceSettings } from "../shared/voice.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import { dictationStatus, pressed, released, spacedAtCaret, type DictationPhase, type ListeningFor, type Press } from "./dictation.ts";
import { joinDrafts } from "./drafts.ts";
import { hints } from "./hints.ts";
import { refusalText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { insertAtCaret } from "./insert-at-caret.ts";
import { pauseWatch, type PauseWatch, type SpeechSpan } from "./pause-watch.ts";
import { startRecording, type Recording } from "./recorder.ts";
import { allowReplyAudio, chime, quietClock, stopReading } from "./reply-player.ts";
import { dictates, shortcutKeys } from "./shortcuts.ts";
import { lendMicrophone, spokenConversationIn } from "./spoken-conversation.ts";

const words = t.dictation;
const RECOGNITION_OFF = words.recognitionOff;
const NOTHING_HEARD = words.nothingHeard;
const NO_WORDS = words.noWords;

const releasingKeys = ["Meta", "Control", "Shift"];
const aDialogIsOpen = () => document.querySelector(".modal-backdrop") !== null;
const problemOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function transcribed(conversationId: string, clip: Blob): Promise<Dictated> {
  let response: Response;
  try {
    response = await fetch(`/conversations/${conversationId}/speech`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: clip });
  } catch (error) {
    throw new Error(words.didNotReachMirador(problemOf(error)));
  }
  if (!response.ok) throw new Error(await refusalText(response, words.recognitionFailed(String(response.status))));
  return response.json();
}

function insertDictated(box: HTMLTextAreaElement | null, setText: Dispatch<SetStateAction<string>>, words: string) {
  if (box) insertAtCaret(box, setText, spacedAtCaret(box.value, box.selectionStart, box.selectionEnd, words));
  else flushSync(() => setText((current) => joinDrafts(current, words)));
}

interface Listening {
  recording: Promise<Recording>;
  heardSpeech: () => boolean;
  speechSpan: () => SpeechSpan | null;
}

/**
 * Speech into the message box, from the mic button or ⌘⇧Space (Ctrl+Shift+Space elsewhere) anywhere in the window: a
 * tap listens until the user pauses or presses again, a hold until they let go. What was heard goes in at the caret,
 * in English when translated, with what they said kept to show under the box, after sending it right away too.
 */
export function useDictation({
  conversationId,
  settings,
  textarea,
  setText,
  sendNow,
}: {
  conversationId: string;
  settings: VoiceSettings;
  textarea: RefObject<HTMLTextAreaElement | null>;
  setText: Dispatch<SetStateAction<string>>;
  sendNow: () => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [originals, setOriginals] = useState<string[]>([]);
  const [sentOriginal, setSentOriginal] = useState<string | null>(null);
  const [listeningFor, setListeningFor] = useState<ListeningFor>("message");
  const press = useRef<Press>({ kind: "up" });
  const listening = useRef<Listening | null>(null);
  const latestSendNow = useRef(sendNow);
  latestSendNow.current = sendNow;
  const dictatedIntoDraft = useRef(false);
  /** Listening again after a reply was read aloud sends what is heard, so that the conversation goes on hands-free. */
  const sendsWhatIsHeard = useRef(false);
  /** Until when Keep talking waits for the first words, however many rounds hear only noise meanwhile. */
  const keepTalkingUntil = useRef(0);
  const available = settings.recognition.kind !== "off";

  const put = (dictated: Dictated) => {
    if (sendsWhatIsHeard.current) {
      setSentOriginal(dictated.original);
      return spokenConversationIn(conversationId).heard(dictated.text);
    }
    if (!/[\p{L}\p{N}]/u.test(dictated.text)) return setProblem(NO_WORDS);
    insertDictated(textarea.current, setText, dictated.text);
    dictatedIntoDraft.current = true;
    if (settings.sendRightAway) {
      setSentOriginal(dictated.original);
      return latestSendNow.current();
    }
    if (dictated.original !== null) setOriginals((before) => [...before, dictated.original!]);
  };

  const finish = async () => {
    const ending = listening.current;
    if (!ending) return;
    listening.current = null;
    press.current = { kind: "up" };
    const nextDictationBegan = () => listening.current !== null;
    const keepsTalking = sendsWhatIsHeard.current;
    try {
      const recording = await ending.recording;
      if (!ending.heardSpeech()) {
        recording.cancel();
        if (nextDictationBegan()) return;
        setPhase("idle");
        setProblem(NOTHING_HEARD);
        if (keepsTalking) spokenConversationIn(conversationId).heardNothing();
        return;
      }
      setPhase("transcribing");
      /** Keep talking waits long for the first word, and the silence and noise before it are what recognition makes words up from. */
      const clip = await recording.finish(keepsTalking ? ending.speechSpan() : null);
      if (settings.keepTalking && speaksReplies(settings)) void chime("heard");
      const dictated = await transcribed(conversationId, clip);
      put(dictated);
    } catch (error) {
      if (nextDictationBegan()) return;
      setProblem(problemOf(error));
      if (keepsTalking) spokenConversationIn(conversationId).listeningFailed(problemOf(error));
    }
    /** What was heard may have been noise, and listening for what is said next has begun meanwhile. */
    if (!nextDictationBegan()) setPhase("idle");
  };

  const onLevel = (watch: PauseWatch, level: number) => {
    const verdict = watch.hear(level, performance.now());
    if (verdict !== "go-on" && press.current.kind === "tapped") void finish();
  };

  /** The microphone would hear a reply being read aloud. */
  const begin = ({ listeningAgain = false } = {}) => {
    sendsWhatIsHeard.current = listeningAgain;
    setListeningFor(listeningAgain ? (spokenConversationIn(conversationId).answeringAQuestion ? "answer" : "conversation") : "message");
    stopReading();
    if (speaksReplies(settings)) allowReplyAudio();
    setProblem(null);
    setSentOriginal(null);
    /** Pauses count from when the microphone records, as starting it, or the user allowing it, may take a while. */
    let watch: PauseWatch | null = null;
    const recordingStarted = () => {
      if (listening.current !== started) return;
      const now = performance.now();
      watch = listeningAgain ? pauseWatch(now, keepTalkingUntil.current - now) : pauseWatch(now);
      setPhase("listening");
      if (listeningAgain) spokenConversationIn(conversationId).microphoneOpened();
    };
    const started: Listening = {
      recording: startRecording((level) => watch && onLevel(watch, level), recordingStarted),
      heardSpeech: () => watch?.heardSpeech() ?? false,
      speechSpan: () => watch?.speechSpan() ?? null,
    };
    listening.current = started;
    setPhase("starting");
    started.recording.catch((error) => {
      if (listening.current !== started) return;
      listening.current = null;
      press.current = { kind: "up" };
      setPhase("idle");
      setProblem(problemOf(error));
    });
  };

  const cancel = () => {
    const cancelled = listening.current;
    if (!cancelled) return;
    listening.current = null;
    press.current = { kind: "up" };
    cancelled.recording.then((recording) => recording.cancel(), () => {});
    setPhase("idle");
  };

  /** Timed at when the input happened, not when its handler ran: a busy page would make a tap look held. */
  const onPress = (at = performance.now()) => {
    if (!available) return setProblem(RECOGNITION_OFF);
    if (phase === "transcribing") return;
    const next = pressed(press.current, at);
    press.current = next.press;
    if (next.action === "start") begin();
    if (next.action === "finish") void finish();
  };

  const onRelease = (at = performance.now()) => {
    const next = released(press.current, at);
    press.current = next.press;
    if (next.action === "finish") void finish();
  };

  /** Only while Keep talking is on and the page is in view; the conversation chimes before the microphone could hear it. */
  const listenAgain = (until: number) => {
    if (!settings.keepTalking || !available || listening.current) return false;
    if (document.hidden || aDialogIsOpen()) return false;
    keepTalkingUntil.current = until;
    press.current = { kind: "tapped" };
    begin({ listeningAgain: true });
    return true;
  };

  /** Only a listening of the spoken conversation: dictating a message of one's own goes on. */
  const stopListeningAgain = () => {
    if (sendsWhatIsHeard.current) cancel();
  };

  const sendSaid = (message: string) => {
    insertDictated(textarea.current, setText, message);
    dictatedIntoDraft.current = true;
    latestSendNow.current();
  };

  /** Esc ends a spoken conversation that listens, rather than only that listening. */
  const escape = () => {
    if (sendsWhatIsHeard.current) spokenConversationIn(conversationId).end();
    else cancel();
  };

  const latest = useRef({ onPress, onRelease, cancel, escape, listenAgain, stopListeningAgain, sendSaid });
  latest.current = { onPress, onRelease, cancel, escape, listenAgain, stopListeningAgain, sendSaid };

  useEffect(
    () =>
      lendMicrophone(conversationId, {
        listen: (until) => latest.current.listenAgain(until),
        stop: () => latest.current.stopListeningAgain(),
        send: (message) => latest.current.sendSaid(message),
      }),
    [conversationId],
  );

  const microphoneOpen = phase === "starting" || phase === "listening";
  useEffect(() => (microphoneOpen ? quietClock() : undefined), [microphoneOpen]);

  useEffect(() => {
    const pressFromKeys = (at?: number) => {
      latest.current.onPress(at);
      textarea.current?.focus();
    };
    const tapFromKeys = () => {
      pressFromKeys();
      latest.current.onRelease();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && listening.current) {
        event.preventDefault();
        event.stopPropagation();
        return latest.current.escape();
      }
      if (!dictates(event)) return;
      event.preventDefault();
      if (!event.repeat && !aDialogIsOpen()) pressFromKeys(event.timeStamp);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" || releasingKeys.includes(event.key)) latest.current.onRelease(event.timeStamp);
    };
    const onBlur = () => latest.current.onRelease();
    const onHidden = () => document.hidden && latest.current.onRelease();
    /** The canvas page forwards presses but not letting go, which may come before the message box takes the focus. */
    const onFrameMessage = (event: MessageEvent) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLIFrameElement) || event.source !== focused.contentWindow) return;
      if (isCanvasFrameMessage(event.data) && event.data.kind === "key" && dictates(event.data) && !aDialogIsOpen()) tapFromKeys();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("message", onFrameMessage);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("message", onFrameMessage);
      latest.current.cancel();
    };
  }, []);

  return {
    phase,
    listeningFor,
    available,
    problem,
    said: sentOriginal ?? (originals.length > 0 ? originals.join(" ") : null),
    onPress,
    onRelease,
    clearOriginals: () => {
      dictatedIntoDraft.current = false;
      setOriginals((before) => (before.length === 0 ? before : []));
    },
    /** Whether the message being sent was dictated, at least in part. */
    takeDictated: () => {
      const dictated = dictatedIntoDraft.current;
      dictatedIntoDraft.current = false;
      return dictated;
    },
    hideSaid: () => {
      setOriginals([]);
      setSentOriginal(null);
    },
  };
}

export type DictationControls = ReturnType<typeof useDictation>;

function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
      <path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Keeps the message box focused, so what was said goes in at its caret; Enter or Space on the button taps it. */
export function DictateButton({ dictation }: { dictation: DictationControls }) {
  const { phase, available, onPress, onRelease } = dictation;
  return (
    <button
      type="button"
      className={`dictate dictate-${phase}`}
      aria-label={words.dictate}
      aria-pressed={phase === "starting" || phase === "listening"}
      aria-disabled={!available || undefined}
      data-hint={available ? hints.dictate : hints.dictateOff}
      data-shortcut={shortcutKeys().dictate}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress(event.timeStamp);
      }}
      onPointerUp={(event) => onRelease(event.timeStamp)}
      onPointerCancel={(event) => onRelease(event.timeStamp)}
      onClick={(event) => {
        if (event.detail !== 0) return;
        onPress();
        onRelease();
      }}
    >
      <MicIcon />
    </button>
  );
}

export function DictationLines({ dictation, settings, engine }: { dictation: DictationControls; settings: VoiceSettings; engine: VoiceEngineStatus }) {
  const status = dictationStatus(dictation.phase, settings, engine.servers, dictation.listeningFor);
  if (status === null && dictation.said === null) return null;
  return (
    <div className="dictation-lines">
      {status && (
        <div className={`dictation-status dictation-${dictation.phase}`} role="status">
          {status}
        </div>
      )}
      {dictation.said !== null && (
        <div className="dictation-original">
          <span>{words.youSaid(dictation.said)}</span>
          <button type="button" className="icon" aria-label={words.hideWhatYouSaid} onClick={dictation.hideSaid}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
