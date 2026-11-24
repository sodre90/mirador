import { isDeepStrictEqual } from "node:util";
import { harnessLabels, type Profile } from "../../shared/model.ts";
import { assignmentLine, commandLineOf, parseEnvironment, type ProfileEnvironment } from "../../shared/profile-environment.ts";
import type { ProfileDraft } from "../../shared/protocol.ts";
import type { FileEnvironmentValue, FilePluginSettingValue, FileProfile, FileProfileReference } from "../../shared/settings-file.ts";
import { profileReferredTo, referredName, type ImportContext, type ImportStep } from "./import-step.ts";
import { isNeedsValue } from "./read-settings-file.ts";

const comparedFields = ["model", "mode", "effort", "bypassPermissions", "askMode", "idleCompaction", "color", "prelaunch", "environment", "pluginSettings", "pluginsOff"] as const;
type ComparedField = (typeof comparedFields)[number];

/** A profile is the one here of its name and agent, as an agent is fixed once a profile is made. */
export function profileSteps(entries: FileProfile[], context: ImportContext, save: (draft: ProfileDraft) => Profile): ImportStep[] {
  const here = context.store.listProfiles();
  const isOf = (entry: FileProfile) => (profile: Profile) => profile.name === entry.name && profile.harness === entry.harness;
  return entries.flatMap((entry) => {
    const existing = here.find(isOf(entry));
    const onOtherAgent = here.find((profile) => profile.name === entry.name && !entries.some((other) => isOf(other)(profile)));
    if (!existing && onOtherAgent) {
      context.problems.push({ code: "settings-profile-other-agent", profile: entry.name, agent: harnessLabels[onOtherAgent.harness], fileAgent: harnessLabels[entry.harness] });
      return [];
    }
    return [profileStep(entry, existing, context, save)];
  });
}

function profileStep(entry: FileProfile, existing: Profile | undefined, { store, problems }: ImportContext, save: (draft: ProfileDraft) => Profile): ImportStep {
  const planned = draftOf(entry, existing, (reference) => profileReferredTo(store, reference));
  planned.unwritable.forEach((variable) => problems.push({ code: "settings-value-not-writable", profile: entry.name, variable }));
  const differs: ComparedField[] = existing
    ? comparedFields.filter((field) => !isDeepStrictEqual(comparable(planned.draft, field), comparable(existing, field)) || (field === "pluginSettings" && planned.missingProfiles.length > 0))
    : [];
  let savedId = existing?.id;
  const saveAsNow = () => {
    const now = savedId === undefined ? undefined : store.findProfile(savedId);
    const { draft, missingProfiles } = draftOf(entry, now, (reference) => profileReferredTo(store, reference));
    savedId = save(draft).id;
    return missingProfiles;
  };
  return {
    item: {
      id: `profile ${entry.harness} ${entry.name}`,
      kind: "profile",
      name: entry.name,
      state: !existing ? "new" : differs.length > 0 ? "different" : "same",
      differs,
      needs: planned.needs,
    },
    bringIn: () => void saveAsNow(),
    ...(planned.missingProfiles.length > 0 && {
      finish: () => saveAsNow().forEach((reference) => problems.push({ code: "settings-profile-missing", neededBy: entry.name, profile: referredName(reference) })),
    }),
  };
}

function comparable(profile: Profile | ProfileDraft, field: ComparedField) {
  if (field === "idleCompaction") return profile.idleCompaction ?? true;
  if (field === "pluginSettings") return profile.pluginSettings ?? {};
  if (field === "pluginsOff") return [...profile.pluginsOff].sort();
  return profile[field] || null;
}

interface FilledIn {
  draft: ProfileDraft;
  /** The variables and settings the file leaves out that the profile here doesn't have either. */
  needs: string[];
  /** The variables whose value no line of an environment can hold. */
  unwritable: string[];
  missingProfiles: FileProfileReference[];
}

type ProfileFinder = (reference: FileProfileReference) => Profile | undefined;

/** Null is a choice too, such as the agent's own model. */
const inFileOrHere = <Value>(inFile: Value | undefined, here: Value | undefined, fallback: Value): Value => (inFile !== undefined ? inFile : here !== undefined ? here : fallback);

