import { useEffect, useRef, useState } from "react";
import type { Profile } from "../shared/model.ts";
import type { VoiceEngineStatus } from "../shared/voice-engine.ts";
import { bestFitting, choosableModel, fitsMemory, modelsFor, SPOKEN_VOICE, type ThisMacService } from "../shared/voice-engine-models.ts";
import {
  AUTO_LANGUAGE,
  isEnglish,
  speaksReplies,
  thisMacModelsInUse,
  thisMacReplyVoice,
  type CustomEndpoint,
  type ReplyLanguage,
  type ReplyVoiceSource,
  type VoiceModelSource,
  type VoiceSettings as Settings,
  type VoiceSource,
} from "../shared/voice.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { saveSetting } from "./saved-setting.ts";
import { modelOffer } from "./voice-models.ts";
import { ModelBeside, ModelsOnThisMac, ServerState, VoiceEngineSetupPanel } from "./VoiceEngineSetup.tsx";

const words = t.voice;

/** Languages Whisper recognizes well, as codes it takes. */
const spokenLanguages = ["en", "hu", "de", "fr", "es", "it", "pt", "nl", "pl", "cs", "sk", "ro", "uk", "ru", "sv", "da", "fi", "no", "el", "tr", "ja", "zh", "ko", "hi", "ar", "he"];

const languageNames = new Intl.DisplayNames([navigator.language], { type: "language" });
const languageName = (code: string) => languageNames.of(code) ?? code;

const replyLanguageNames: Record<ReplyLanguage, string> = words.replyLanguages;

const noEndpoint: CustomEndpoint = { url: "", apiKey: "", model: "" };

type Section = "speaking" | "voiceModel" | "replies" | "models";
type Save = (change: Partial<Settings>, options?: { showOnceSaved?: boolean }) => void;

/** What the last save from this page came to, shown in the section where the change was made. */
interface Outcome {
  section: Section;
  text: string;
}

function SavedStatus({ section, outcome }: { section: Section; outcome: Outcome | null }) {
  if (outcome?.section !== section) return null;
  return (
    <p className="hint voice-saved" role="status">
      {outcome.text}
    </p>
  );
}

/**
 * Each change is saved at once and shows before the host answers, so that quick changes build on each other; one the
 * host refuses is undone. Typed fields show as saved only once the host takes them, so refused ones stay to be fixed.
 */
function useSavedAtOnce(settings: Settings) {
  const [shown, setShown] = useState(settings);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const latest = useRef(settings);
  const pending = useRef(0);
  useEffect(() => {
    if (pending.current > 0) return;
    latest.current = settings;
    setShown(settings);
  }, [settings]);
  const saveIn =
    (section: Section): Save =>
    async (change, { showOnceSaved = false } = {}) => {
      const before = latest.current;
      const next = { ...before, ...change };
      latest.current = next;
      if (!showOnceSaved) setShown(next);
      setOutcome(null);
      pending.current++;
      const problem = await saveSetting((requestId) => ({ type: "voice.set-settings", requestId, settings: next }));
      pending.current--;
      if (problem) latest.current = before;
      setShown(latest.current);
      setOutcome({ section, text: problem ?? words.saved });
    };
  return { shown, outcome, saveIn };
}

const typedKinds = ["custom", "profile"];

/**
 * A service's choice as the page shows it: the saved one, except a server of your own or a profile's API, whose typed
 * fields wait for their own Save. Those are kept when the user switches away, so switching back finds them again.
 */
function useChoice<Source extends { kind: string }>(saved: Source) {
  const savedJson = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const typed = useRef(new Map<string, Source>(typedKinds.includes(saved.kind) ? [[saved.kind, saved]] : []));
  useEffect(() => setDraft(JSON.parse(savedJson) as Source), [savedJson]);
  const change = (next: Source) => {
    if (typedKinds.includes(next.kind)) typed.current.set(next.kind, next);
    setDraft(next);
  };
  return { draft, change, typedBefore: (kind: string) => typed.current.get(kind), unsaved: JSON.stringify(draft) !== savedJson };
}

function SaveTyped({ unsaved, onSave }: { unsaved: boolean; onSave: () => void }) {
  return (
    <div className="sending-settings">
      <button type="button" disabled={!unsaved} onClick={onSave}>
        {words.save}
      </button>
    </div>
  );
}

