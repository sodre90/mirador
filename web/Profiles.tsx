import { useEffect, useMemo, useState } from "react";
import { profileSettingValue } from "../shared/apps.ts";
import { knownChoices } from "../shared/config-options.ts";
import { harnessIds, harnessLabels, type AskMode, type Conversation, type HarnessId, type Pastel, type Profile } from "../shared/model.ts";
import { maskSecrets, parseEnvironment } from "../shared/profile-environment.ts";
import type { ProfileDraft } from "../shared/protocol.ts";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { choicesOf, usePluginSettings } from "./plugin-settings.ts";
import { ProfileDot } from "./ProfileDot.tsx";
import { useTypingAidAttributes } from "./typing-aids.ts";

const words = t.profiles;
const environmentFormat = words.environmentFormat;

const NEW_PROFILE = "new";

const environmentPlaceholders: Record<HarnessId, string> = {
  claude: `ANTHROPIC_BASE_URL=http://localhost:8080
ANTHROPIC_AUTH_TOKEN=...
ANTHROPIC_MODEL=qwen3-coder
-u ANTHROPIC_API_KEY`,
  opencode: `OPENCODE_CONFIG=/Users/you/.config/opencode/work.json
# or inline, merged over your opencode config:
OPENCODE_CONFIG_CONTENT='{"model":"llama.cpp/qwen3"}'`,
  pi: `PI_CODING_AGENT_DIR=/Users/you/.pi/work
# or another pi than the one on PATH:
PI_ACP_PI_COMMAND=/opt/homebrew/bin/pi`,
  codex: `CODEX_HOME=/Users/you/.codex-work
# or settings over your Codex config, as JSON:
CODEX_CONFIG='{"model":"gpt-5.6-luna"}'`,
  copilot: `COPILOT_HOME=/Users/you/.copilot-work
# or a token instead of copilot login:
COPILOT_GITHUB_TOKEN=...`,
};

function useSaveProfile(onSaved: (profileId: string) => void) {
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "profile.saved" && message.requestId === pendingRequest) {
          setPendingRequest(null);
          onSaved(message.profileId);
        }
        if (message.type === "error") setPendingRequest(null);
      }),
    [pendingRequest, onSaved],
  );
  const save = (profile: ProfileDraft) => {
    const requestId = crypto.randomUUID();
    if (connection.send({ type: "profile.save", requestId, profile })) setPendingRequest(requestId);
  };
  return { save, saving: pendingRequest !== null };
}

