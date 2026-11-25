// What the guard would do for agents at each path read, a line each: "<root> <path>" in, what may be done there out.
#include <iostream>
#include <sstream>

#include "../../host/sandbox/guard/manifest.hpp"

using namespace guard;

void answerAll(const char* manifest) {
  const auto roots = readManifest(manifest);
  for (const auto& root : roots) std::cout << root.raw << " as " << root.target << "\n";
  size_t root = 0;
  for (std::string path; std::cin >> root >> std::ws && std::getline(std::cin, path);) {
    Place folder{Area::Tree, roots.at(root).paths.get()};
    std::istringstream steps(path);
    std::string name;
    std::getline(steps, name, '/');
    for (std::string next; std::getline(steps, next, '/'); name = next) folder = nameIn(folder, name).asFolder;
    const Named named = nameIn(folder, name);
    std::cout << path << ":";
    if (named.asFile != Area::Protected) std::cout << " change";
    if (isFree(folder, name)) std::cout << " move";
    if (mayMake(folder, name, Making::File)) std::cout << " make-file";
    if (mayMake(folder, name, Making::Folder)) std::cout << " make-folder";
    if (mayMake(folder, name, Making::Link)) std::cout << " make-link";
    std::cout << "\n";
  }
}

int main(int, char** argv) {
  try {
    answerAll(argv[1]);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
