import { useEffect, useRef, useState, type ReactNode } from "react";
import { type EngineServerState, type VoiceEngineSetup, type VoiceEngineStatus } from "../shared/voice-engine.ts";
import { bestFitting, choosableModels, ENGINE_PACKAGES_BYTES, fitsMemory, modelsFor, SPOKEN_VOICE, type ChoosableModel, type EngineService } from "../shared/voice-engine-models.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { describedText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { gigabytes, modelChoice, modelState, tooLittleMemoryForVoiceModel } from "./voice-models.ts";

const words = t.voice;

/** Sets voice up on this Mac with the models, or adds them once it is set up. */
export const setUpModels = (models: string[]) => connection.send({ type: "voice.engine.set-up", models });

type SettingUp = Extract<VoiceEngineSetup, { state: "setting-up" }>;

/** How far setup is: in the setup box the first time, then beside each model it adds. */
function DownloadProgress({ setup: { step, done, total }, label }: { setup: SettingUp; label: string }) {
  const counted = total > 0;
  return (
    <span className="voice-engine-progress">
      <span>{counted ? words.progress(words.steps[step], gigabytes(done), gigabytes(total)) : `${words.steps[step]}…`}</span>
      <progress aria-label={label} value={counted ? done : undefined} max={counted ? total : undefined} />
      <button type="button" onClick={() => connection.send({ type: "voice.engine.cancel" })}>
        {words.cancel}
      </button>
    </span>
  );
}

/** The voice model picked for the first setup, by id, or null for none; undefined until the user picks, for the best one that fits. */
interface VoiceModelChoice {
  picked: string | null | undefined;
  pick: (model: string | null) => void;
}

