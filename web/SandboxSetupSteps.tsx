import { useEffect, useState } from "react";
import type { SandboxKind, SandboxSetup, SetupPiece, SetupStep } from "../shared/sandbox.ts";
import { t } from "./i18n/index.ts";
import { unusableBaseText } from "./problem-text.ts";
import { clockText, progressOf, stepText } from "./sandbox-setup-steps.ts";

const sandboxWords = t.rooms.sandbox;
const words = sandboxWords.steps;

/** The time since then by this page's clock, ticking each second; none where there is no then. */
function useTimeSince(since: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const ticking = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticking);
  }, [since]);
  return since === undefined ? null : Math.max(0, now - since);
}

/** A bar of how far something got, where it is known; otherwise one that moves, to show it is under way. */
function SetupBar({ label, value, max }: { label: string; value?: number; max?: number }) {
  const known = value !== undefined && max !== undefined && max > 0;
  return (
    <span
      className={known ? "sandbox-setup-bar" : "sandbox-setup-bar unknown"}
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? max : undefined}
      aria-valuenow={known ? value : undefined}
    >
      <span style={known ? { width: `${Math.round((100 * value) / max)}%` } : undefined} />
    </span>
  );
}

const withPercent = (text: string, percent: number | undefined) => (percent === undefined ? text : `${text} ${percent}%`);

/** What the step under way says of itself where it says anything, and how far it got where that is known. */
function underWayDetail(piece: SetupPiece, { step, percent, unpacking, fetching }: SandboxSetup): { text: string | null; value?: number; max?: number } {
  const pulled = (image: string) => ({ text: withPercent(unpacking ? words.unpacking(image) : words.downloading(image), percent), value: percent, max: 100 });
  if (piece.kind === "base-build" && step) return { text: words.buildPart(step.at, step.of), value: step.at, max: step.of };
  if (piece.kind === "base-pull") return pulled(piece.image);
  if (piece.kind === "tool" && fetching) return pulled(fetching);
  if (piece.kind === "service" && piece.runtime === "apple-container") return { text: words.firstKernel };
  return { text: null };
}

function problemOf({ unusableBase, problem }: SandboxSetup) {
  return unusableBase ? unusableBaseText(unusableBase, t.problems) : (problem ?? null);
}

function failureText(setup: SandboxSetup, kind: SandboxKind) {
  const problem = problemOf(setup);
  return problem ? sandboxWords.setupFailed(problem) : sandboxWords.setup[kind].failed;
}

function SetupStepRow({ step: { piece, state }, setup, stepTime }: { step: SetupStep; setup: SandboxSetup; stepTime: number | null }) {
  const detail = state === "now" ? underWayDetail(piece, setup) : null;
  return (
    <li className={`sandbox-setup-step ${state}`}>
      <span className="sandbox-setup-mark" role="img" aria-label={words.states[state]} />
      <span className="sandbox-setup-name">{stepText(piece)}</span>
      {state === "now" && stepTime !== null && <span className="sandbox-setup-time">{clockText(stepTime)}</span>}
      {detail && (
        <span className="sandbox-setup-detail">
          {detail.text && <span>{detail.text}</span>}
          <SetupBar label={words.howFar} value={detail.value} max={detail.max} />
        </span>
      )}
    </li>
  );
}

/**
 * Where setting up the sandbox stands, in its settings: while it is set up, or where that failed, every step it takes,
 * each done, under way or still to come, with how far the one under way got and how long it and the whole setup took,
 * or what it waits behind; otherwise one line, of the setup to come, done or failed.
 */
export function SetupSteps({ setup, kind }: { setup: SandboxSetup; kind: SandboxKind }) {
  const failed = setup.stage === "failed";
  const setupTime = useTimeSince(failed ? undefined : setup.startedAt);
  const stepTime = useTimeSince(failed ? undefined : setup.stepStartedAt);
  if (!setup.steps) {
    return (
      <p className={`room-sandbox-setup ${setup.stage}`} role="status">
        {failed ? failureText(setup, kind) : sandboxWords.setup[kind][setup.stage]}
      </p>
    );
  }
  const { done, at, of } = progressOf(setup.steps);
  return (
    <div className={`sandbox-setup-steps${failed ? " failed" : ""}`} role="group" aria-label={words.title}>
      <div className="sandbox-setup-head">
        <strong>{failed ? sandboxWords.setup[kind].failed : words.title}</strong>
        <span>
          <span role="status">{words.stepOf(at, of)}</span>
          {setupTime !== null && ` · ${clockText(setupTime)}`}
        </span>
      </div>
      <SetupBar label={words.stepsDone} value={done} max={of} />
      <ol>
        {setup.steps.map((step) => (
          <SetupStepRow key={stepText(step.piece)} step={step} setup={setup} stepTime={stepTime} />
        ))}
      </ol>
      {setup.waitingBehind && (
        <p className="sandbox-setup-waiting">
          {words.waitingBehind(stepText(setup.waitingBehind))}
          {stepTime !== null && ` · ${clockText(stepTime)}`}
        </p>
      )}
      {failed && problemOf(setup) && <p className="sandbox-setup-problem">{problemOf(setup)}</p>}
    </div>
  );
}

/**
 * Where setting up the sandbox stands, in a conversation that waits for it: the step it is on, of how many, or what it
 * waits behind, and how long it took; clicked, the sandbox's settings show every step.
 */
export function SetupCard({ setup, onOpen }: { setup: SandboxSetup; onOpen: () => void }) {
  const setupTime = useTimeSince(setup.startedAt);
  if (!setup.steps || setup.stage === "failed") return null;
  const { done, at, of, current } = progressOf(setup.steps);
  const doing = setup.waitingBehind ? words.waitingBehind(stepText(setup.waitingBehind)) : current ? stepText(current.piece) : null;
  return (
    <button type="button" className="sandbox-setup-card" data-hint={words.openSettings} onClick={onOpen}>
      <span className="sandbox-setup-head">
        <strong>{words.waitsForIt}</strong>
        {setupTime !== null && <span>{clockText(setupTime)}</span>}
      </span>
      <span className="sandbox-setup-doing">
        {words.stepOf(at, of)}
        {doing && `: ${doing}`}
      </span>
      <SetupBar label={words.stepsDone} value={done} max={of} />
    </button>
  );
}