function EndpointFields({ endpoint, modelPlaceholder, onChange }: { endpoint: CustomEndpoint; modelPlaceholder: string; onChange: (endpoint: CustomEndpoint) => void }) {
  return (
    <div className="sending-settings voice-endpoint">
      <label data-hint={hints.voiceAddress}>
        {words.address}
        <input type="url" value={endpoint.url} placeholder="http://127.0.0.1:8000/v1" spellCheck={false} onChange={(event) => onChange({ ...endpoint, url: event.target.value })} />
      </label>
      <label>
        {words.apiKey}
        <input type="password" value={endpoint.apiKey} placeholder={words.noApiKey} autoComplete="off" onChange={(event) => onChange({ ...endpoint, apiKey: event.target.value })} />
      </label>
      <label>
        {words.model}
        <input type="text" value={endpoint.model} placeholder={modelPlaceholder} spellCheck={false} onChange={(event) => onChange({ ...endpoint, model: event.target.value })} />
      </label>
    </div>
  );
}

const isSetUpHere = (engine: VoiceEngineStatus) => engine.onDisk.includes(SPOKEN_VOICE.id);

/** Hidden where the engine can't run; choosable once voice is set up here, if a model for the service fits this Mac. */
function ThisMacOption({ engine, service }: { engine: VoiceEngineStatus; service: ThisMacService | null }) {
  if (engine.setup.state === "unsupported") return null;
  const fits = service === null || bestFitting(service, engine.memoryBytes) !== null;
  const why = !isSetUpHere(engine) ? words.onceSetUpAbove : fits ? "" : words.tooLittleMemory;
  return (
    <option value="this-mac" disabled={why !== ""}>
      {words.onThisMac}
      {why}
    </option>
  );
}

/** The service's model on this Mac if it runs one already, else the best one here, else the best that fits, to download. */
function thisMacSource(source: VoiceSource | VoiceModelSource, service: ThisMacService, engine: VoiceEngineStatus) {
  const onDisk = modelsFor(service).find(({ id }) => engine.onDisk.includes(id));
  return { kind: "this-mac" as const, model: source.kind === "this-mac" ? source.model : ((onDisk ?? bestFitting(service, engine.memoryBytes))?.id ?? "") };
}

/** Offers every model for the service: those not on this Mac say what they download, and the chosen one shows its download beside it. */
function ThisMacModel({
  service,
  model,
  engine,
  idleMinutes,
  onChange,
}: {
  service: ThisMacService;
  model: string;
  engine: VoiceEngineStatus;
  idleMinutes: number;
  onChange: (model: string) => void;
}) {
  const chosen = choosableModel(model);
  return (
    <>
      <label data-hint={hints.thisMacModel}>
        {words.model}
        <select value={model} onChange={(event) => onChange(event.target.value)}>
          {modelsFor(service).map((offer) => (
            <option key={offer.id} value={offer.id} disabled={offer.id !== model && !engine.onDisk.includes(offer.id) && !fitsMemory(offer, engine.memoryBytes)}>
              {modelOffer(offer, engine)}
            </option>
          ))}
        </select>
      </label>
      {chosen && <ModelBeside model={chosen} engine={engine} idleMinutes={idleMinutes} />}
    </>
  );
}

function RecognitionChoice({ saved, engine, idleMinutes, save }: { saved: VoiceSource; engine: VoiceEngineStatus; idleMinutes: number; save: Save }) {
  const { draft, change, typedBefore, unsaved } = useChoice<VoiceSource>(saved);
  const choose = (next: VoiceSource) => {
    change(next);
    save({ recognition: next });
  };
  const chooseKind = (kind: string) => {
    if (kind === "custom") return change(typedBefore(kind) ?? { kind, endpoint: noEndpoint });
    choose(kind === "this-mac" ? thisMacSource(saved, "recognition", engine) : { kind: "off" });
  };
  return (
    <>
      <div className="sending-settings">
        <label data-hint={hints.voiceRecognition}>
          {words.speechRecognition}
          <select value={draft.kind} onChange={(event) => chooseKind(event.target.value)}>
            <option value="off">{words.off}</option>
            <ThisMacOption engine={engine} service="recognition" />
            <option value="custom">{words.withOwnServer}</option>
          </select>
        </label>
        {draft.kind === "this-mac" && (
          <ThisMacModel service="recognition" model={draft.model} engine={engine} idleMinutes={idleMinutes} onChange={(model) => choose({ kind: "this-mac", model })} />
        )}
      </div>
      {draft.kind === "custom" && (
        <>
          <EndpointFields endpoint={draft.endpoint} modelPlaceholder="whisper-1" onChange={(endpoint) => change({ kind: "custom", endpoint })} />
          <SaveTyped unsaved={unsaved} onSave={() => save({ recognition: draft }, { showOnceSaved: true })} />
        </>
      )}
    </>
  );
}

