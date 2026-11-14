import { useEffect, useId, useState } from "react";
import type { Profile } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { isOn, needsSetup, opens, summaryOf, type PluginRow } from "./plugin-rows.ts";
import { usePluginRows } from "./ProfilePluginsTab.tsx";
import { ProfileDot } from "./ProfileDot.tsx";

const words = t.plugins;
const tabWords = t.profiles.pluginsTab;

const pluginsOf = (profile: Profile) => ({ pluginSettings: profile.pluginSettings ?? {}, pluginsOff: profile.pluginsOff, environment: profile.environment });

function PluginProfileRow({ row, profile, profiles, onOpenProfile }: { row: PluginRow; profile: Profile; profiles: Profile[]; onOpenProfile: () => void }) {
  const summaryId = useId();
  const plugins = pluginsOf(profile);
  const on = isOn(row, plugins);
  const [turnedTo, setTurnedTo] = useState<boolean | null>(null);
  useEffect(() => setTurnedTo(null), [profile]);
  const turn = (turnedOn: boolean) => {
    if (connection.send({ type: "profile.turn-plugin", profileId: profile.id, plugin: row.plugin, on: turnedOn })) setTurnedTo(turnedOn);
  };
  return (
    <li className={`plugin-profile${on ? " on" : ""}`}>
      <ProfileDot profile={profile} />
      <span className="plugin-text">
        <span className="plugin-row-name">
          <span className="plugin-row-title">{profile.name}</span>
          {needsSetup(row, plugins) && <span className="plugin-pill missing">{tabWords.needsSetup}</span>}
        </span>
        <span className="plugin-summary" id={summaryId}>
          {summaryOf(row, plugins, profiles)}
        </span>
      </span>
      {opens(row) && (
        <button type="button" aria-label={words.profileSettingsOf(profile.name)} aria-describedby={summaryId} onClick={onOpenProfile}>
          {words.profileSettings}
        </button>
      )}
      {row.switchable && (
        <label className="plugin-switch">
          <input type="checkbox" role="switch" aria-label={words.useIn(row.title, profile.name)} aria-describedby={summaryId} checked={turnedTo ?? on} onChange={(event) => turn(event.target.checked)} />
          <span className="plugin-switch-track" aria-hidden="true" />
        </label>
      )}
    </li>
  );
}

const introOf = (row: PluginRow) => [row.switchable ? words.profilesSwitchIntro : words.profilesHoldIntro, ...(opens(row) ? [words.profilesSettingsIntro] : [])].join(" ");

/** A plugin across every profile: each profile's switch for it, which saves that profile at once, and what the profile holds for it. */
export function PluginProfiles({ plugin, profiles, onOpenProfile }: { plugin: string; profiles: Profile[]; onOpenProfile: (profileId: string, plugin: string) => void }) {
  const headingId = useId();
  const row = usePluginRows().find((each) => each.plugin === plugin);
  if (!row || profiles.length === 0) return null;
  return (
    <section className="plugin-profiles" aria-labelledby={headingId}>
      <h3 id={headingId}>{words.profilesHeading}</h3>
      <p className="hint">{introOf(row)}</p>
      <ul>
        {profiles.map((profile) => (
          <PluginProfileRow key={profile.id} row={row} profile={profile} profiles={profiles} onOpenProfile={() => onOpenProfile(profile.id, plugin)} />
        ))}
      </ul>
    </section>
  );
}
