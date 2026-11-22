import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk/unstable";
import { useEffect, useState } from "react";
import { categoryChoices } from "../shared/config-options.ts";
import type { Conversation, Profile } from "../shared/model.ts";
import type { RoomAgentModel } from "../shared/rooms.ts";
import { connection } from "./connection.ts";
import { chosenLabelCutShort, useCutShort } from "./cut-short.tsx";
import { t } from "./i18n/index.ts";
import { useSentChoice } from "./sent-choice.ts";
import { NAME_FIELD_ATTRIBUTES } from "./typing-aids.ts";

const words = t.rooms;

/** Asking a profile's agent what it offers starts the agent, so each profile is asked once a page, until it answers. */
const offeredByProfile = new Map<string, Promise<SessionConfigOption[] | null>>();
const answeredByProfile = new Map<string, SessionConfigOption[]>();

/** What a profile's agent offered when this page last asked it, without asking it again; none while it hasn't been asked. */
export const offeredAlready = (profileId: string) => answeredByProfile.get(profileId) ?? [];

function offeredBy(profileId: string) {
  const asked =
    offeredByProfile.get(profileId) ??
    connection
      .sendAndAwait(
        (requestId) => ({ type: "profile.choices.get", requestId, profileId }),
        (message, requestId) => (message.type === "profile.choices.got" && message.requestId === requestId ? message.configOptions : undefined),
      )
      .catch(() => null);
  offeredByProfile.set(profileId, asked);
  void asked.then((options) => {
    if (options) answeredByProfile.set(profileId, options);
    else offeredByProfile.delete(profileId);
  });
  return asked;
}

export interface ModelChoices {
  models: SessionConfigSelectOption[];
  efforts: SessionConfigSelectOption[];
  /** The agent's session lists no model to change, though its agent offers some, so a choice waits for its next session. */
  takesModelNextSession: boolean;
}

/** What a room's agent can be set to: as its conversation in the room lists it, else as its profile's agent offers when asked. */
export function useModelChoices(profileId: string | null, conversation: Conversation | undefined): ModelChoices {
  const live = conversation?.configOptions ?? [];
  const [offered, setOffered] = useState<SessionConfigOption[] | null>(null);
  const asks = profileId !== null && categoryChoices(live, "model").length === 0;
  useEffect(() => {
    if (!profileId || !asks) return;
    let wanted = true;
    void offeredBy(profileId).then((options) => wanted && setOffered(options));
    return () => {
      wanted = false;
    };
  }, [profileId, asks]);
  const options = asks ? (offered ?? []) : live;
  const models = categoryChoices(options, "model");
  return { models, efforts: categoryChoices(options, "thought_level"), takesModelNextSession: conversation !== undefined && asks && models.length > 0 };
}

const currentOf = (options: SessionConfigOption[], category: "model" | "thought_level") =>
  options.find((option) => option.category === category && option.type === "select")?.currentValue?.toString() ?? null;

const nameOf = (choices: SessionConfigSelectOption[], value: string | null | undefined) => (value ? (choices.find((choice) => choice.value === value)?.name ?? value) : null);

/**
 * One of the agent's choices, or while none is chosen in the room, what it runs on as its profile says: its
 * conversation's current choice, else its profile's, by name, whole in a hint where the select cuts it short. Once
 * chosen, only the agent's own choices are offered.
 */
function ChoiceSelect({ label, choices, shown, current, onChange }: { label: string; choices: SessionConfigSelectOption[]; shown: string | null; current: string | null; onChange: (value: string) => void }) {
  const unlisted = shown !== null && !choices.some(({ value }) => value === shown);
  const shownName = nameOf(choices, shown) ?? nameOf(choices, current) ?? words.asItsProfile;
  const [select, cutShort] = useCutShort<HTMLSelectElement>(chosenLabelCutShort, shownName);
  return (
    <select
      ref={select}
      className="room-agent-choice-select"
      aria-label={label}
      data-hint={cutShort ? shownName : undefined}
      value={shown ?? ""}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
    >
      {shown === null && <option value="">{shownName}</option>}
      {choices.map(({ value, name }) => (
        <option key={value} value={value}>
          {name}
        </option>
      ))}
      {unlisted && <option value={shown}>{shown}</option>}
    </select>
  );
}

/**
 * The model a room's agent runs on and its effort, shown quietly and changed in place; nothing while its agent offers
 * none. Each pick goes with the other as last picked, so a pick made before the host kept the one before never undoes it.
 */
export function ModelChoice({
  agentName,
  profile,
  conversation,
  chosen,
  onChange,
}: {
  agentName: string;
  profile: Profile | undefined;
  conversation: Conversation | undefined;
  chosen: RoomAgentModel;
  onChange: (model: RoomAgentModel) => void;
}) {
  const { models, efforts, takesModelNextSession } = useModelChoices(profile?.id ?? null, conversation);
  const [model, pickModel] = useSentChoice(chosen.model, (picked) => onChange({ model: picked, effort }));
  const [effort, pickEffort] = useSentChoice(chosen.effort, (picked) => onChange({ model, effort: picked }));
  if (!profile || models.length === 0) return null;
  const live = conversation?.configOptions ?? [];
  return (
    <>
      <ChoiceSelect label={words.modelOf(agentName)} choices={models} shown={model} current={currentOf(live, "model") ?? profile.model} onChange={pickModel} />
      {efforts.length > 0 && <ChoiceSelect label={words.effortOf(agentName)} choices={efforts} shown={effort} current={currentOf(live, "thought_level") ?? profile.effort} onChange={pickEffort} />}
      {takesModelNextSession && model !== null && <span className="hint room-model-next-session">{words.modelFromNextSession}</span>}
    </>
  );
}

/** A box to find an agent by name: typing filters the profiles not yet chosen, Enter or a click adds one and closes the list. */
export function AgentSearch({ profiles, chosenIds, label, onAdd }: { profiles: Profile[]; chosenIds: string[]; label: string; onAdd: (profileId: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wanted = query.trim().toLowerCase();
  const matches = profiles.filter(({ id, name }) => !chosenIds.includes(id) && name.toLowerCase().includes(wanted));
  const add = (profileId: string) => {
    onAdd(profileId);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="agent-search">
      <input
        {...NAME_FIELD_ATTRIBUTES}
        role="combobox"
        aria-label={label}
        aria-expanded={open && matches.length > 0}
        aria-controls="agent-search-matches"
        placeholder={words.findAgentPlaceholder}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (wanted && matches[0]) add(matches[0].id);
        }}
      />
      {open && matches.length > 0 && (
        <ul id="agent-search-matches" role="listbox" aria-label={label}>
          {matches.map((profile, index) => (
            <li
              key={profile.id}
              role="option"
              aria-selected={wanted !== "" && index === 0}
              onMouseDown={(event) => {
                event.preventDefault();
                add(profile.id);
              }}
            >
              {profile.name}
            </li>
          ))}
        </ul>
      )}
      {wanted !== "" && matches.length === 0 && <span className="hint">{words.noAgentFound}</span>}
    </div>
  );
}