function EnvironmentField({
  value,
  harness,
  onChange,
  startRevealed,
}: {
  value: string;
  harness: HarnessId;
  onChange: (value: string) => void;
  startRevealed: boolean;
}) {
  const [revealed, setRevealed] = useState(startRevealed);
  const typingAidAttributes = useTypingAidAttributes();
  if (!revealed) {
    return (
      <div className="environment-preview">
        <pre aria-label={words.environmentHidden}>{maskSecrets(value) || words.nothingSet}</pre>
        <button onClick={() => setRevealed(true)}>{words.editEnvironment}</button>
      </div>
    );
  }
  return (
    <textarea
      {...typingAidAttributes}
      aria-label={words.environment}
      className="environment"
      rows={10}
      spellCheck={false}
      placeholder={environmentPlaceholders[harness]}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const AGENTS_OWN_CHOICE = "";

/** Agent's default first, then the choices the agent listed last, and the profile's own if the agent has not listed it yet. */
function profileChoices(conversations: Conversation[], harness: HarnessId, category: "mode" | "thought_level", saved: string) {
  const known = knownChoices(conversations, harness, category).map(({ value, name }) => ({ value, name }));
  const savedButUnknown = saved !== AGENTS_OWN_CHOICE && !known.some(({ value }) => value === saved) ? [{ value: saved, name: saved }] : [];
  return [{ value: AGENTS_OWN_CHOICE, name: words.agentsDefault }, ...known, ...savedButUnknown];
}

/** A new profile runs an agent this machine has; one named after its agent keeps following the agent picked until it is renamed. */
type ProfilePluginSettings = Record<string, Record<string, string>>;

/** What installed plugins let each profile set, such as the profile the delegate plugin hands tasks to. */
function PluginProfileFields({
  profileId,
  profiles,
  chosen,
  onChoose,
}: {
  profileId: string | undefined;
  profiles: Profile[];
  chosen: ProfilePluginSettings;
  onChoose: (plugin: string, settingId: string, value: string) => void;
}) {
  const withProfileSettings = usePluginSettings().flatMap(({ plugin, profileSettings }) => (profileSettings ?? []).map((setting) => ({ plugin, setting })));
  return withProfileSettings.map(({ plugin, setting }) => (
    <label key={`${plugin}/${setting.id}`} data-hint={setting.hint}>
      <span>{setting.label}</span>
      <select aria-label={words.pluginSetting(setting.label)} value={profileSettingValue(chosen, plugin, setting)} onChange={(event) => onChoose(plugin, setting.id, event.target.value)}>
        {choicesOf(setting, profiles, profileId).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  ));
}

function ProfileEditor({
  profile,
  profiles,
  conversations,
  installedAgents,
  namedAfterAgent = false,
  isOnlyProfile = false,
  onSaved,
}: {
  profile: Profile | undefined;
  profiles: Profile[];
  conversations: Conversation[];
  installedAgents: HarnessId[];
  namedAfterAgent?: boolean;
  isOnlyProfile?: boolean;
  onSaved: (profileId: string) => void;
}) {
  const firstHarness = profile?.harness ?? installedAgents[0] ?? "claude";
  const [name, setName] = useState(profile?.name ?? (namedAfterAgent ? harnessLabels[firstHarness] : ""));
  const [harness, setHarness] = useState<HarnessId>(firstHarness);
  const [environment, setEnvironment] = useState(profile?.environment ?? "");
  const [prelaunch, setPrelaunch] = useState(profile?.prelaunch ?? "");
  const [mode, setMode] = useState(profile?.mode ?? AGENTS_OWN_CHOICE);
  const [effort, setEffort] = useState(profile?.effort ?? AGENTS_OWN_CHOICE);
  const [bypassPermissions, setBypassPermissions] = useState(profile?.bypassPermissions ?? false);
  const [askMode, setAskMode] = useState<AskMode>(profile?.askMode ?? "wait");
  const [color, setColor] = useState<Pastel | null>(profile?.color ?? null);
  const [pluginSettings, setPluginSettings] = useState<ProfilePluginSettings>(profile?.pluginSettings ?? {});
  const choosePluginSetting = (plugin: string, settingId: string, value: string) =>
    setPluginSettings((settings) => ({ ...settings, [plugin]: { ...settings[plugin], [settingId]: value } }));
  const [savedOnce, setSavedOnce] = useState(false);
  const typingAidAttributes = useTypingAidAttributes();
  const { save, saving } = useSaveProfile((profileId) => {
    setSavedOnce(true);
    onSaved(profileId);
  });
  const { errors } = useMemo(() => parseEnvironment(environment), [environment]);
  const unchanged =
    profile &&
    name === profile.name &&
    environment === profile.environment &&
    prelaunch === profile.prelaunch &&
    mode === (profile.mode ?? AGENTS_OWN_CHOICE) &&
    effort === (profile.effort ?? AGENTS_OWN_CHOICE) &&
    bypassPermissions === profile.bypassPermissions &&
    askMode === profile.askMode &&
    color === profile.color &&
    JSON.stringify(pluginSettings) === JSON.stringify(profile.pluginSettings ?? {});

  const deleteProfile = () => profile && connection.send({ type: "profile.delete", profileId: profile.id });

  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save({ id: profile?.id, name, harness, environment, prelaunch, mode: mode || null, effort: effort || null, bypassPermissions, askMode, color, pluginSettings });
      }}
    >
      <label>
        <span>{words.name}</span>
        <input {...typingAidAttributes} aria-label={words.nameLabel} value={name} placeholder={words.namePlaceholder} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>{words.agent}</span>
        <select
          aria-label={words.agentLabel}
          value={harness}
          disabled={Boolean(profile)}
          title={profile ? words.agentFixed : undefined}
          onChange={(event) => {
            const picked = event.target.value as HarnessId;
            if (name === harnessLabels[harness]) setName(harnessLabels[picked]);
            setHarness(picked);
            setMode(AGENTS_OWN_CHOICE);
            setEffort(AGENTS_OWN_CHOICE);
          }}
        >
          {harnessIds.map((id) => (
            <option key={id} value={id} disabled={!profile && !installedAgents.includes(id)}>
              {installedAgents.includes(id) ? harnessLabels[id] : words.notInstalled(harnessLabels[id])}
            </option>
          ))}
        </select>
      </label>
      <div className="field-label">{words.colour}</div>
      <ColorSwatches label={words.colourLabel} chosen={color} focusChosen={false} onChoose={setColor} />
      <div className="hint">{words.colourHint}</div>
      <label>
        <span>{words.mode}</span>
        <select aria-label={words.modeLabel} value={mode} onChange={(event) => setMode(event.target.value)}>
          {profileChoices(conversations, harness, "mode", mode).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{words.effort}</span>
        <select aria-label={words.effortLabel} value={effort} onChange={(event) => setEffort(event.target.value)}>
          {profileChoices(conversations, harness, "thought_level", effort).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" aria-label={words.yoloLabel} checked={bypassPermissions} onChange={(event) => setBypassPermissions(event.target.checked)} />
        <span>{words.yolo}</span>
      </label>
      <label>
        <span>{words.questions}</span>
        <select aria-label={words.questionsLabel} value={askMode} onChange={(event) => setAskMode(event.target.value as AskMode)}>
          {(Object.keys(t.chat.askMode) as AskMode[]).map((choice) => (
            <option key={choice} value={choice}>
              {t.chat.askMode[choice]}
            </option>
          ))}
        </select>
      </label>
      <div className="hint">{words.takenAtStart}</div>
      <PluginProfileFields profileId={profile?.id} profiles={profiles} chosen={pluginSettings} onChoose={choosePluginSetting} />
      <div className="field-label">{words.environment}</div>
      <EnvironmentField value={environment} harness={harness} onChange={setEnvironment} startRevealed={!profile} />
      <div className="hint">
        {environmentFormat.onePerLine}
        <code>KEY=value</code>
        {environmentFormat.afterKeyValue}
        <code>-u KEY</code>
        {environmentFormat.toUnset}
        <code>{environmentFormat.comment}</code>
        {environmentFormat.afterComment}
        <code>claude_env=( … )</code>
        {environmentFormat.afterArray}
        <code>$VAR</code>
        {environmentFormat.notExpanded}
      </div>
      {errors.length > 0 && (
        <ul className="form-errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <label>
        <span>{words.prelaunch}</span>
        <textarea
          {...typingAidAttributes}
          aria-label={words.prelaunchLabel}
          rows={3}
          spellCheck={false}
          placeholder="lsof -ti:8083 >/dev/null || (python3 ~/proxy.py >> ~/proxy.log 2>&1 &)"
          value={prelaunch}
          onChange={(event) => setPrelaunch(event.target.value)}
        />
      </label>
      <div className="hint">{words.prelaunchHint}</div>
      <div className="form-actions">
        <button type="submit" disabled={saving || errors.length > 0 || !name.trim() || unchanged}>
          {profile ? words.save : words.create}
        </button>
        {profile && !isOnlyProfile && (
          <ConfirmButton className="danger" label={words.deleteLabel} armedText={words.deleteArmed} armedHint={hints.deleteProfileArmed} onConfirm={deleteProfile}>
            {words.delete}
          </ConfirmButton>
        )}
        {savedOnce && unchanged && <span className="saved">{words.saved}</span>}
      </div>
      {profile && (
        <div className="hint">{words.restartHint}</div>
      )}
      {isOnlyProfile && <div className="hint">{words.onlyProfile}</div>}
    </form>
  );
}

/** With no profile yet, the main pane offers the first: an agent this machine has, named after it, run as it is set up here. */
export function FirstProfile({ installedAgents, conversations }: { installedAgents: HarnessId[]; conversations: Conversation[] }) {
  if (installedAgents.length === 0) {
    return (
      <div className="empty-state">
        <h2>{words.installAgentTitle}</h2>
        <p>{words.installAgentText}</p>
      </div>
    );
  }
  return (
    <div className="empty-state first-profile">
      <h2>{words.firstProfileTitle}</h2>
      <p>{words.firstProfileText}</p>
      <ProfileEditor profile={undefined} profiles={[]} conversations={conversations} installedAgents={installedAgents} namedAfterAgent onSaved={() => {}} />
    </div>
  );
}

export function ProfilesDialog({
  profiles,
  conversations,
  installedAgents,
  onClose,
}: {
  profiles: Profile[];
  conversations: Conversation[];
  installedAgents: HarnessId[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? NEW_PROFILE);
  const selected = profiles.find(({ id }) => id === selectedId);

  useEffect(() => {
    if (selectedId !== NEW_PROFILE && !selected) setSelectedId(profiles[0]?.id ?? NEW_PROFILE);
  }, [selectedId, selected, profiles]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal profiles" role="dialog" aria-label={words.title}>
        <header>
          <h2>{words.title}</h2>
          <button className="icon" title={words.close} aria-label={words.close} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hint">{words.dialogHint}</p>
        <div className="profiles-body">
          <ul className="profile-list">
            {profiles.map((profile) => (
              <li key={profile.id} className={profile.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(profile.id)}>
                <ProfileDot profile={profile} />
                {profile.name}
                <span className="profile-agent">{harnessLabels[profile.harness]}</span>
              </li>
            ))}
            <li className={selectedId === NEW_PROFILE ? "selected" : ""} onClick={() => setSelectedId(NEW_PROFILE)}>
              {words.newProfile}
            </li>
          </ul>
          <ProfileEditor
            key={selected?.id ?? NEW_PROFILE}
            profile={selected}
            profiles={profiles}
            conversations={conversations}
            installedAgents={installedAgents}
            isOnlyProfile={profiles.length === 1 && selected !== undefined}
            onSaved={setSelectedId}
          />
        </div>
      </div>
    </div>
  );
}
