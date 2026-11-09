import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { modelSettingsOf, profileSettingValue, type PluginProfileSetting } from "../shared/apps.ts";
import { categoryChoices, knownChoices } from "../shared/config-options.ts";
import { harnessIds, harnessLabels, type AskMode, type Conversation, type HarnessId, type Pastel, type Profile } from "../shared/model.ts";
import { maskSecrets, parseEnvironment } from "../shared/profile-environment.ts";
import type { ProfileDraft } from "../shared/protocol.ts";
import { ColorSwatches } from "./ColorSwatches.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { useChoicesOf, usePluginSettings } from "./plugin-settings.ts";
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
  antigravity: `# an OpenAI-compatible endpoint instead of the Google sign-in:
AGY_LLM_GATEWAY_URL=http://localhost:8080
AGY_LLM_GATEWAY_WIRE_PROTOCOL=openai
AGY_LLM_GATEWAY_API_KEY=...`,
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

/** Agent's default first, then the choices the agent lists, and the profile's own if the agent has not offered it. */
function dropdownChoices(conversations: Conversation[], harness: HarnessId, category: "mode" | "thought_level", saved: string, fetched: SessionConfigOption[] | null) {
  const known = (fetched ? categoryChoices(fetched, category) : knownChoices(conversations, harness, category)).map(({ value, name }) => ({ value, name }));
  const savedButUnknown = saved !== AGENTS_OWN_CHOICE && !known.some(({ value }) => value === saved) ? [{ value: saved, name: saved }] : [];
  return [{ value: AGENTS_OWN_CHOICE, name: words.agentsDefault }, ...known, ...savedButUnknown];
}

/** What the profile's agent itself says it offers, asked each time its editor opens and each time its saved launch changes; null while it answers or when it did not. */
function useAgentChoices(profile: Profile | undefined) {
  const [fetched, setFetched] = useState<SessionConfigOption[] | null>(null);
  const savedLaunch = profile ? JSON.stringify([profile.environment, profile.prelaunch]) : "";
  useEffect(() => {
    if (!profile?.id) return;
    setFetched(null);
    const requestId = crypto.randomUUID();
    const stopListening = connection.onMessage((message) => {
      if (message.type === "profile.choices.got" && message.requestId === requestId) setFetched(message.configOptions);
    });
    connection.send({ type: "profile.choices.get", requestId, profileId: profile.id });
    return stopListening;
  }, [profile?.id, savedLaunch]);
  return fetched;
}

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
  const withProfileSettings = usePluginSettings().flatMap(({ plugin, profileSettings = [] }) => profileSettings.map((setting) => ({ plugin, setting, settingsOfPlugin: profileSettings })));
  return withProfileSettings.map(({ plugin, setting, settingsOfPlugin }) => (
    <PluginProfileField
      key={`${plugin}/${setting.id}`}
      setting={setting}
      settingsOfPlugin={settingsOfPlugin}
      profileId={profileId}
      profiles={profiles}
      valueOf={(each) => profileSettingValue(chosen, plugin, each)}
      onChoose={(value) => {
        onChoose(plugin, setting.id, value);
        modelSettingsOf(settingsOfPlugin, setting.id).forEach((modelSetting) => onChoose(plugin, modelSetting.id, modelSetting.default));
      }}
    />
  ));
}

