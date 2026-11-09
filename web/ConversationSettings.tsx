import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { profileSettingValue } from "../shared/apps.ts";
import { chosenModel, flatSelectOptions, nameWithMultiplier } from "../shared/config-options.ts";
import { harnessLabels, type AskMode, type Conversation, type Profile } from "../shared/model.ts";
import { agentBesideProfile } from "../shared/profile-label.ts";
import { placedBelowOnItsSide, useClosing } from "./BarMenu.tsx";
import { choiceGroups } from "./choices.ts";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { choicesOf, usePluginSettings } from "./plugin-settings.ts";
import { ProfileDot } from "./ProfileDot.tsx";
import { SearchableSelect } from "./SearchableSelect.tsx";

const words = t.chat;

/** Past this many choices a plain select is hard to scan: opencode lists every model of every provider. */
const SEARCHABLE_FROM_CHOICES = 20;

const configOptionHint = (option: SessionConfigOption) => [option.description, hints.configOption].filter(Boolean).join("\n\n");

function ConfigControl({ conversationId, option }: { conversationId: string; option: SessionConfigOption }) {
  const setValue = (value: string | boolean) => connection.send({ type: "conversation.set-config", conversationId, configId: option.id, value });
  if (option.type === "boolean") {
    return (
      <label className="config" data-hint={configOptionHint(option)}>
        <input type="checkbox" aria-label={option.name} checked={option.currentValue} onChange={(event) => setValue(event.target.checked)} />
        {option.name}
      </label>
    );
  }
  const choices = flatSelectOptions(option);
  if (choices.length > SEARCHABLE_FROM_CHOICES) {
    return (
      <SearchableSelect
        label={option.name}
        hint={configOptionHint(option)}
        value={option.currentValue}
        groups={choiceGroups(option)}
        onChange={setValue}
      />
    );
  }
  return (
    <label className="config" data-hint={configOptionHint(option)}>
      <span>{option.name}</span>
      <select aria-label={option.name} value={option.currentValue} onChange={(event) => setValue(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value} title={choice.description ?? undefined}>
            {nameWithMultiplier(choice)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Profiles of the conversation's own agent, then the other agents', which can be picked only until the conversation has
 * begun: another agent cannot continue its session. One that has no profile to run on asks for one.
 */
function ProfilePicker({ conversation, profiles, begun }: { conversation: Conversation; profiles: Profile[]; begun: boolean }) {
  const choices = profiles.filter(({ harness }) => harness === conversation.harness);
  const otherAgents = profiles.filter(({ harness }) => harness !== conversation.harness);
  const hasItsProfile = choices.some(({ id }) => id === conversation.profileId);
  return (
    <label className="config" data-hint={hints.profile}>
      <span>{words.header.profile}</span>
      <ProfileDot profile={profiles.find(({ id }) => id === conversation.profileId)} />
      <select
        aria-label={words.header.profile}
        value={hasItsProfile ? conversation.profileId! : ""}
        onChange={(event) => connection.send({ type: "conversation.set-profile", conversationId: conversation.id, profileId: event.target.value })}
      >
        {!hasItsProfile && (
          <option value="" disabled>
            {conversation.profileId === null ? words.header.pickProfile : words.header.deletedProfile}
          </option>
        )}
        {choices.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
        {otherAgents.length > 0 && (
          <optgroup label={begun ? words.header.otherAgentsBegun : words.header.otherAgents}>
            {otherAgents.map(({ id, name, harness }) => (
              <option key={id} value={id} disabled={begun}>
                {name} · {harnessLabels[harness]}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function YoloSwitch({ conversation }: { conversation: Conversation }) {
  return (
    <label
      className={`config yolo ${conversation.bypassPermissions ? "on" : ""}`}
      data-hint={hints.yolo}
    >
      <input
        type="checkbox"
        aria-label="YOLO"
        checked={conversation.bypassPermissions}
        onChange={(event) =>
          connection.send({ type: "conversation.set-bypass-permissions", conversationId: conversation.id, bypassPermissions: event.target.checked })
        }
      />
      YOLO
    </label>
  );
}

const FOLLOWS_PROFILE = "\u0000profile";

/** Each plugin's profile settings, chosen for this conversation over what its profile sets; a conversation a plugin's tool started has none. */
function PluginSettingMenus({ conversation, profiles }: { conversation: Conversation; profiles: Profile[] }) {
  const withProfileSettings = usePluginSettings().flatMap(({ plugin, profileSettings }) => (profileSettings ?? []).map((setting) => ({ plugin, setting })));
  if (conversation.startedBy) return null;
  const profile = profiles.find(({ id }) => id === conversation.profileId);
  return withProfileSettings.map(({ plugin, setting }) => {
    const choices = choicesOf(setting, profiles, conversation.profileId);
    const profilesValue = profileSettingValue(profile?.pluginSettings, plugin, setting);
    const profilesLabel = choices.find(({ value }) => value === profilesValue)?.label ?? words.header.none;
    const chosen = conversation.pluginSettings?.[plugin]?.[setting.id] ?? FOLLOWS_PROFILE;
    return (
      <label key={`${plugin}/${setting.id}`} className="config" data-hint={[setting.hint, hints.conversationPluginSetting].filter(Boolean).join("\n\n")}>
        <span>{setting.label}</span>
        <select
          aria-label={setting.label}
          value={chosen}
          onChange={(event) =>
            connection.send({
              type: "conversation.set-plugin-setting",
              conversationId: conversation.id,
              plugin,
              setting: setting.id,
              value: event.target.value === FOLLOWS_PROFILE ? null : event.target.value,
            })
          }
        >
          <option value={FOLLOWS_PROFILE}>{words.header.profilesChoice(profilesLabel)}</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  });
}

function QuestionsMenu({ conversation }: { conversation: Conversation }) {
  return (
    <label className="config" data-hint={hints.questions}>
      <span>{words.header.questions}</span>
      <select
        aria-label={words.header.questions}
        value={conversation.askMode}
        onChange={(event) => connection.send({ type: "conversation.set-ask-mode", conversationId: conversation.id, askMode: event.target.value as AskMode })}
      >
        {(Object.keys(words.askMode) as AskMode[]).map((mode) => (
          <option key={mode} value={mode}>
            {words.askMode[mode]}
          </option>
        ))}
      </select>
    </label>
  );
}

function profileNameOf(conversation: Conversation, profile: Profile | undefined) {
  if (profile) return profile.name;
  return conversation.profileId === null ? words.header.pickProfile : words.header.deletedProfile;
}

/** Whether this conversation's settings are open, and the two places that share it: the button in the bar and what opens under it. */
export function useConversationSettings() {
  const toggle = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const open = placement !== null;
  useClosing(open, [toggle, popover], () => setPlacement(null));
  return { toggle, popover, placement, flip: () => setPlacement(open || !toggle.current ? null : placedBelowOnItsSide(toggle.current)) };
}

type SettingsState = ReturnType<typeof useConversationSettings>;

/** Stands in for the profile and model where the bar has no room for them. */
function SettingsIcon() {
  return (
    <svg className="settings-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      <circle cx="5.5" cy="4.5" r="1.4" fill="var(--panel)" />
      <circle cx="10.5" cy="8" r="1.4" fill="var(--panel)" />
      <circle cx="6.5" cy="11.5" r="1.4" fill="var(--panel)" />
    </svg>
  );
}

/** The conversation's profile, its agent where the name doesn't say it, and its model: what opens its settings. */
export function ConversationSettingsToggle({ conversation, profiles, settings }: { conversation: Conversation; profiles: Profile[]; settings: SettingsState }) {
  const profile = profiles.find(({ id }) => id === conversation.profileId);
  const agent = agentBesideProfile(profile?.name ?? null, conversation.harness);
  const model = chosenModel(conversation.configOptions);
  const summary = [profileNameOf(conversation, profile), agent, model?.name].filter(Boolean).join(" · ");
  return (
    <button
      ref={settings.toggle}
      type="button"
      className={`conversation-settings-toggle ${settings.placement ? "on" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={settings.placement !== null}
      data-agent={harnessLabels[conversation.harness]}
      data-hint={`${summary}\n\n${hints.conversationSettings}`}
      onClick={settings.flip}
    >
      <ProfileDot profile={profile} />
      <SettingsIcon />
      <span className="settings-summary">
        <span className="settings-profile">{profileNameOf(conversation, profile)}</span>
        {agent && (
          <>
            {" · "}
            <span className="settings-agent">{agent}</span>
          </>
        )}
        {model && (
          <>
            {" · "}
            <span className="settings-model">{model.name}</span>
          </>
        )}
      </span>
      <span className="settings-caret" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

/** Settings of this conversation alone: its profile only gave them their first values. */
export function ConversationSettingsPopover({
  conversation,
  profiles,
  begun,
  settings,
}: {
  conversation: Conversation;
  profiles: Profile[];
  begun: boolean;
  settings: SettingsState;
}) {
  if (!settings.placement) return null;
  return (
    <div ref={settings.popover as RefObject<HTMLDivElement>} className="conversation-settings" role="dialog" aria-label={words.header.settingsTitle} style={settings.placement}>
      <h3>{words.header.settingsTitle}</h3>
      <p className="conversation-settings-note">{words.header.settingsNote}</p>
      <div className="controls">
        <ProfilePicker conversation={conversation} profiles={profiles} begun={begun} />
        {conversation.configOptions.map((option) => (
          <ConfigControl key={option.id} conversationId={conversation.id} option={option} />
        ))}
        <YoloSwitch conversation={conversation} />
        <PluginSettingMenus conversation={conversation} profiles={profiles} />
        <QuestionsMenu conversation={conversation} />
      </div>
    </div>
  );
}
