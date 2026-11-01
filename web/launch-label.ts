import { harnessLabels, type Launch, type Profile } from "../shared/model.ts";
import { t } from "./i18n/index.ts";

/** A profile's name, then its agent's unless the name already is it. */
export function launchLabel(launch: Launch, profiles: Profile[]): string {
  const profile = profiles.find(({ id }) => id === launch.profileId);
  if (!profile) return t.labels.noProfile;
  const agent = harnessLabels[profile.harness];
  return profile.name === agent ? agent : `${profile.name} · ${agent}`;
}
