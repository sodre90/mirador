// How the guard shows a file's ids to agents, and which ids a chown of theirs gives it on disk: "<owner> <agents>" as
// uid:gid in the arguments, then a line each of "<uid>:<gid>" in, "<shown> <on disk when asked for>" out.
#include <iostream>
#include <string>

#include "../../host/sandbox/guard/owners.hpp"

using guard::Owners;
using guard::User;

User userIn(const std::string& given) {
  const auto colon = given.find(':');
  return {static_cast<uid_t>(std::stoul(given.substr(0, colon))), static_cast<gid_t>(std::stoul(given.substr(colon + 1)))};
}

int main(int, char** argv) {
  const Owners owners{userIn(argv[1]), userIn(argv[2])};
  for (std::string line; std::getline(std::cin, line);) {
    const User ids = userIn(line);
    struct stat stats {};
    stats.st_uid = ids.uid;
    stats.st_gid = ids.gid;
    owners.showToAgents(stats);
    std::cout << stats.st_uid << ":" << stats.st_gid << " " << owners.uidOnDisk(ids.uid) << ":" << owners.gidOnDisk(ids.gid) << "\n";
  }
}