function NotSetUp({ engine: { setup, memoryBytes }, choice }: { engine: VoiceEngineStatus; choice: VoiceModelChoice }) {
  const recognition = bestFitting("recognition", memoryBytes) ?? modelsFor("recognition")[0]!;
  const bestVoiceModel = bestFitting("voiceModel", memoryBytes);
  const voiceModel = choice.picked === undefined ? bestVoiceModel : modelsFor("voiceModel").find(({ id }) => id === choice.picked);
  const disk = gigabytes(ENGINE_PACKAGES_BYTES + SPOKEN_VOICE.bytes + recognition.bytes + (voiceModel?.bytes ?? 0));
  return (
    <>
      <p className="hint">{words.setUpHint(disk)}</p>
      <div className="sending-settings">
        <label data-hint={hints.voiceEngineVoiceModel}>
          {words.voiceModelWhichTranslates}
          <select value={voiceModel?.id ?? ""} onChange={(event) => choice.pick(event.target.value || null)}>
            <option value="">{words.noVoiceModel}</option>
            {modelsFor("voiceModel").map((model) => (
              <option key={model.id} value={model.id} disabled={!fitsMemory(model, memoryBytes)}>
                {modelChoice(model, memoryBytes)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setUpModels([recognition.id, ...(voiceModel ? [voiceModel.id] : [])])}>
          {setup.state === "failed" ? words.tryAgain : words.setUpVoice}
        </button>
      </div>
      {!bestVoiceModel && <p className="hint">{tooLittleMemoryForVoiceModel(memoryBytes)}</p>}
      {setup.state === "failed" && (
        <p className="voice-engine-problem" role="alert">
          {describedText(setup.problem, setup.problemAbout)}
        </p>
      )}
    </>
  );
}

/** Setting voice up on this Mac the first time. Once set up, models download where they are chosen and are listed under Models on this Mac. */
export function VoiceEngineSetupPanel({ engine }: { engine: VoiceEngineStatus }) {
  const { setup } = engine;
  const [picked, pick] = useState<string | null | undefined>(undefined);
  if (setup.state === "unsupported" || setup.state === "set-up" || engine.onDisk.length > 0) return null;
  return (
    <fieldset className="voice-service voice-engine">
      <legend>{words.voiceOnThisMac}</legend>
      {setup.state === "setting-up" ? <DownloadProgress setup={setup} label={words.settingUpVoice} /> : <NotSetUp engine={engine} choice={{ picked, pick }} />}
    </fieldset>
  );
}

const serverStateNames: Record<EngineServerState, string> = words.serverStates;

/** Whether the server of a model in use has it loaded; the hint says when it loads or unloads. */
export function ServerState({ state, idleMinutes }: { state: EngineServerState; idleMinutes: number }) {
  return (
    <span className="voice-engine-state" data-state={state} data-hint={state === "ready" ? hints.voiceEngineLoaded(idleMinutes) : hints.voiceEngineUnloaded}>
      {serverStateNames[state]}
    </span>
  );
}

/** Beside a model chosen for this Mac: whether it is loaded, its download, or why this Mac can't have it. */
export function ModelBeside({ model, engine, idleMinutes }: { model: ChoosableModel; engine: VoiceEngineStatus; idleMinutes: number }) {
  const state = modelState(model, engine);
  switch (state.is) {
    case "on-disk":
      return <ServerState state={state.server} idleMinutes={idleMinutes} />;
    case "downloading":
      return <DownloadProgress setup={state.setup} label={words.downloading(model.name)} />;
    case "too-big":
      return <span className="hint">{words.needsMacWithMemory(state.neededGb)}</span>;
    case "waiting-for-another-download":
      return (
        <button type="button" aria-disabled="true" data-hint={hints.voiceEngineDownloadWaits}>
          {words.download(gigabytes(model.bytes))}
        </button>
      );
    case "downloadable":
      return (
        <>
          <button type="button" onClick={() => setUpModels([model.id])}>
            {words.download(gigabytes(model.bytes))}
          </button>
          {state.problem && (
            <span className="voice-engine-problem" role="alert">
              {state.problem}
            </span>
          )}
        </>
      );
  }
}

const usedFor: Record<EngineService, string> = words.usedFor;

/** The engine removes nothing while a download goes on, so its Remove buttons wait. */
function RemoveWaitingForDownload({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button type="button" className="danger" aria-disabled="true" aria-label={label} data-hint={hints.voiceEngineRemoveWaits}>
      {children}
    </button>
  );
}

/** A model on this Mac, or one downloading; only one the saved settings don't use can be removed. */
function ModelRow({ model, engine, inUse }: { model: ChoosableModel; engine: VoiceEngineStatus; inUse: boolean }) {
  const { setup } = engine;
  const downloading = setup.state === "setting-up" && !engine.onDisk.includes(model.id) ? setup : null;
  return (
    <tr>
      <td className="voice-engine-model-name">
        {model.name}
        {model.nonCommercial && <span className="hint">{words.nonCommercialUseOnly}</span>}
      </td>
      <td>{usedFor[model.service]}</td>
      <td>{gigabytes(model.bytes)}</td>
      <td>
        {downloading ? (
          <DownloadProgress setup={downloading} label={words.downloading(model.name)} />
        ) : inUse ? (
          words.inUse
        ) : setup.state === "setting-up" ? (
          <RemoveWaitingForDownload label={words.removeModel(model.name)}>{words.remove}</RemoveWaitingForDownload>
        ) : (
          <ConfirmButton
            className="danger"
            label={words.removeModel(model.name)}
            armedText={words.removeArmed}
            armedHint={hints.removeVoiceEngineModelArmed}
            onConfirm={() => connection.send({ type: "voice.engine.remove-model", model: model.id })}
          >
            {words.remove}
          </ConfirmButton>
        )}
      </td>
    </tr>
  );
}

const IDLE_SAVE_DELAY_MS = 800;

/** Saved once the user stops changing it, as each minute typed or stepped would otherwise unload servers on its own. */
function IdleMinutes({ saved, onSave }: { saved: number; onSave: (minutes: number) => void }) {
  const [draft, setDraft] = useState(saved);
  const pending = useRef<Timer | null>(null);
  useEffect(() => setDraft(saved), [saved]);
  const saveNow = (minutes: number) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (Number.isFinite(minutes) && minutes !== saved) onSave(minutes);
  };
  const change = (minutes: number) => {
    setDraft(minutes);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => saveNow(minutes), IDLE_SAVE_DELAY_MS);
  };
  return (
    <label data-hint={hints.voiceEngineIdle}>
      {words.unloadAfter}
      <input
        type="number"
        className="voice-engine-idle"
        min={1}
        max={1440}
        step={1}
        value={Number.isNaN(draft) ? "" : draft}
        onChange={(event) => change(event.target.valueAsNumber)}
        onBlur={() => saveNow(draft)}
      />
      {words.minutesUnused}
    </label>
  );
}

/** What voice on this Mac keeps on disk, what each model is for, and how long a loaded one stays loaded. */
export function ModelsOnThisMac({
  engine,
  inUse,
  idleMinutes,
  onIdleMinutes,
  status,
}: {
  engine: VoiceEngineStatus;
  inUse: string[];
  idleMinutes: number;
  onIdleMinutes: (minutes: number) => void;
  status: ReactNode;
}) {
  const { setup } = engine;
  if (setup.state === "unsupported" || engine.onDisk.length === 0) return null;
  const listed = choosableModels.filter(({ id }) => engine.onDisk.includes(id) || (setup.state === "setting-up" && setup.models.includes(id)));
  return (
    <fieldset className="voice-service">
      <legend>{words.modelsOnThisMac}</legend>
      <table className="voice-engine-models" aria-label={words.modelsOnThisMac}>
        <thead>
          <tr>
            <th>{words.model}</th>
            <th>{words.forColumn}</th>
            <th>{words.sizeColumn}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="voice-engine-model-name">{SPOKEN_VOICE.name}</td>
            <td>{words.englishReplies}</td>
            <td>{gigabytes(SPOKEN_VOICE.bytes)}</td>
            <td>{inUse.includes(SPOKEN_VOICE.id) ? words.inUse : <span data-hint={hints.spokenVoiceKept}>{words.kept}</span>}</td>
          </tr>
          {listed.map((model) => (
            <ModelRow key={model.id} model={model} engine={engine} inUse={inUse.includes(model.id)} />
          ))}
        </tbody>
      </table>
      <div className="sending-settings">
        <IdleMinutes saved={idleMinutes} onSave={onIdleMinutes} />
      </div>
      <div className="sending-settings">
        {setup.state === "set-up" && <span>{words.inAll(gigabytes(setup.bytesOnDisk))}</span>}
        {setup.state === "setting-up" ? (
          <RemoveWaitingForDownload label={words.removeVoice}>{words.removeAll}</RemoveWaitingForDownload>
        ) : (
          <ConfirmButton className="danger" label={words.removeVoice} armedText={words.removeArmed} armedHint={hints.removeVoiceEngineArmed} onConfirm={() => connection.send({ type: "voice.engine.remove" })}>
            {words.removeAll}
          </ConfirmButton>
        )}
      </div>
      {status}
    </fieldset>
  );
}
