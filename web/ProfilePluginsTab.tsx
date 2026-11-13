import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { isTextSetting, modelSettingsOf, profileSettingValue, type PluginChoiceProfileSetting, type PluginProfileSetting, type PluginTextProfileSetting } from "../shared/apps.ts";
import type { Profile } from "../shared/model.ts";
import type { ProfileDraft } from "../shared/protocol.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { conversationPlugins, titlesOfPlugins, useChoicesOf, usePluginSettings } from "./plugin-settings.ts";
import { groupedToggles, isOn, launchVariableOf, matchesSearch, pluginRows, rowDiffers, shownSettings, showsEverySetting, summaryOf, turned, type LaunchVariable, type PluginRow, type ProfilePlugins } from "./plugin-rows.ts";
import { UnsavedMark } from "./UnsavedMark.tsx";

const words = t.profiles;
const tabWords = words.pluginsTab;

/** What the tab edits of the profile, with the Launch environment its typed settings may read. */
type ProfileForm = ProfilePlugins & { environment: string };

/** The plugin's check of the settings the form holds, answered for the form as it was when asked. */
function usePluginProfileCheck(plugin: string) {
  const [asking, setAsking] = useState<{ requestId: string; formKey: string } | null>(null);
  const [outcome, setOutcome] = useState<{ formKey: string; answer: string | null; problem: string | null } | null>(null);
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type !== "plugin.profile-checked" || message.requestId !== asking?.requestId) return;
        setOutcome({ formKey: asking.formKey, answer: message.answer, problem: message.problem });
        setAsking(null);
      }),
    [asking],
  );
  useEffect(
    () =>
      connection.onStatus((status) => {
        if (status !== "open") setAsking(null);
      }),
    [],
  );
  const check = (profile: ProfileDraft, formKey: string) => {
    const requestId = crypto.randomUUID();
    setOutcome(null);
    if (connection.send({ type: "plugin.check-profile", requestId, plugin, profile })) setAsking({ requestId, formKey });
  };
  return { check, checking: asking !== null, outcome };
}

function PluginProfileCheck({ plugin, draft }: { plugin: string; draft: () => ProfileDraft }) {
  const { check, checking, outcome } = usePluginProfileCheck(plugin);
  const formKeyOf = (profile: ProfileDraft) => JSON.stringify([profile.environment, profile.pluginSettings?.[plugin] ?? {}]);
  const shownOutcome = outcome?.formKey === formKeyOf(draft()) ? outcome : null;
  return (
    <div className="plugin-profile-check">
      <button type="button" disabled={checking} onClick={() => check(draft(), formKeyOf(draft()))}>
        {checking ? words.checkingProfile : words.checkProfile}
      </button>
      {shownOutcome && (
        <div className={`plugin-check-result${shownOutcome.problem === null ? "" : " problem"}`} role={shownOutcome.problem === null ? "status" : "alert"}>
          {shownOutcome.problem ?? shownOutcome.answer}
        </div>
      )}
    </div>
  );
}

interface PluginProfileFieldProps {
  setting: PluginProfileSetting;
  settingsOfPlugin: PluginProfileSetting[];
  profileId: string | undefined;
  profiles: Profile[];
  environment: string;
  valueOf: (setting: PluginProfileSetting) => string;
  onChoose: (value: string) => void;
}

function PluginProfileField(props: PluginProfileFieldProps) {
  const { setting, valueOf, onChoose, environment } = props;
  if (isTextSetting(setting)) return <PluginTextField setting={setting} value={valueOf(setting)} environment={environment} onChoose={onChoose} />;
  if (setting.kind === "toggle") {
    return (
      <label className="plugin-toggle">
        <input type="checkbox" aria-label={words.pluginSetting(setting.label)} checked={valueOf(setting) === "on"} onChange={(event) => onChoose(event.target.checked ? "on" : "off")} />
        <span>
          <span className="plugin-field-label">{setting.label}</span>
          {setting.hint && <span className="plugin-hint">{setting.hint}</span>}
        </span>
      </label>
    );
  }
  return <PluginChoiceField {...props} setting={setting} />;
}

function launchVariableHint(variable: LaunchVariable, empty: boolean) {
  if (variable.state === "unset") return tabWords.launchUnsets(variable.name);
  if (variable.state === "missing") return tabWords.launchLacks(variable.name);
  return empty ? tabWords.emptyUsesLaunch(variable.name) : tabWords.readsLaunch(variable.name);
}