function VoiceModelChoice({
  saved,
  engine,
  idleMinutes,
  profiles,
  save,
}: {
  saved: VoiceModelSource;
  engine: VoiceEngineStatus;
  idleMinutes: number;
  profiles: Profile[];
  save: Save;
}) {
  const { draft, change, typedBefore, unsaved } = useChoice<VoiceModelSource>(saved);
  const choose = (next: VoiceModelSource) => {
    change(next);
    save({ voiceModel: next });
  };
  const chooseKind = (kind: string) => {
    if (kind === "custom") return change(typedBefore(kind) ?? { kind, endpoint: noEndpoint, turnsThinkingOff: false });
    if (kind === "profile") return change(typedBefore(kind) ?? { kind, profileId: profiles[0]?.id ?? "", model: "" });
    choose(kind === "this-mac" ? thisMacSource(saved, "voiceModel", engine) : { kind: "off" });
  };
  return (
    <>
      <div className="sending-settings">
        <label data-hint={hints.voiceModel}>
          {words.voiceModel}
          <select value={draft.kind} onChange={(event) => chooseKind(event.target.value)}>
            <option value="off">{words.off}</option>
            <ThisMacOption engine={engine} service="voiceModel" />
            <option value="custom">{words.withOwnServer}</option>
            <option value="profile" disabled={profiles.length === 0}>
              {words.withProfileApi}
            </option>
          </select>
        </label>
        {draft.kind === "this-mac" && (
          <ThisMacModel service="voiceModel" model={draft.model} engine={engine} idleMinutes={idleMinutes} onChange={(model) => choose({ kind: "this-mac", model })} />
        )}
        {draft.kind === "profile" && (
          <>
            <label data-hint={hints.voiceModelProfile}>
              {words.profile}
              <select value={draft.profileId} onChange={(event) => change({ ...draft, profileId: event.target.value })}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {words.model}
              <input type="text" value={draft.model} placeholder="claude-opus-5-5" spellCheck={false} onChange={(event) => change({ ...draft, model: event.target.value })} />
            </label>
          </>
        )}
      </div>
      {draft.kind === "custom" && (
        <>
          <EndpointFields endpoint={draft.endpoint} modelPlaceholder="gpt-5-mini" onChange={(endpoint) => change({ ...draft, endpoint })} />
          <div className="sending-settings">
            <label data-hint={hints.voiceModelThinkingOff}>
              <input type="checkbox" checked={draft.turnsThinkingOff ?? false} onChange={(event) => change({ ...draft, turnsThinkingOff: event.target.checked })} />
              {words.askNotToThink}
            </label>
          </div>
        </>
      )}
      {(draft.kind === "custom" || draft.kind === "profile") && <SaveTyped unsaved={unsaved} onSave={() => save({ voiceModel: draft }, { showOnceSaved: true })} />}
    </>
  );
}

/** The voice this Mac reads replies in for the language: Kokoro, always here, or a model of its own to download. */
function ThisMacReplyVoice({ language, engine, idleMinutes }: { language: ReplyLanguage; engine: VoiceEngineStatus; idleMinutes: number }) {
  const voice = choosableModel(thisMacReplyVoice(language));
  return (
    <div className="sending-settings">
      <span>
        {words.spokenBy(voice?.name ?? SPOKEN_VOICE.name)}
        {voice?.nonCommercial && words.forNonCommercialUseOnly}
      </span>
      {voice ? <ModelBeside model={voice} engine={engine} idleMinutes={idleMinutes} /> : <ServerState state={engine.servers.speaking} idleMinutes={idleMinutes} />}
    </div>
  );
}