function draftOf(entry: FileProfile, existing: Profile | undefined, find: ProfileFinder): FilledIn {
  const environment = entry.environment ? environmentFrom(entry.environment, existing?.environment) : { text: existing?.environment ?? "", needs: [], unwritable: [] };
  const plugins = pluginSettingsFrom(entry.pluginSettings ?? {}, existing?.pluginSettings ?? {}, find);
  return {
    draft: {
      id: existing?.id,
      name: entry.name,
      harness: entry.harness,
      model: inFileOrHere(entry.model, existing?.model, null),
      mode: inFileOrHere(entry.mode, existing?.mode, null),
      effort: inFileOrHere(entry.effort, existing?.effort, null),
      bypassPermissions: inFileOrHere(entry.bypassPermissions, existing?.bypassPermissions, false),
      askMode: inFileOrHere(entry.askMode, existing?.askMode, "wait"),
      idleCompaction: inFileOrHere(entry.idleCompaction, existing?.idleCompaction, true),
      color: inFileOrHere(entry.color, existing?.color, null),
      prelaunch: inFileOrHere(entry.prelaunch, existing?.prelaunch, ""),
      environment: environment.text,
      ...(Object.keys(plugins.settings).length > 0 && { pluginSettings: plugins.settings }),
      pluginsOff: inFileOrHere(entry.pluginsOff, existing?.pluginsOff, []),
    },
    needs: [...environment.needs, ...plugins.needs],
    unwritable: environment.unwritable,
    missingProfiles: plugins.missingProfiles,
  };
}

/** The environment as the file has it, with what it leaves out as it is here; text that means the same stays as it is, its comments with it. */
function environmentFrom(entries: Record<string, FileEnvironmentValue>, hereText: string | undefined) {
  const here = parseEnvironment(hereText ?? "");
  const lines = Object.entries(entries).map(([name, value]) => ({ name, ...lineOf(name, value, here) }));
  const text = lines.map(({ name, line }) => line ?? `# ${name}= needs a value`).join("\n");
  return {
    text: hereText !== undefined && meansTheSame(parseEnvironment(text), here) ? hereText : text,
    needs: lines.filter(({ line }) => line === null).map(({ name }) => name),
    unwritable: lines.filter(({ line, leftOut }) => line === null && !leftOut).map(({ name }) => name),
  };
}

function lineOf(name: string, value: FileEnvironmentValue, here: ProfileEnvironment): { line: string | null; leftOut: boolean } {
  if (typeof value === "string") return { line: assignmentLine(name, value), leftOut: false };
  if ("command" in value) return { line: commandLineOf(name, value.command), leftOut: false };
  if ("unset" in value) return { line: `-u ${name}`, leftOut: false };
  if (name in here.set) return { line: assignmentLine(name, here.set[name]!), leftOut: true };
  return { line: name in here.commands ? commandLineOf(name, here.commands[name]!) : null, leftOut: true };
}

const meaningOf = ({ set, commands, unset }: ProfileEnvironment) => ({ set, commands, unset: [...new Set(unset)].sort() });
const meansTheSame = (one: ProfileEnvironment, other: ProfileEnvironment) => isDeepStrictEqual(meaningOf(one), meaningOf(other));

/** The settings here with the file's over them, so those of plugins the file doesn't name stay. */
function pluginSettingsFrom(entries: Record<string, Record<string, FilePluginSettingValue>>, here: Record<string, Record<string, string>>, find: ProfileFinder) {
  const missingProfiles: FileProfileReference[] = [];
  const needs: string[] = [];
  const valueOf = (plugin: string, id: string, value: FilePluginSettingValue): string | undefined => {
    const valueHere = here[plugin]?.[id];
    if (typeof value === "string") return value;
    if (isNeedsValue(value)) {
      if (!valueHere) needs.push(`${plugin}: ${id}`);
      return valueHere;
    }
    const profile = find(value.profile);
    if (!profile) missingProfiles.push(value.profile);
    return profile?.id ?? valueHere;
  };
  const merged = Object.entries(entries).flatMap(([plugin, values]) => {
    const known = Object.entries(values).flatMap(([id, value]) => {
      const filled = valueOf(plugin, id, value);
      return filled === undefined ? [] : [[id, filled]];
    });
    return known.length === 0 ? [] : [[plugin, { ...here[plugin], ...Object.fromEntries(known) }]];
  });
  return { settings: { ...here, ...Object.fromEntries(merged) } as Record<string, Record<string, string>>, needs, missingProfiles };
}
