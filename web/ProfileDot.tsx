import type { Profile } from "../shared/model.ts";
import { profileColorVariable } from "./pastels.ts";

function ProfileMark({ profile, className }: { profile: Profile | undefined; className: string }) {
  if (!profile?.color) return null;
  return <span className={className} data-color={profile.color} aria-hidden="true" style={profileColorVariable(profile.color)} />;
}

/** Goes before the profile's name, so a workspace or conversation on the wrong profile stands out. */
export const ProfileDot = ({ profile }: { profile: Profile | undefined }) => <ProfileMark profile={profile} className="profile-dot" />;

/** A short bar inside the left edge of a conversation's row. */
export const ProfileEdge = ({ profile }: { profile: Profile | undefined }) => <ProfileMark profile={profile} className="profile-edge" />;
