// What the guard lets agents do to a name in a guarded folder, told from names alone: nothing that is there, or is put
// there meanwhile on the owner's computer or by another VM, changes what a name may be used for.
#pragma once

#include <utf8proc.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace guard {

/** The names a disk that ignores case, or the ways a letter can be written, takes for one, as one. */
inline std::string asDisksCompare(std::string_view name) {
  std::string folded(name);
  if (std::all_of(name.begin(), name.end(), [](unsigned char c) { return c < 0x80; })) {
    std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; });
    return folded;
  }
  utf8proc_uint8_t* mapped = nullptr;
  const auto options = static_cast<utf8proc_option_t>(UTF8PROC_STABLE | UTF8PROC_DECOMPOSE | UTF8PROC_CASEFOLD | UTF8PROC_IGNORE);
  const auto length = utf8proc_map(reinterpret_cast<const utf8proc_uint8_t*>(name.data()), static_cast<utf8proc_ssize_t>(name.size()), &mapped, options);
  if (length >= 0) folded.assign(reinterpret_cast<const char*>(mapped), static_cast<size_t>(length));
  std::free(mapped);
  return folded;
}

/** The paths Mirador names, under one folder: what is protected, the repository's git folders, and the folders on the way to them, which stay in place. */
struct Paths {
  /** Of two kinds a path is named as, it is the later one. */
  enum class Kind : uint8_t { OnTheWay, GitFolder, ProtectedFolder, ProtectedFile };
  Kind kind = Kind::OnTheWay;
  std::map<std::string, std::unique_ptr<Paths>> under;

  void add(std::string_view path, Kind as) {
    Paths* at = this;
    for (size_t start = 0; start <= path.size();) {
      const size_t end = std::min(path.find('/', start), path.size());
      const auto step = path.substr(start, end - start);
      if (!step.empty()) {
        auto& next = at->under[asDisksCompare(step)];
        if (!next) next = std::make_unique<Paths>();
        at = next.get();
      }
      start = end + 1;
    }
    at->kind = std::max(at->kind, as);
  }

  const Paths* named(const std::string& folded) const {
    const auto found = under.find(folded);
    return found == under.end() ? nullptr : found->second.get();
  }

  bool isProtected() const { return kind == Kind::ProtectedFile || kind == Kind::ProtectedFolder; }
};

/** What part of a guarded folder something is in: its own files; a git folder's entries, those of its `modules`, or anything else of git's; or what nothing in the VM changes. */
enum class Area : uint8_t { Tree, GitFolder, GitModules, GitsOwn, Protected };

inline bool isGits(Area area) { return area == Area::GitFolder || area == Area::GitModules || area == Area::GitsOwn; }

/** A folder of a guarded one, as the rules see it. */
struct Place {
  Area area = Area::Tree;
  /** What Mirador named below it; null where nothing. */
  const Paths* below = nullptr;
};

/** A name in a folder, as the rules see it. */
struct Named {
  /** What it is as a folder. */
  Place asFolder;
  /** What it is as anything else. */
  Area asFile = Area::Tree;
  /** It can't be moved, removed, linked to or put there. */
  bool fixed = false;
  /** It is fixed, but may be made as a folder: one on the way to a path Mirador named. */
  bool mayBeMadeAsFolder = false;
};

namespace names {

inline bool startsWith(std::string_view name, std::string_view start) { return name.substr(0, start.size()) == start; }

/** What of a git folder git runs programs from, or is led elsewhere by, with the locks git writes its config through. */
inline bool isProtectedInGitFolder(std::string_view folded) {
  return startsWith(folded, "config") || folded == "hooks" || folded == "worktrees" || folded == "commondir" || folded == "gitdir";
}

inline bool isLetter(unsigned char c) { return (c >= 'a' && c <= 'z') || c >= 0x80; }

inline bool isLetterOrDigit(unsigned char c) { return isLetter(c) || (c >= '0' && c <= '9'); }

/** A protected file's name with more around it, as an editor's temporary file has, which it then renames over the file: `.CLAUDE.md.swp`, `CLAUDE.md.tmp.12`, `#CLAUDE.md#`. */
inline bool isMadeOf(const std::string& folded, const std::string& protectedName) {
  const size_t at = folded.find(protectedName);
  if (at == std::string::npos || std::any_of(folded.begin(), folded.begin() + static_cast<std::ptrdiff_t>(at), isLetter)) return false;
  const size_t after = at + protectedName.size();
  return after == folded.size() || !isLetterOrDigit(static_cast<unsigned char>(folded[after]));
}

inline bool isMadeOfAProtectedName(const Paths& here, const std::string& folded) {
  return std::any_of(here.under.begin(), here.under.end(), [&](const auto& entry) {
    return entry.second->kind == Paths::Kind::ProtectedFile && isMadeOf(folded, entry.first);
  });
}

}  // namespace names

inline Named protectedName() { return {{Area::Protected, nullptr}, Area::Protected, true, false}; }

inline Named nameIn(const Place& folder, std::string_view name) {
  const auto folded = asDisksCompare(name);
  if (folder.area == Area::Protected) return protectedName();
  const Paths* below = folder.below ? folder.below->named(folded) : nullptr;
  if (below && below->isProtected()) return protectedName();
  if (folder.below && names::isMadeOfAProtectedName(*folder.below, folded)) return protectedName();
  const bool isGitFolder = folded == ".git" || (below && below->kind == Paths::Kind::GitFolder);
  switch (folder.area) {
    case Area::Tree:
      if (isGitFolder) return {{Area::GitFolder, below}, Area::Protected, true, false};
      if (below) return {{Area::Tree, below}, Area::Protected, true, true};
      return {};
    case Area::GitFolder:
      if (folded == ".git" || names::isProtectedInGitFolder(folded)) return protectedName();
      if (folded == "modules") return {{Area::GitModules, below}, Area::Protected, true, false};
      if (below) return {{Area::GitsOwn, below}, Area::Protected, true, true};
      return {{Area::GitsOwn, nullptr}, Area::GitsOwn, false, false};
    case Area::GitModules:
      if (folded != ".git" && isGitFolder) return {{Area::GitFolder, below}, Area::Protected, true, false};
      if (folded != ".git" && below) return {{Area::GitModules, below}, Area::Protected, true, false};
      return protectedName();
    case Area::GitsOwn:
      if (folded == ".git") return protectedName();
      if (below) return {{Area::GitsOwn, below}, Area::Protected, true, true};
      return {{Area::GitsOwn, nullptr}, Area::GitsOwn, false, false};
    case Area::Protected:
      break;
  }
  return protectedName();
}

/** What is made under a name. */
enum class Making : uint8_t { Folder, File, Link, Special };

/** Whether the name may be made in the folder. */
inline bool mayMake(const Place& folder, std::string_view name, Making what) {
  const auto named = nameIn(folder, name);
  if (named.fixed) return named.mayBeMadeAsFolder && what == Making::Folder;
  return !isGits(folder.area) || what == Making::Folder || what == Making::File;
}

/** Whether the name may be removed from the folder, moved away, linked elsewhere, or have something moved or linked in its place. */
inline bool isFree(const Place& folder, std::string_view name) { return !nameIn(folder, name).fixed; }

/** What is moved or linked stays in its area: no link or folder made in one is put in another, where other names are protected. */
inline bool sameArea(const Place& from, const Place& to) { return from.area == to.area; }

}  // namespace guard