function PluginProfileField({
  setting,
  settingsOfPlugin,
  profileId,
  profiles,
  valueOf,
  onChoose,
}: {
  setting: PluginProfileSetting;
  settingsOfPlugin: PluginProfileSetting[];
  profileId: string | undefined;
  profiles: Profile[];
  valueOf: (setting: PluginProfileSetting) => string;
  onChoose: (value: string) => void;
}) {
  const value = valueOf(setting);
  const choices = useChoicesOf(setting, settingsOfPlugin, profiles, profileId, valueOf, value);
  return (
    <label data-hint={setting.hint}>
      <span>{setting.label}</span>
      <select aria-label={words.pluginSetting(setting.label)} value={value} onChange={(event) => onChoose(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ProfileForm {
  name: string;
  harness: HarnessId;
  environment: string;
  prelaunch: string;
  mode: string;
  effort: string;
  bypassPermissions: boolean;
  askMode: AskMode;
  idleCompaction: boolean;
  color: Pastel | null;
  pluginSettings: ProfilePluginSettings;
}

const savedForm = (profile: Profile): ProfileForm => ({
  name: profile.name,
  harness: profile.harness,
  environment: profile.environment,
  prelaunch: profile.prelaunch,
  mode: profile.mode ?? AGENTS_OWN_CHOICE,
  effort: profile.effort ?? AGENTS_OWN_CHOICE,
  bypassPermissions: profile.bypassPermissions,
  askMode: profile.askMode,
  idleCompaction: profile.idleCompaction ?? true,
  color: profile.color,
  pluginSettings: profile.pluginSettings ?? {},
});

const blankForm = (harness: HarnessId, name: string): ProfileForm => ({
  name,
  harness,
  environment: "",
  prelaunch: "",
  mode: AGENTS_OWN_CHOICE,
  effort: AGENTS_OWN_CHOICE,
  bypassPermissions: false,
  askMode: "wait",
  idleCompaction: true,
  color: null,
  pluginSettings: {},
});

type FormField = keyof ProfileForm;

const editorTabs = ["launch", "defaults", "plugins"] as const;
type EditorTab = (typeof editorTabs)[number];

const fieldsOfTab: Record<EditorTab, FormField[]> = {
  launch: ["name", "harness", "color", "environment", "prelaunch"],
  defaults: ["mode", "effort", "bypassPermissions", "askMode", "idleCompaction"],
  plugins: ["pluginSettings"],
};

const allFields = editorTabs.flatMap((tab) => fieldsOfTab[tab]);

const differsIn = (form: ProfileForm, other: ProfileForm, fields: FormField[]) => fields.some((field) => JSON.stringify(form[field]) !== JSON.stringify(other[field]));

function UnsavedMark() {
  return <span className="unsaved-mark" role="img" aria-label={words.unsaved} data-hint={hints.unsavedProfileEdits} />;
}

type ChangeForm = (change: (form: ProfileForm) => ProfileForm) => void;

function ProfileEditor({
  profile,
  form,
  saved,
  onChange,
  tab,
  onTab,
  profiles,
  conversations,
  installedAgents,
  isOnlyProfile = false,
  onMoreOptions,
  onSaved,
}: {
  profile: Profile | undefined;
  form: ProfileForm;
  /** What the form is compared with: the profile as saved, or a new profile's empty form. */
  saved: ProfileForm;
  onChange: ChangeForm;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  profiles: Profile[];
  conversations: Conversation[];
  installedAgents: HarnessId[];
  isOnlyProfile?: boolean;
  /** Given while the editor shows only what a first profile needs. */
  onMoreOptions?: () => void;
  onSaved: (profileId: string) => void;
}) {
  const { name, harness, environment, prelaunch, mode, effort, bypassPermissions, askMode, idleCompaction, color, pluginSettings } = form;
  const set = (fields: Partial<ProfileForm>) => onChange((current) => ({ ...current, ...fields }));
  const choosePluginSetting = (plugin: string, settingId: string, value: string) =>
    onChange((current) => ({ ...current, pluginSettings: { ...current.pluginSettings, [plugin]: { ...current.pluginSettings[plugin], [settingId]: value } } }));
  const [savedOnce, setSavedOnce] = useState(false);
  const agentChoices = useAgentChoices(profile);
  const typingAidAttributes = useTypingAidAttributes();
  const { save, saving } = useSaveProfile((profileId) => {
    setSavedOnce(true);
    onSaved(profileId);
  });
  const { errors } = useMemo(() => parseEnvironment(environment), [environment]);
  const pluginsHaveProfileSettings = usePluginSettings().some(({ profileSettings = [] }) => profileSettings.length > 0);
  const shownTabs = editorTabs.filter((each) => each !== "plugins" || pluginsHaveProfileSettings);
  const openTab = shownTabs.includes(tab) ? tab : "launch";
  const unchanged = profile && !differsIn(form, saved, allFields);
  const restartsAgent = profile && differsIn(form, saved, ["environment", "prelaunch"]);
  const modes = dropdownChoices(conversations, harness, "mode", mode, agentChoices);
  const efforts = dropdownChoices(conversations, harness, "thought_level", effort, agentChoices);
  const offersAChoice = (choices: unknown[]) => choices.length > 1;

  const deleteProfile = () => profile && connection.send({ type: "profile.delete", profileId: profile.id });

  const nameField = (
    <label>
      <span>{words.name}</span>
      <input {...typingAidAttributes} aria-label={words.nameLabel} value={name} placeholder={words.namePlaceholder} onChange={(event) => set({ name: event.target.value })} />
    </label>
  );

  const agentField = !profile && (
    <label>
      <span>{words.agent}</span>
      <select
        aria-label={words.agentLabel}
        value={harness}
        onChange={(event) => {
          const picked = event.target.value as HarnessId;
          set({ harness: picked, mode: AGENTS_OWN_CHOICE, effort: AGENTS_OWN_CHOICE, ...(name === harnessLabels[harness] && { name: harnessLabels[picked] }) });
        }}
      >
        {harnessIds.map((id) => (
          <option key={id} value={id} disabled={!installedAgents.includes(id)}>
            {installedAgents.includes(id) ? harnessLabels[id] : words.notInstalled(harnessLabels[id])}
          </option>
        ))}
      </select>
    </label>
  );

  const actions = (
    <div className="form-actions">
      <button type="submit" disabled={saving || errors.length > 0 || !name.trim() || unchanged}>
        {profile ? words.save : words.create}
      </button>
      {profile && !isOnlyProfile && (
        <ConfirmButton className="danger" label={words.deleteLabel} armedText={words.deleteArmed} armedHint={hints.deleteProfileArmed} onConfirm={deleteProfile}>
          {words.delete}
        </ConfirmButton>
      )}
      {isOnlyProfile && (
        <span className="only-profile" data-hint={hints.onlyProfile}>
          <button type="button" className="danger" aria-label={words.deleteLabel} disabled>
            {words.delete}
          </button>
        </span>
      )}
      {onMoreOptions && (
        <button type="button" className="link" onClick={onMoreOptions}>
          {words.moreOptions}
        </button>
      )}
      {savedOnce && unchanged && <span className="saved">{words.saved}</span>}
    </div>
  );

  const saveForm = (event: FormEvent) => {
    event.preventDefault();
    save({
      id: profile?.id,
      name,
      harness,
      environment,
      prelaunch,
      mode: mode || null,
      effort: effort || null,
      bypassPermissions,
      askMode,
      ...(harness === "claude" && !idleCompaction && { idleCompaction: false }),
      color,
      pluginSettings,
    });
  };

  if (onMoreOptions) {
    return (
      <form className="profile-editor" onSubmit={saveForm}>
        {agentField}
        {nameField}
        {actions}
      </form>
    );
  }

  const tabId = (each: EditorTab) => `profile-tab-${each}`;
  const panelOf = (each: EditorTab) => ({ role: "tabpanel", "aria-labelledby": tabId(each), hidden: each !== openTab, className: "profile-panel" });

  return (
    <form className="profile-editor" onSubmit={saveForm}>
      <h3 className="profile-heading">
        {profile && <ProfileDot profile={{ ...profile, color }} />}
        {name.trim() || words.newProfileHeading}
        <span className="profile-agent">{harnessLabels[harness]}</span>
      </h3>
      <div className="profile-tabs" role="tablist" aria-label={words.tabsLabel}>
        {shownTabs.map((each) => (
          <button key={each} type="button" role="tab" id={tabId(each)} aria-selected={each === openTab} onClick={() => onTab(each)}>
            {words.tabs[each]}
            {differsIn(form, saved, fieldsOfTab[each]) && <UnsavedMark />}
          </button>
        ))}
      </div>
      <div className="profile-panels">
        <div {...panelOf("launch")}>
          <div className="name-and-colour">
            {nameField}
            <div data-hint={hints.profileColour}>
              <div className="field-label">{words.colour}</div>
              <ColorSwatches label={words.colourLabel} chosen={color} focusChosen={false} onChoose={(chosen) => set({ color: chosen })} />
            </div>
          </div>
          {agentField}
          <div className="field-label">{words.environment}</div>
          <EnvironmentField value={environment} harness={harness} onChange={(value) => set({ environment: value })} startRevealed={!profile || environment !== saved.environment} />
          <details className="environment-format">
            <summary>{words.format}</summary>
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
          </details>
          <label data-hint={hints.profilePrelaunch}>
            <span>{words.prelaunch}</span>
            <textarea
              {...typingAidAttributes}
              aria-label={words.prelaunch}
              rows={3}
              spellCheck={false}
              placeholder="lsof -ti:8083 >/dev/null || (python3 ~/proxy.py >> ~/proxy.log 2>&1 &)"
              value={prelaunch}
              onChange={(event) => set({ prelaunch: event.target.value })}
            />
          </label>
        </div>
        <div {...panelOf("defaults")}>
          <div className="hint">{words.defaultsIntro}</div>
          {offersAChoice(modes) && (
            <label data-hint={hints.profileMode}>
              <span>{words.mode}</span>
              <select aria-label={words.modeLabel} value={mode} onChange={(event) => set({ mode: event.target.value })}>
                {modes.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {offersAChoice(efforts) && (
            <label data-hint={hints.profileEffort}>
              <span>{words.effort}</span>
              <select aria-label={words.effortLabel} value={effort} onChange={(event) => set({ effort: event.target.value })}>
                {efforts.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{words.questions}</span>
            <select aria-label={words.questionsLabel} value={askMode} onChange={(event) => set({ askMode: event.target.value as AskMode })}>
              {(Object.keys(t.chat.askMode) as AskMode[]).map((choice) => (
                <option key={choice} value={choice}>
                  {t.chat.askMode[choice]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox" data-hint={hints.profileYolo}>
            <input type="checkbox" aria-label={words.yoloLabel} checked={bypassPermissions} onChange={(event) => set({ bypassPermissions: event.target.checked })} />
            <span>{words.yolo}</span>
          </label>
          {harness === "claude" && (
            <label className="checkbox" data-hint={hints.profileIdleCompaction}>
              <input type="checkbox" aria-label={words.idleCompactionLabel} checked={idleCompaction} onChange={(event) => set({ idleCompaction: event.target.checked })} />
              <span>{words.idleCompaction}</span>
            </label>
          )}
        </div>
        {pluginsHaveProfileSettings && (
          <div {...panelOf("plugins")}>
            <PluginProfileFields profileId={profile?.id} profiles={profiles} chosen={pluginSettings} onChoose={choosePluginSetting} />
          </div>
        )}
      </div>
      <footer className="profile-footer">
        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {actions}
        {restartsAgent && <div className="hint">{words.restartHint}</div>}
      </footer>
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
      <FirstProfileEditor installedAgents={installedAgents} conversations={conversations} />
    </div>
  );
}

/** Agent, name and Create profile; More options opens the rest. */
function FirstProfileEditor({ installedAgents, conversations }: { installedAgents: HarnessId[]; conversations: Conversation[] }) {
  const [namedAfterAgent] = useState(() => blankForm(installedAgents[0], harnessLabels[installedAgents[0]]));
  const [form, setForm] = useState(namedAfterAgent);
  const [tab, setTab] = useState<EditorTab>("launch");
  const [showsEverything, setShowsEverything] = useState(false);
  return (
    <ProfileEditor
      profile={undefined}
      form={form}
      saved={namedAfterAgent}
      onChange={setForm}
      tab={tab}
      onTab={setTab}
      profiles={[]}
      conversations={conversations}
      installedAgents={installedAgents}
      onMoreOptions={showsEverything ? undefined : () => setShowsEverything(true)}
      onSaved={() => {}}
    />
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
  const [tab, setTab] = useState<EditorTab>("launch");
  const [drafts, setDrafts] = useState<Record<string, ProfileForm>>({});
  const [askedBeforeClosing, setAskedBeforeClosing] = useState(false);
  const selected = profiles.find(({ id }) => id === selectedId);
  const selectedKey = selected?.id ?? NEW_PROFILE;

  const newProfileForm = blankForm(installedAgents[0] ?? "claude", "");
  const savedFormOf = (key: string) => {
    const profile = profiles.find(({ id }) => id === key);
    return profile ? savedForm(profile) : newProfileForm;
  };
  const hasUnsavedEdits = (key: string) => key in drafts && differsIn(drafts[key], savedFormOf(key), allFields);
  const editedProfileNames = [...profiles.filter(({ id }) => hasUnsavedEdits(id)).map(({ name }) => name), ...(hasUnsavedEdits(NEW_PROFILE) ? [words.newProfileHeading] : [])];
  const hasEdits = editedProfileNames.length > 0;

  const changeSelectedForm: ChangeForm = (change) => setDrafts((current) => ({ ...current, [selectedKey]: change(current[selectedKey] ?? savedFormOf(selectedKey)) }));
  const forgetDraftOnceSaved = (profileId: string) => {
    setDrafts(({ [selectedKey]: savedDraft, ...others }) => others);
    setSelectedId(profileId);
  };

  useEffect(() => {
    if (selectedId !== NEW_PROFILE && !selected) setSelectedId(profiles[0]?.id ?? NEW_PROFILE);
  }, [selectedId, selected, profiles]);

  useEffect(() => {
    if (!hasEdits) setAskedBeforeClosing(false);
  }, [hasEdits]);

  const close = () => (hasEdits ? setAskedBeforeClosing(true) : onClose());

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (askedBeforeClosing) setAskedBeforeClosing(false);
      else if (hasEdits) setAskedBeforeClosing(true);
      else onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, hasEdits, askedBeforeClosing]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal profiles" role="dialog" aria-label={words.title}>
        <header>
          <h2>{words.title}</h2>
          <button className="icon" title={words.close} aria-label={words.close} onClick={close}>
            ×
          </button>
        </header>
        <p className="hint">{words.dialogHint}</p>
        {askedBeforeClosing && (
          <div className="warning unsaved-on-close" role="alertdialog" aria-label={words.unsaved}>
            <span>{words.unsavedOnClose(editedProfileNames)}</span>
            <button autoFocus onClick={() => setAskedBeforeClosing(false)}>
              {words.keepEditing}
            </button>
            <button className="danger" onClick={onClose}>
              {words.discardAndClose}
            </button>
          </div>
        )}
        <div className="profiles-body">
          <ul className="profile-list">
            {profiles.map((profile) => (
              <li key={profile.id} className={profile.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(profile.id)}>
                <ProfileDot profile={profile} />
                {profile.name}
                {hasUnsavedEdits(profile.id) && <UnsavedMark />}
                <span className="profile-agent">{harnessLabels[profile.harness]}</span>
              </li>
            ))}
            <li className={selectedId === NEW_PROFILE ? "selected" : ""} onClick={() => setSelectedId(NEW_PROFILE)}>
              {words.newProfile}
              {hasUnsavedEdits(NEW_PROFILE) && <UnsavedMark />}
            </li>
          </ul>
          <ProfileEditor
            key={selectedKey}
            profile={selected}
            form={drafts[selectedKey] ?? savedFormOf(selectedKey)}
            saved={savedFormOf(selectedKey)}
            onChange={changeSelectedForm}
            tab={tab}
            onTab={setTab}
            profiles={profiles}
            conversations={conversations}
            installedAgents={installedAgents}
            isOnlyProfile={profiles.length === 1 && selected !== undefined}
            onSaved={forgetDraftOnceSaved}
          />
        </div>
      </div>
    </div>
  );
}