function ReplyChoice({
  saved,
  language,
  engine,
  idleMinutes,
  voiceModelSet,
  save,
}: {
  saved: ReplyVoiceSource;
  language: ReplyLanguage;
  engine: VoiceEngineStatus;
  idleMinutes: number;
  voiceModelSet: boolean;
  save: Save;
}) {
  const { draft, change, typedBefore, unsaved } = useChoice<ReplyVoiceSource>(saved);
  const chooseKind = (kind: string) => {
    if (kind === "custom") return change(typedBefore(kind) ?? { kind, endpoint: noEndpoint, voice: "" });
    const next: ReplyVoiceSource = kind === "this-mac" ? { kind } : { kind: "off" };
    change(next);
    save({ replyVoice: next });
  };
  return (
    <>
      <div className="sending-settings">
        <label data-hint={hints.replyVoice}>
          {t.dictation.readAloud}
          <select value={draft.kind} onChange={(event) => chooseKind(event.target.value)}>
            <option value="off">{words.off}</option>
            <ThisMacOption engine={engine} service={null} />
            <option value="custom">{words.withOwnServer}</option>
          </select>
        </label>
        {draft.kind !== "off" && (
          <label data-hint={hints.replyLanguage}>
            {words.language}
            <select value={language} onChange={(event) => save({ replyLanguage: event.target.value as ReplyLanguage })}>
              {Object.entries(replyLanguageNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {draft.kind === "custom" && (
          <label data-hint={hints.replyVoiceName}>
            {words.voice}
            <input type="text" value={draft.voice} placeholder="alloy" spellCheck={false} onChange={(event) => change({ ...draft, voice: event.target.value })} />
          </label>
        )}
      </div>
      {draft.kind === "this-mac" && <ThisMacReplyVoice language={language} engine={engine} idleMinutes={idleMinutes} />}
      {draft.kind === "custom" && (
        <>
          <EndpointFields endpoint={draft.endpoint} modelPlaceholder="gpt-4o-mini-tts" onChange={(endpoint) => change({ ...draft, endpoint })} />
          <SaveTyped unsaved={unsaved} onSave={() => save({ replyVoice: draft }, { showOnceSaved: true })} />
        </>
      )}
      {draft.kind !== "off" && !voiceModelSet && <p className="hint">{words.needsVoiceModel}</p>}
    </>
  );
}

/**
 * Kept by the host, so every browser and the phone dictate the same way. Laid out in the order things happen: what the
 * user says, the voice model that translates it and sums replies up, the replies read aloud, then the models on disk.
 */
export function VoiceSettings({ settings, engine, profiles }: { settings: Settings; engine: VoiceEngineStatus; profiles: Profile[] }) {
  const { shown, outcome, saveIn } = useSavedAtOnce(settings);
  const idleMinutes = shown.engineIdleMinutes;
  const voiceModelSet = shown.voiceModel.kind !== "off";
  const speaking = saveIn("speaking");
  return (
    <>
      <h3>{t.labels.settingsPage.voice}</h3>
      <p className="hint">{words.intro}</p>
      <VoiceEngineSetupPanel engine={engine} />
      <fieldset className="voice-service">
        <legend>{words.whenYouSpeak}</legend>
        <div className="sending-settings">
          <label data-hint={hints.voiceLanguage}>
            {words.youSpeak}
            <select value={shown.language} onChange={(event) => speaking({ language: event.target.value })}>
              <option value={AUTO_LANGUAGE}>{words.anyLanguage}</option>
              {spokenLanguages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          </label>
          {!isEnglish(shown.language) && (
            <label data-hint={voiceModelSet ? hints.translateToEnglish : hints.translateNeedsVoiceModel}>
              <input
                type="checkbox"
                checked={shown.translateToEnglish && voiceModelSet}
                disabled={!voiceModelSet}
                onChange={(event) => speaking({ translateToEnglish: event.target.checked })}
              />
              {words.translateIntoEnglish}
            </label>
          )}
        </div>
        <RecognitionChoice saved={shown.recognition} engine={engine} idleMinutes={idleMinutes} save={speaking} />
        <div className="sending-settings">
          <label data-hint={hints.sendRightAway}>
            <input type="checkbox" checked={shown.sendRightAway} onChange={(event) => speaking({ sendRightAway: event.target.checked })} />
            {words.sendRightAway}
          </label>
        </div>
        <SavedStatus section="speaking" outcome={outcome} />
      </fieldset>
      <fieldset className="voice-service">
        <legend>{words.translatingAndSummingUp}</legend>
        <VoiceModelChoice saved={shown.voiceModel} engine={engine} idleMinutes={idleMinutes} profiles={profiles} save={saveIn("voiceModel")} />
        <SavedStatus section="voiceModel" outcome={outcome} />
      </fieldset>
      <fieldset className="voice-service">
        <legend>{words.whenTheAgentReplies}</legend>
        <ReplyChoice saved={shown.replyVoice} language={shown.replyLanguage} engine={engine} idleMinutes={idleMinutes} voiceModelSet={voiceModelSet} save={saveIn("replies")} />
        {speaksReplies(shown) && (
          <div className="sending-settings">
            <label data-hint={hints.keepTalking}>
              <input type="checkbox" checked={shown.keepTalking} onChange={(event) => saveIn("replies")({ keepTalking: event.target.checked })} />
              {words.keepTalking}
            </label>
          </div>
        )}
        <SavedStatus section="replies" outcome={outcome} />
      </fieldset>
      <ModelsOnThisMac
        engine={engine}
        inUse={thisMacModelsInUse(shown)}
        idleMinutes={idleMinutes}
        onIdleMinutes={(engineIdleMinutes) => saveIn("models")({ engineIdleMinutes })}
        status={<SavedStatus section="models" outcome={outcome} />}
      />
    </>
  );
}
