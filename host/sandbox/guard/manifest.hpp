// What the guard is told to guard: NUL-ended fields, the first letter saying what each is. R the folder as it is mounted,
// T the path agents see it at, then, from that folder with /, F and D the files and folders that are protected, W the
// folders that stay in place, as git's way to a file passes them, and G the repository's git folders.
#pragma once

#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

#include "rules.hpp"

namespace guard {

struct Root {
  std::string raw;
  std::string target;
  std::unique_ptr<Paths> paths = std::make_unique<Paths>();
};

inline std::vector<Root> rootsIn(const std::string& manifest) {
  std::vector<Root> roots;
  for (size_t start = 0; start < manifest.size();) {
    const size_t end = manifest.find('\0', start);
    if (end == std::string::npos || end == start) throw std::runtime_error("the manifest is cut short");
    const char kind = manifest[start];
    const auto value = manifest.substr(start + 1, end - start - 1);
    start = end + 1;
    if (kind == 'R') {
      roots.emplace_back().raw = value;
      continue;
    }
    if (roots.empty()) throw std::runtime_error("the manifest begins with no folder");
    auto& root = roots.back();
    if (kind == 'T') root.target = value;
    else if (kind == 'F') root.paths->add(value, Paths::Kind::ProtectedFile);
    else if (kind == 'D') root.paths->add(value, Paths::Kind::ProtectedFolder);
    else if (kind == 'W') root.paths->add(value, Paths::Kind::OnTheWay);
    else if (kind == 'G') root.paths->add(value, Paths::Kind::GitFolder);
    else throw std::runtime_error(std::string("the manifest has a field of no known kind: ") + kind);
  }
  for (const auto& root : roots)
    if (root.raw.empty() || root.target.empty() || root.raw[0] != '/' || root.target[0] != '/') throw std::runtime_error("the manifest names a folder by no whole path");
  return roots;
}

inline std::vector<Root> readManifest(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) throw std::runtime_error("no manifest at " + path);
  return rootsIn(std::string(std::istreambuf_iterator<char>(file), {}));
}

}  // namespace guard