function PluginTextField({ setting, value, environment, onChoose }: { setting: PluginTextProfileSetting; value: string; environment: string; onChoose: (value: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const secret = setting.kind === "secret";
  const empty = value.trim() === "";
  const variable = launchVariableOf(setting, value, environment);
  const inherited = empty && variable?.state === "set";
  const placeholder = inherited ? (secret ? "••••••••" : variable.value) : setting.placeholder;
  return (
    <div className="plugin-field">
      <label className="plugin-field-label" htmlFor={inputId}>
        {setting.label}
      </label>
      <div className="plugin-text-input">
        <input
          id={inputId}
          type={secret && !revealed ? "password" : "text"}
          aria-label={words.pluginSetting(setting.label)}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => onChoose(event.target.value)}
        />
        {variable && <span className={`plugin-pill${variable.state === "set" ? "" : " missing"}`}>{variable.state === "set" ? tabWords.fromLaunch : tabWords.notInLaunch}</span>}
        {setting.fallsBackTo && !empty && (
          <button type="button" className="link" aria-label={tabWords.useLaunchValueOf(setting.label)} onClick={() => onChoose("")}>
            {tabWords.useLaunchValue}
          </button>
        )}
        {secret && !empty && (
          <button type="button" className="link" aria-pressed={revealed} aria-label={revealed ? words.hideSecretOf(setting.label) : words.showSecretOf(setting.label)} onClick={() => setRevealed(!revealed)}>
            {revealed ? words.hideSecret : words.showSecret}
          </button>
        )}
      </div>
      {setting.hint && <p className="plugin-hint">{setting.hint}</p>}
      <p className="plugin-hint">{variable ? launchVariableHint(variable, empty) : hints.pluginTextSetting}</p>
      {secret && <p className="plugin-hint">{tabWords.secretKept}</p>}
    </div>
  );
}

function PluginChoiceField({ setting, settingsOfPlugin, profileId, profiles, valueOf, onChoose }: PluginProfileFieldProps & { setting: PluginChoiceProfileSetting }) {
  const value = valueOf(setting);
  const choices = useChoicesOf(setting, settingsOfPlugin, profiles, profileId, valueOf, value);
  const selectId = useId();
  return (
    <div className="plugin-field">
      <label className="plugin-field-label" htmlFor={selectId}>
        {setting.label}
      </label>
      <select id={selectId} aria-label={words.pluginSetting(setting.label)} value={value} onChange={(event) => onChoose(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {setting.hint && <p className="plugin-hint">{setting.hint}</p>}
    </div>
  );
}

function ToolList({ heading, tools }: { heading: string; tools: string[] }) {
  return (
    <div className="plugin-tools">
      <div className="plugin-subhead">{heading}</div>
      <ul>
        {tools.map((tool) => (
          <li key={tool}>
            <code>{tool}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="plugin-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

interface PluginRowViewProps {
  row: PluginRow;
  open: boolean;
  onToggleOpen: () => void;
  form: ProfileForm;
  saved: ProfilePlugins;
  profileId: string | undefined;
  profiles: Profile[];
  onChooseSetting: (plugin: string, settingId: string, value: string) => void;
  onTurn: (on: boolean) => void;
  draft: () => ProfileDraft;
}

function PluginRowView({ row, open, onToggleOpen, form, saved, profileId, profiles, onChooseSetting, onTurn, draft }: PluginRowViewProps) {
  const titleId = useId();
  const summaryId = useId();
  const unsavedId = useId();
  const bodyId = useId();
  const on = isOn(row, form);
  const unsaved = rowDiffers(row, form, saved);
  const valueOf = (setting: PluginProfileSetting) => profileSettingValue(form.pluginSettings, row.plugin, setting);
  const shown = shownSettings(row.settings, valueOf);
  const chooseSetting = (setting: PluginProfileSetting) => (value: string) => {
    onChooseSetting(row.plugin, setting.id, value);
    modelSettingsOf(row.settings, setting.id).forEach((modelSetting) => onChooseSetting(row.plugin, modelSetting.id, modelSetting.default));
  };
  return (
    <section className={`plugin-row${on ? " on" : ""}`} role="group" aria-labelledby={titleId}>
      <div className="plugin-row-head">
        <button
          type="button"
          className="plugin-disclose"
          aria-labelledby={titleId}
          aria-describedby={unsaved ? `${summaryId} ${unsavedId}` : summaryId}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggleOpen}
        >
          <span className="plugin-mark" aria-hidden="true">
            {row.title.charAt(0).toLocaleUpperCase()}
          </span>
          <span className="plugin-text">
            <span className="plugin-name">
              <span id={titleId}>{row.title}</span>
              {unsaved && <UnsavedMark id={unsavedId} />}
            </span>
            <span className="plugin-summary" id={summaryId}>
              {summaryOf(row, form, profiles)}
            </span>
          </span>
          <Chevron />
        </button>
        {row.switchable && (
          <label className="plugin-switch">
            <input type="checkbox" role="switch" aria-label={tabWords.use(row.title)} checked={on} onChange={(event) => onTurn(event.target.checked)} />
            <span className="plugin-switch-track" aria-hidden="true" />
          </label>
        )}
      </div>
      <div className="plugin-body" id={bodyId} hidden={!open}>
        {on ? (
          <>
            {shown.length === 0 && row.tools.length === 0 && <p className="plugin-hint">{tabWords.nothingToSet}</p>}
            {groupedToggles(shown).map((group) => {
              const fields = group.map((setting) => (
                <PluginProfileField
                  key={setting.id}
                  setting={setting}
                  settingsOfPlugin={row.settings}
                  profileId={profileId}
                  profiles={profiles}
                  environment={form.environment}
                  valueOf={valueOf}
                  onChoose={chooseSetting(setting)}
                />
              ));
              return group.length > 1 ? (
                <div key={group[0]!.id} className="plugin-toggles">
                  {fields}
                </div>
              ) : (
                fields
              );
            })}
            {row.checksProfile && showsEverySetting(row.settings, valueOf) && <PluginProfileCheck plugin={row.plugin} draft={draft} />}
            {row.tools.length > 0 && <ToolList heading={tabWords.toolsItGives} tools={row.tools} />}
          </>
        ) : (
          <>
            <p className="plugin-hint">{tabWords.turnOnToUse(row.title)}</p>
            {row.tools.length > 0 && <ToolList heading={tabWords.toolsItWouldGive} tools={row.tools} />}
          </>
        )}
      </div>
    </section>
  );
}

/** Whether the profile has anything to set on the Plugins tab: a plugin to turn off, or a plugin's setting. */
export const usePluginsTabHasRows = () => pluginRows(conversationPlugins(), usePluginSettings(), titlesOfPlugins()).length > 0;

/**
 * Every plugin a profile can turn off or set something for, each a row that opens in place: its switch, a line of what
 * it holds, and once open its settings, built from its plugin.json alone, and the tools it gives the agent.
 */
export function ProfilePluginsTab({
  profileId,
  profiles,
  form,
  saved,
  onChooseSetting,
  onPluginsOff,
  draft,
}: {
  profileId: string | undefined;
  profiles: Profile[];
  form: ProfileForm;
  saved: ProfilePlugins;
  onChooseSetting: (plugin: string, settingId: string, value: string) => void;
  onPluginsOff: (pluginsOff: string[]) => void;
  draft: () => ProfileDraft;
}) {
  const rows = pluginRows(conversationPlugins(), usePluginSettings(), titlesOfPlugins());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string[]>([]);
  const shownRows = rows.filter((row) => matchesSearch(row, query));
  const switchable = rows.filter(({ switchable }) => switchable);
  const onCount = switchable.filter((row) => isOn(row, form)).length;
  const toggleOpen = (plugin: string) => setOpen((current) => (current.includes(plugin) ? current.filter((name) => name !== plugin) : [...current, plugin]));
  const turn = ({ plugin, pluginSwitch }: PluginRow, on: boolean) => {
    if (on || pluginSwitch === null) onPluginsOff(turned(form.pluginsOff, plugin, on));
    if (pluginSwitch) onChooseSetting(plugin, pluginSwitch.id, on ? "on" : "off");
    if (on) setOpen((current) => (current.includes(plugin) ? current : [...current, plugin]));
  };
  const clearOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || query === "") return;
    event.stopPropagation();
    setQuery("");
  };
  return (
    <>
      <p className="hint">{tabWords.intro}</p>
      <div className="plugins-toolbar">
        <input type="search" className="plugins-search" aria-label={tabWords.search} placeholder={tabWords.search} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={clearOnEscape} />
        {switchable.length > 0 && <span className="plugins-tally">{tabWords.onOfAll(onCount, switchable.length)}</span>}
      </div>
      <div className="plugin-rows">
        {shownRows.length === 0 && <p className="plugin-hint">{tabWords.noMatch(query.trim())}</p>}
        {shownRows.map((row) => (
          <PluginRowView
            key={row.plugin}
            row={row}
            open={open.includes(row.plugin)}
            onToggleOpen={() => toggleOpen(row.plugin)}
            form={form}
            saved={saved}
            profileId={profileId}
            profiles={profiles}
            onChooseSetting={onChooseSetting}
            onTurn={(on) => turn(row, on)}
            draft={draft}
          />
        ))}
      </div>
    </>
  );
}
