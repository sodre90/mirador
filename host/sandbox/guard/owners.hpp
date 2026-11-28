// Whose a guarded folder's files are: on disk, as the VM sees them, and to the agents, who see the owner's as theirs.
#pragma once

#include <sys/stat.h>
#include <sys/types.h>

namespace guard {

struct User {
  uid_t uid;
  gid_t gid;
};

const User NOBODY{65534, 65534};

template <typename Ids>
Ids shownAs(Ids onDisk, Ids owners, Ids agents, Ids nobody) {
  if (onDisk == owners) return agents;
  return onDisk == agents ? nobody : onDisk;
}

/**
 * Whose the folders' files are as the VM sees them, the owner's, as whom the guard reaches them, and the agents', who see
 * the owner's files as their own. Where the two differ, a file of the agents' own ids on disk, which is not the owner's
 * and which the guard can't write, is nobody's to them; where they are the same, nothing is shown otherwise.
 */
struct Owners {
  User owner;
  User agents;

  void showToAgents(struct stat& stats) const {
    stats.st_uid = shownAs(stats.st_uid, owner.uid, agents.uid, NOBODY.uid);
    stats.st_gid = shownAs(stats.st_gid, owner.gid, agents.gid, NOBODY.gid);
  }

  uid_t uidOnDisk(uid_t asked) const { return asked == agents.uid ? owner.uid : asked; }
  gid_t gidOnDisk(gid_t asked) const { return asked == agents.gid ? owner.gid : asked; }
};

}  // namespace guard
