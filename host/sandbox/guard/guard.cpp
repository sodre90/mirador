// The guard of a sandbox's folders: the only way its agents reach them. Each folder Mirador mounts read and write lies
// under a place only root enters, and is shown at its own path through here, where a write is refused by name
// (rules.hpp), whatever is replaced on the owner's computer meanwhile. Everything else goes on to the folder as the
// agents' user. usage: mirador-guard <manifest> <uid>:<gid> <sockets folder> -- <command>...
// Opens the sockets to the agents' user, runs the command as nobody once each folder is guarded, and ends when it does,
// or when a folder is no longer guarded. `mirador-guard as <uid>:<gid> -- <command>...` runs a command as that user
// alone. It is linked statically and called by its whole path, so nothing of the VM's image runs as root.
#define FUSE_USE_VERSION 312

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <fuse_lowlevel.h>
#include <grp.h>
#include <linux/capability.h>
#include <linux/fs.h>
#include <sys/file.h>
#include <sys/fsuid.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "manifest.hpp"

namespace {

using guard::Area;
using guard::Making;
using guard::Named;
using guard::Paths;
using guard::Place;

/** How long the kernel takes what it was told of a name or a file as still so: the owner's own changes show within it. */
constexpr double KEPT_FOR_S = 1.0;

constexpr int REFUSED = EROFS;

class Descriptor {
 public:
  explicit Descriptor(int fd = -1) : fd_(fd) {}
  Descriptor(Descriptor&& other) noexcept : fd_(other.release()) {}
  Descriptor& operator=(Descriptor&& other) noexcept {
    std::swap(fd_, other.fd_);
    return *this;
  }
  ~Descriptor() {
    if (fd_ >= 0) close(fd_);
  }
  int get() const { return fd_; }
  int release() { return std::exchange(fd_, -1); }
  explicit operator bool() const { return fd_ >= 0; }

 private:
  int fd_;
};

struct Id {
  dev_t device;
  ino_t inode;
  bool operator==(const Id& other) const { return device == other.device && inode == other.inode; }
};

struct IdHash {
  size_t operator()(const Id& id) const { return std::hash<ino_t>()(id.inode) ^ (std::hash<dev_t>()(id.device) << 1); }
};

Id idOf(const struct stat& stats) { return {stats.st_dev, stats.st_ino}; }

using Shared = std::shared_ptr<const Descriptor>;

/**
 * A file or folder the kernel knows of. Kept open, so that its number can't come to be another's: a folder, a protected
 * file, and any file the agents have open. Another file is reached through the folder it was last found in, where it
 * counts only as long as it is the same file: keeping every file open would use up those the computer can have open.
 */
class Node {
 public:
  explicit Node(const Id& id) : id(id) {}

  const Id id;
  uint64_t lookups = 0;

  Place place() const { return {area_.load(), below_.load()}; }
  Area area() const { return area_.load(); }
  bool isProtected() const { return area() == Area::Protected; }

  /** As it was found under a name now; once found under a protected one, protected for good. */
  void foundAs(const Place& place) {
    if (isProtected()) return;
    below_ = place.below;
    area_ = place.area;
  }

  void keep(Shared at) {
    const std::lock_guard held(mutex_);
    if (!kept_) kept_ = std::move(at);
    onlyWhileOpened_ = false;
  }

  void foundIn(Shared folder, const char* name) {
    const std::lock_guard held(mutex_);
    folder_ = std::move(folder);
    name_ = name;
  }

  /** A descriptor of it and of nothing that took its place; none, errno saying why, where it is not where it was found. */
  Shared reached() {
    const std::lock_guard held(mutex_);
    if (kept_) return kept_;
    auto found = std::make_shared<const Descriptor>(openat(folder_->get(), name_.c_str(), O_PATH | O_NOFOLLOW | O_CLOEXEC));
    struct stat stats {};
    if (*found && fstatat(found->get(), "", &stats, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) == 0 && idOf(stats) == id) return found;
    if (*found || errno == ENOENT || errno == ENOTDIR) errno = ESTALE;
    return nullptr;
  }

  int attributes(struct stat& stats) {
    const std::lock_guard held(mutex_);
    const bool there = kept_ ? fstatat(kept_->get(), "", &stats, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) == 0 : fstatat(folder_->get(), name_.c_str(), &stats, AT_SYMLINK_NOFOLLOW) == 0;
    if (there && idOf(stats) == id) return 0;
    return there || errno == ENOENT || errno == ENOTDIR ? ESTALE : errno;
  }

  void opened(Shared at) {
    const std::lock_guard held(mutex_);
    opens_ += 1;
    if (kept_) return;
    kept_ = std::move(at);
    onlyWhileOpened_ = true;
  }

  void closed() {
    const std::lock_guard held(mutex_);
    opens_ -= 1;
    if (opens_ == 0 && onlyWhileOpened_) kept_.reset();
  }

 private:
  std::atomic<Area> area_{Area::Tree};
  std::atomic<const Paths*> below_{nullptr};
  std::mutex mutex_;
  Shared kept_;
  Shared folder_;
  std::string name_;
  unsigned opens_ = 0;
  bool onlyWhileOpened_ = true;
};

class GuardedFolder {
 public:
  GuardedFolder(const std::string& raw, const Paths& paths) {
    auto fd = std::make_shared<const Descriptor>(open(raw.c_str(), O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
    struct stat stats {};
    if (!*fd || fstat(fd->get(), &stats) != 0) throw std::runtime_error("no folder at " + raw + ": " + std::strerror(errno));
    top_ = std::make_unique<Node>(idOf(stats));
    top_->keep(std::move(fd));
    top_->foundAs({Area::Tree, &paths});
  }

  Node& node(fuse_ino_t ino) { return ino == FUSE_ROOT_ID ? *top_ : *reinterpret_cast<Node*>(ino); }

  /** What stands at a name of a folder, the kernel knowing of it once more; an errno where nothing does. */
  int lookUp(Node& parent, const char* name, fuse_entry_param& entry) {
    entry = {};
    const auto folder = parent.reached();
    if (!folder || fstatat(folder->get(), name, &entry.attr, AT_SYMLINK_NOFOLLOW) != 0) return errno;
    const Named named = guard::nameIn(parent.place(), name);
    const bool isFolder = S_ISDIR(entry.attr.st_mode);
    const Place place = isFolder ? named.asFolder : Place{named.asFile, nullptr};
    Shared kept;
    if (isFolder || place.area == Area::Protected) {
      kept = std::make_shared<const Descriptor>(openat(folder->get(), name, O_PATH | O_NOFOLLOW | O_CLOEXEC));
      if (!*kept || fstatat(kept->get(), "", &entry.attr, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) != 0) return errno;
      if (S_ISDIR(entry.attr.st_mode) != isFolder) return ESTALE;
    }
    const Id id = idOf(entry.attr);
    const std::lock_guard held(mutex_);
    if (id == top_->id) return ELOOP;
    auto& known = nodes_[id];
    if (!known) known = std::make_unique<Node>(id);
    if (kept) known->keep(std::move(kept));
    known->foundAs(place);
    known->foundIn(folder, name);
    known->lookups += 1;
    entry.ino = reinterpret_cast<fuse_ino_t>(known.get());
    entry.attr_timeout = entry.entry_timeout = KEPT_FOR_S;
    return 0;
  }

  /** What the agents moved is found where it now is. */
  void moved(Node& to, const char* name) {
    struct stat stats {};
    const auto folder = to.reached();
    if (!folder || fstatat(folder->get(), name, &stats, AT_SYMLINK_NOFOLLOW) != 0) return;
    const std::lock_guard held(mutex_);
    const auto known = nodes_.find(idOf(stats));
    if (known != nodes_.end()) known->second->foundIn(folder, name);
  }

  void forget(fuse_ino_t ino, uint64_t lookups) {
    if (ino == FUSE_ROOT_ID) return;
    const std::lock_guard held(mutex_);
    Node& node = this->node(ino);
    node.lookups -= std::min(lookups, node.lookups);
    if (node.lookups == 0) nodes_.erase(node.id);
  }

 private:
  std::unique_ptr<Node> top_;
  std::mutex mutex_;
  std::unordered_map<Id, std::unique_ptr<Node>, IdHash> nodes_;
};

struct OpenFolder {
  DIR* entries = nullptr;
  off_t at = 0;
  dirent* unread = nullptr;
  ~OpenFolder() {
    if (entries) closedir(entries);
  }
};

void answer(fuse_req_t req, int error) { fuse_reply_err(req, error); }

GuardedFolder& folderOf(fuse_req_t req) { return *static_cast<GuardedFolder*>(fuse_req_userdata(req)); }

Node& nodeOf(fuse_req_t req, fuse_ino_t ino) { return folderOf(req).node(ino); }

/** The path of an open descriptor, which opens the file it is of and no other, whatever its name leads to now. */
std::string pathOf(int fd) { return "/proc/self/fd/" + std::to_string(fd); }

/** The node opened as asked, kept while it is; -1, errno saying why, where it can't be. */
int openedAs(Node& node, int flags) {
  auto reached = node.reached();
  if (!reached) return -1;
  const int fd = open(pathOf(reached->get()).c_str(), (flags & ~(O_NOFOLLOW | O_CREAT | O_EXCL | O_NOCTTY | O_DIRECT)) | O_CLOEXEC);
  if (fd >= 0) node.opened(std::move(reached));
  return fd;
}

void closeFor(Node& node, uint64_t fd) {
  close(static_cast<int>(fd));
  node.closed();
}

bool opensForWriting(int flags) { return (flags & O_ACCMODE) != O_RDONLY || (flags & (O_TRUNC | O_APPEND)) != 0; }

int errorOf(int result) { return result == -1 ? errno : 0; }

bool isLink(int fd, const char* name) {
  struct stat stats {};
  return fstatat(fd, name, &stats, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) == 0 && S_ISLNK(stats.st_mode);
}

/** A link in a git folder is the owner's, as no agent makes one there: moved, it could lead the owner's git elsewhere. */
bool isLinkOfGits(const Node& folder, int fd, const char* name) { return guard::isGits(folder.area()) && isLink(fd, name); }

void onInit(void*, fuse_conn_info* connection) {
  for (const auto wanted : {FUSE_CAP_ATOMIC_O_TRUNC, FUSE_CAP_SPLICE_READ, FUSE_CAP_SPLICE_WRITE, FUSE_CAP_SPLICE_MOVE, FUSE_CAP_PARALLEL_DIROPS})
    if (connection->capable & static_cast<unsigned>(wanted)) connection->want |= static_cast<unsigned>(wanted);
  connection->want &= ~static_cast<unsigned>(FUSE_CAP_WRITEBACK_CACHE | FUSE_CAP_FLOCK_LOCKS | FUSE_CAP_POSIX_LOCKS);
}

void onLookup(fuse_req_t req, fuse_ino_t parent, const char* name) {
  fuse_entry_param entry{};
  const int error = folderOf(req).lookUp(nodeOf(req, parent), name, entry);
  if (error) fuse_reply_err(req, error);
  else fuse_reply_entry(req, &entry);
}

void onForget(fuse_req_t req, fuse_ino_t ino, uint64_t lookups) {
  folderOf(req).forget(ino, lookups);
  fuse_reply_none(req);
}

void onForgetMulti(fuse_req_t req, size_t count, fuse_forget_data* forgotten) {
  for (size_t i = 0; i < count; ++i) folderOf(req).forget(forgotten[i].ino, forgotten[i].nlookup);
  fuse_reply_none(req);
}

void replyWithEntry(fuse_req_t req, Node& parent, const char* name) {
  fuse_entry_param entry{};
  const int error = folderOf(req).lookUp(parent, name, entry);
  if (error) fuse_reply_err(req, error);
  else if (fuse_reply_entry(req, &entry) == -ENOENT) folderOf(req).forget(entry.ino, 1);
}

void onGetattr(fuse_req_t req, fuse_ino_t ino, fuse_file_info*) {
  struct stat stats {};
  const int error = nodeOf(req, ino).attributes(stats);
  if (error) fuse_reply_err(req, error);
  else fuse_reply_attr(req, &stats, KEPT_FOR_S);
}

int changed(Node& node, const struct stat& to, int what, fuse_file_info* file) {
  const auto reached = node.reached();
  if (!reached) return errno;
  const auto path = pathOf(reached->get());
  if ((what & FUSE_SET_ATTR_MODE) && chmod(path.c_str(), to.st_mode) != 0) return errno;
  if (what & (FUSE_SET_ATTR_UID | FUSE_SET_ATTR_GID)) {
    const uid_t uid = (what & FUSE_SET_ATTR_UID) ? to.st_uid : static_cast<uid_t>(-1);
    const gid_t gid = (what & FUSE_SET_ATTR_GID) ? to.st_gid : static_cast<gid_t>(-1);
    if (fchownat(reached->get(), "", uid, gid, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) != 0) return errno;
  }
  if (what & FUSE_SET_ATTR_SIZE) {
    const int error = file ? errorOf(ftruncate(static_cast<int>(file->fh), to.st_size)) : errorOf(truncate(path.c_str(), to.st_size));
    if (error) return error;
  }
  if (what & (FUSE_SET_ATTR_ATIME | FUSE_SET_ATTR_MTIME)) {
    const auto time = [&](int set, int now, const timespec& given) -> timespec {
      if (what & now) return {0, UTIME_NOW};
      if (what & set) return given;
      return {0, UTIME_OMIT};
    };
    const timespec times[2] = {time(FUSE_SET_ATTR_ATIME, FUSE_SET_ATTR_ATIME_NOW, to.st_atim), time(FUSE_SET_ATTR_MTIME, FUSE_SET_ATTR_MTIME_NOW, to.st_mtim)};
    if (utimensat(AT_FDCWD, path.c_str(), times, 0) != 0) return errno;
  }
  return 0;
}

void onSetattr(fuse_req_t req, fuse_ino_t ino, struct stat* to, int what, fuse_file_info* file) {
  Node& node = nodeOf(req, ino);
  if (node.isProtected()) return answer(req, REFUSED);
  const int error = changed(node, *to, what, file);
  if (error) fuse_reply_err(req, error);
  else onGetattr(req, ino, file);
}

void onReadlink(fuse_req_t req, fuse_ino_t ino) {
  const auto reached = nodeOf(req, ino).reached();
  if (!reached) return answer(req, errno);
  char target[PATH_MAX + 1];
  const ssize_t length = readlinkat(reached->get(), "", target, PATH_MAX);
  if (length < 0) return answer(req, errno);
  target[length] = '\0';
  fuse_reply_readlink(req, target);
}

Making makingOf(mode_t mode) { return S_ISREG(mode) ? Making::File : Making::Special; }

void onMknod(fuse_req_t req, fuse_ino_t parentIno, const char* name, mode_t mode, dev_t device) {
  Node& parent = nodeOf(req, parentIno);
  if (!guard::mayMake(parent.place(), name, makingOf(mode))) return answer(req, REFUSED);
  const auto in = parent.reached();
  if (!in || mknodat(in->get(), name, mode, device) != 0) return answer(req, errno);
  replyWithEntry(req, parent, name);
}

void onMkdir(fuse_req_t req, fuse_ino_t parentIno, const char* name, mode_t mode) {
  Node& parent = nodeOf(req, parentIno);
  if (!guard::mayMake(parent.place(), name, Making::Folder)) return answer(req, REFUSED);
  const auto in = parent.reached();
  if (!in || mkdirat(in->get(), name, mode) != 0) return answer(req, errno);
  replyWithEntry(req, parent, name);
}

void onSymlink(fuse_req_t req, const char* target, fuse_ino_t parentIno, const char* name) {
  Node& parent = nodeOf(req, parentIno);
  if (!guard::mayMake(parent.place(), name, Making::Link)) return answer(req, REFUSED);
  const auto in = parent.reached();
  if (!in || symlinkat(target, in->get(), name) != 0) return answer(req, errno);
  replyWithEntry(req, parent, name);
}

void onLink(fuse_req_t req, fuse_ino_t ino, fuse_ino_t parentIno, const char* name) {
  Node& node = nodeOf(req, ino);
  Node& parent = nodeOf(req, parentIno);
  if (node.isProtected() || !guard::mayTake(parent.place(), name)) return answer(req, REFUSED);
  const auto reached = node.reached();
  const auto in = parent.reached();
  if (!reached || !in) return answer(req, errno);
  if (isLinkOfGits(node, reached->get(), "")) return answer(req, REFUSED);
  if (node.area() != parent.area()) return answer(req, EXDEV);
  if (linkat(AT_FDCWD, pathOf(reached->get()).c_str(), in->get(), name, AT_SYMLINK_FOLLOW) != 0) return answer(req, errno);
  replyWithEntry(req, parent, name);
}

void remove(fuse_req_t req, fuse_ino_t parentIno, const char* name, int flags) {
  Node& parent = nodeOf(req, parentIno);
  if (!guard::isFree(parent.place(), name)) return answer(req, REFUSED);
  const auto in = parent.reached();
  answer(req, in ? errorOf(unlinkat(in->get(), name, flags)) : errno);
}

void onUnlink(fuse_req_t req, fuse_ino_t parent, const char* name) { remove(req, parent, name, 0); }

void onRmdir(fuse_req_t req, fuse_ino_t parent, const char* name) { remove(req, parent, name, AT_REMOVEDIR); }

void onRename(fuse_req_t req, fuse_ino_t fromIno, const char* name, fuse_ino_t toIno, const char* newName, unsigned flags) {
  Node& from = nodeOf(req, fromIno);
  Node& to = nodeOf(req, toIno);
  if (!guard::isFree(from.place(), name) || !guard::isFree(to.place(), newName)) return answer(req, REFUSED);
  const bool takesBoth = (flags & RENAME_EXCHANGE) != 0;
  const bool mayMove = guard::mayTake(to.place(), newName) && (!takesBoth || guard::mayTake(from.place(), name));
  if (!mayMove || !guard::sameArea(from.place(), to.place())) return answer(req, EXDEV);
  if (flags & ~static_cast<unsigned>(RENAME_NOREPLACE | RENAME_EXCHANGE)) return answer(req, EINVAL);
  const auto outOf = from.reached();
  const auto into = to.reached();
  if (!outOf || !into) return answer(req, errno);
  if (isLinkOfGits(from, outOf->get(), name) || isLinkOfGits(to, into->get(), newName)) return answer(req, REFUSED);
  if (syscall(SYS_renameat2, outOf->get(), name, into->get(), newName, flags) != 0) return answer(req, errno);
  folderOf(req).moved(to, newName);
  if (takesBoth) folderOf(req).moved(from, name);
  answer(req, 0);
}

void onCreate(fuse_req_t req, fuse_ino_t parentIno, const char* name, mode_t mode, fuse_file_info* file) {
  Node& parent = nodeOf(req, parentIno);
  if (!guard::mayMake(parent.place(), name, Making::File)) return answer(req, REFUSED);
  const auto in = parent.reached();
  if (!in) return answer(req, errno);
  Descriptor made(openat(in->get(), name, (file->flags & ~O_DIRECT) | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode));
  if (!made && (errno != EEXIST || (file->flags & O_EXCL))) return answer(req, errno);
  fuse_entry_param entry{};
  const int error = folderOf(req).lookUp(parent, name, entry);
  if (error) return answer(req, error);
  Node& there = nodeOf(req, entry.ino);
  const bool refused = !made && there.isProtected() && opensForWriting(file->flags);
  int fd = -1;
  if (made) there.opened(there.reached());
  if (made) fd = made.release();
  else if (refused || S_ISLNK(entry.attr.st_mode)) errno = refused ? REFUSED : ELOOP;
  else fd = openedAs(there, file->flags);
  if (fd < 0) {
    const int why = errno;
    folderOf(req).forget(entry.ino, 1);
    return answer(req, why);
  }
  file->fh = static_cast<uint64_t>(fd);
  if (fuse_reply_create(req, &entry, file) == -ENOENT) {
    closeFor(there, file->fh);
    folderOf(req).forget(entry.ino, 1);
  }
}

void onOpen(fuse_req_t req, fuse_ino_t ino, fuse_file_info* file) {
  Node& node = nodeOf(req, ino);
  if (node.isProtected() && opensForWriting(file->flags)) return answer(req, REFUSED);
  const int fd = openedAs(node, file->flags);
  if (fd < 0) return answer(req, errno);
  file->fh = static_cast<uint64_t>(fd);
  if (fuse_reply_open(req, file) == -ENOENT) closeFor(node, file->fh);
}

void onRead(fuse_req_t req, fuse_ino_t, size_t size, off_t offset, fuse_file_info* file) {
  fuse_bufvec data = FUSE_BUFVEC_INIT(size);
  data.buf[0].flags = static_cast<fuse_buf_flags>(FUSE_BUF_IS_FD | FUSE_BUF_FD_SEEK);
  data.buf[0].fd = static_cast<int>(file->fh);
  data.buf[0].pos = offset;
  fuse_reply_data(req, &data, FUSE_BUF_SPLICE_MOVE);
}

void onWriteBuf(fuse_req_t req, fuse_ino_t ino, fuse_bufvec* data, off_t offset, fuse_file_info* file) {
  if (nodeOf(req, ino).isProtected()) return answer(req, REFUSED);
  fuse_bufvec out = FUSE_BUFVEC_INIT(fuse_buf_size(data));
  out.buf[0].flags = static_cast<fuse_buf_flags>(FUSE_BUF_IS_FD | FUSE_BUF_FD_SEEK);
  out.buf[0].fd = static_cast<int>(file->fh);
  out.buf[0].pos = offset;
  const ssize_t written = fuse_buf_copy(&out, data, FUSE_BUF_SPLICE_NONBLOCK);
  if (written < 0) fuse_reply_err(req, static_cast<int>(-written));
  else fuse_reply_write(req, static_cast<size_t>(written));
}

void onFlush(fuse_req_t req, fuse_ino_t, fuse_file_info* file) { fuse_reply_err(req, errorOf(close(dup(static_cast<int>(file->fh))))); }

void onRelease(fuse_req_t req, fuse_ino_t ino, fuse_file_info* file) {
  closeFor(nodeOf(req, ino), file->fh);
  fuse_reply_err(req, 0);
}

void onFsync(fuse_req_t req, fuse_ino_t, int onlyData, fuse_file_info* file) {
  const int fd = static_cast<int>(file->fh);
  fuse_reply_err(req, errorOf(onlyData ? fdatasync(fd) : fsync(fd)));
}

void onFallocate(fuse_req_t req, fuse_ino_t ino, int mode, off_t offset, off_t length, fuse_file_info* file) {
  if (nodeOf(req, ino).isProtected()) return answer(req, REFUSED);
  fuse_reply_err(req, errorOf(fallocate(static_cast<int>(file->fh), mode, offset, length)));
}

void onCopyFileRange(fuse_req_t req, fuse_ino_t, off_t from, fuse_file_info* in, fuse_ino_t to, off_t at, fuse_file_info* out, size_t length, int flags) {
  if (nodeOf(req, to).isProtected()) return answer(req, REFUSED);
  const ssize_t copied = copy_file_range(static_cast<int>(in->fh), &from, static_cast<int>(out->fh), &at, length, static_cast<unsigned>(flags));
  if (copied < 0) fuse_reply_err(req, errno);
  else fuse_reply_write(req, static_cast<size_t>(copied));
}

void onLseek(fuse_req_t req, fuse_ino_t, off_t offset, int from, fuse_file_info* file) {
  const off_t at = lseek(static_cast<int>(file->fh), offset, from);
  if (at < 0) fuse_reply_err(req, errno);
  else fuse_reply_lseek(req, at);
}

void onOpendir(fuse_req_t req, fuse_ino_t ino, fuse_file_info* file) {
  const auto reached = nodeOf(req, ino).reached();
  if (!reached) return answer(req, errno);
  Descriptor fd(openat(reached->get(), ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (!fd) return answer(req, errno);
  auto opened = std::make_unique<OpenFolder>();
  opened->entries = fdopendir(fd.get());
  if (!opened->entries) return answer(req, errno);
  fd.release();
  file->fh = reinterpret_cast<uint64_t>(opened.get());
  if (fuse_reply_open(req, file) != -ENOENT) opened.release();
}

void listFolder(fuse_req_t req, fuse_ino_t ino, size_t size, off_t offset, fuse_file_info* file, bool withEntries) {
  auto& opened = *reinterpret_cast<OpenFolder*>(file->fh);
  if (offset != opened.at) {
    seekdir(opened.entries, offset);
    opened.unread = nullptr;
    opened.at = offset;
  }
  std::vector<char> listed(size);
  size_t used = 0;
  int error = 0;
  for (;;) {
    if (!opened.unread) {
      errno = 0;
      opened.unread = readdir(opened.entries);
      if (!opened.unread) {
        error = errno;
        break;
      }
    }
    const dirent& next = *opened.unread;
    const bool isItselfOrParent = std::strcmp(next.d_name, ".") == 0 || std::strcmp(next.d_name, "..") == 0;
    size_t taken = 0;
    if (withEntries) {
      fuse_entry_param entry{};
      if (isItselfOrParent) {
        entry.attr.st_ino = next.d_ino;
        entry.attr.st_mode = static_cast<mode_t>(next.d_type) << 12;
      } else if (folderOf(req).lookUp(nodeOf(req, ino), next.d_name, entry) != 0) {
        opened.at = next.d_off;
        opened.unread = nullptr;
        continue;
      }
      taken = fuse_add_direntry_plus(req, listed.data() + used, size - used, next.d_name, &entry, next.d_off);
      if (taken > size - used && entry.ino != 0) folderOf(req).forget(entry.ino, 1);
    } else {
      struct stat stats {};
      stats.st_ino = next.d_ino;
      stats.st_mode = static_cast<mode_t>(next.d_type) << 12;
      taken = fuse_add_direntry(req, listed.data() + used, size - used, next.d_name, &stats, next.d_off);
    }
    if (taken > size - used) break;
    used += taken;
    opened.at = next.d_off;
    opened.unread = nullptr;
  }
  if (error && used == 0) fuse_reply_err(req, error);
  else fuse_reply_buf(req, listed.data(), used);
}

void onReaddir(fuse_req_t req, fuse_ino_t ino, size_t size, off_t offset, fuse_file_info* file) { listFolder(req, ino, size, offset, file, false); }

void onReaddirPlus(fuse_req_t req, fuse_ino_t ino, size_t size, off_t offset, fuse_file_info* file) { listFolder(req, ino, size, offset, file, true); }

void onReleasedir(fuse_req_t req, fuse_ino_t, fuse_file_info* file) {
  delete reinterpret_cast<OpenFolder*>(file->fh);
  fuse_reply_err(req, 0);
}

void onFsyncdir(fuse_req_t req, fuse_ino_t, int onlyData, fuse_file_info* file) {
  const int fd = dirfd(reinterpret_cast<OpenFolder*>(file->fh)->entries);
  fuse_reply_err(req, errorOf(onlyData ? fdatasync(fd) : fsync(fd)));
}

void onStatfs(fuse_req_t req, fuse_ino_t ino) {
  const auto reached = nodeOf(req, ino).reached();
  struct statvfs stats {};
  if (!reached || fstatvfs(reached->get(), &stats) != 0) fuse_reply_err(req, errno);
  else fuse_reply_statfs(req, &stats);
}

void onAccess(fuse_req_t req, fuse_ino_t ino, int mask) {
  Node& node = nodeOf(req, ino);
  if ((mask & W_OK) && node.isProtected()) return answer(req, REFUSED);
  const auto reached = node.reached();
  answer(req, reached ? errorOf(static_cast<int>(syscall(SYS_faccessat2, reached->get(), "", mask, AT_EMPTY_PATH | AT_EACCESS))) : errno);
}

fuse_lowlevel_ops operations() {
  fuse_lowlevel_ops ops{};
  ops.init = onInit;
  ops.lookup = onLookup;
  ops.forget = onForget;
  ops.forget_multi = onForgetMulti;
  ops.getattr = onGetattr;
  ops.setattr = onSetattr;
  ops.readlink = onReadlink;
  ops.mknod = onMknod;
  ops.mkdir = onMkdir;
  ops.symlink = onSymlink;
  ops.link = onLink;
  ops.unlink = onUnlink;
  ops.rmdir = onRmdir;
  ops.rename = onRename;
  ops.create = onCreate;
  ops.open = onOpen;
  ops.read = onRead;
  ops.write_buf = onWriteBuf;
  ops.flush = onFlush;
  ops.release = onRelease;
  ops.fsync = onFsync;
  ops.fallocate = onFallocate;
  ops.copy_file_range = onCopyFileRange;
  ops.lseek = onLseek;
  ops.opendir = onOpendir;
  ops.readdir = onReaddir;
  ops.readdirplus = onReaddirPlus;
  ops.releasedir = onReleasedir;
  ops.fsyncdir = onFsyncdir;
  ops.statfs = onStatfs;
  ops.access = onAccess;
  return ops;
}

struct Agent {
  uid_t uid;
  gid_t gid;
};

Agent agentIn(const std::string& given) {
  const auto colon = given.find(':');
  if (colon == std::string::npos) throw std::runtime_error("no <uid>:<gid> in " + given);
  return {static_cast<uid_t>(std::stoul(given.substr(0, colon))), static_cast<gid_t>(std::stoul(given.substr(colon + 1)))};
}

void mustNotFail(int result, const std::string& what) {
  if (result == -1) throw std::runtime_error(what + ": " + std::strerror(errno));
}

/** Dropping from the bounding set and the ambient set takes CAP_SETPCAP, which goes with root: so this comes before the user changes. */
void giveUpWhatItCouldGain() {
  for (int capability = 0; prctl(PR_CAPBSET_READ, capability) >= 0; ++capability) mustNotFail(prctl(PR_CAPBSET_DROP, capability), "giving up what it could gain");
  mustNotFail(prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0), "giving up what it would pass on");
}

void giveUpEveryCapability() {
  __user_cap_header_struct header{_LINUX_CAPABILITY_VERSION_3, 0};
  __user_cap_data_struct none[2] = {};
  mustNotFail(static_cast<int>(syscall(SYS_capset, &header, none)), "giving up its capabilities");
  mustNotFail(prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0), "never gaining any");
}

/** From here on, everything is done as the agents' user, and nothing they do can reach this process or be done by it as root. */
void actOnlyAs(const Agent& agent) {
  mustNotFail(setgroups(0, nullptr), "leaving every group");
  setfsgid(agent.gid);
  setfsuid(agent.uid);
  if (static_cast<uid_t>(setfsuid(static_cast<uid_t>(-1))) != agent.uid) throw std::runtime_error("could not act as the agents' user");
  if (static_cast<gid_t>(setfsgid(static_cast<gid_t>(-1))) != agent.gid) throw std::runtime_error("could not act as the agents' group");
  giveUpWhatItCouldGain();
  giveUpEveryCapability();
  mustNotFail(prctl(PR_SET_DUMPABLE, 0), "keeping others out");
  umask(0);
}

/** Becomes this user for good, in no group, with no capability, none to gain and no way back to root. */
void becomeOnly(const Agent& user) {
  mustNotFail(setgroups(0, nullptr), "leaving every group");
  giveUpWhatItCouldGain();
  mustNotFail(setresgid(user.gid, user.gid, user.gid), "becoming the group");
  mustNotFail(setresuid(user.uid, user.uid, user.uid), "becoming the user");
  giveUpEveryCapability();
}

const Agent NOBODY{65534, 65534};

/** Lets the agents' user reach each socket Mirador forwarded into the folder; nothing else there changes, and no link is followed. */
void openSocketsIn(const std::string& folder) {
  for (const auto& entry : std::filesystem::directory_iterator(folder)) {
    struct stat found {};
    if (lstat(entry.path().c_str(), &found) == 0 && S_ISSOCK(found.st_mode)) mustNotFail(chmod(entry.path().c_str(), 0666), "opening " + entry.path().string());
  }
}

void allowManyOpenFiles() {
  rlimit limit{};
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0) return;
  limit.rlim_cur = limit.rlim_max;
  setrlimit(RLIMIT_NOFILE, &limit);
}

struct Served {
  std::unique_ptr<GuardedFolder> folder;
  fuse_session* session;
};

Served guarded(const guard::Root& root, const fuse_lowlevel_ops& ops) {
  auto folder = std::make_unique<GuardedFolder>(root.raw, *root.paths);
  std::filesystem::create_directories(root.target);
  std::string options = "allow_other,nosuid,nodev,fsname=mirador,subtype=mirador";
  std::string program = "mirador-guard", flag = "-o";
  char* arguments[] = {program.data(), flag.data(), options.data()};
  fuse_args args = FUSE_ARGS_INIT(3, arguments);
  fuse_session* session = fuse_session_new(&args, &ops, sizeof(ops), folder.get());
  fuse_opt_free_args(&args);
  if (!session || fuse_session_mount(session, root.target.c_str()) != 0) throw std::runtime_error("could not guard " + root.target);
  return {std::move(folder), session};
}

void serve(fuse_session* session) {
  fuse_loop_config* config = fuse_loop_cfg_create();
  fuse_loop_cfg_set_clone_fd(config, 0);
  fuse_session_loop_mt(session, config);
  std::cerr << "mirador-guard: a folder is no longer guarded" << std::endl;
  _exit(1);
}

[[noreturn]] void couldNotRun(const char* program) {
  std::cerr << "mirador-guard: " << program << ": " << std::strerror(errno) << std::endl;
  _exit(127);
}

/** The base image's environment never reaches what runs as nobody beside the agents: it gets a PATH, and its program by whole path. */
char* const NOTHING_OF_THE_IMAGE[] = {const_cast<char*>("PATH=/usr/sbin:/usr/bin:/sbin:/bin"), nullptr};

pid_t startedAsNobody(char** command) {
  if (command[0][0] != '/') throw std::runtime_error(std::string("not a whole path: ") + command[0]);
  const pid_t child = fork();
  mustNotFail(child, "starting the command");
  if (child > 0) return child;
  try {
    becomeOnly(NOBODY);
  } catch (const std::exception& error) {
    std::cerr << "mirador-guard: " << error.what() << std::endl;
    _exit(1);
  }
  execve(command[0], command, NOTHING_OF_THE_IMAGE);
  couldNotRun(command[0]);
}

const char* const USAGE =
    "usage: mirador-guard <manifest> <uid>:<gid> <sockets folder> -- <command>...\n"
    "       mirador-guard as <uid>:<gid> -- <command>...";

int guardAndRun(int argc, char** argv) {
  if (argc < 6 || std::string(argv[4]) != "--") throw std::runtime_error(USAGE);
  const auto roots = guard::readManifest(argv[1]);
  const auto agent = agentIn(argv[2]);
  allowManyOpenFiles();
  for (const auto& root : roots) mustNotFail(chmod(std::filesystem::path(root.raw).parent_path().c_str(), 0700), "keeping the agents out of " + root.raw);
  openSocketsIn(argv[3]);
  const auto ops = operations();
  std::vector<Served> served;
  for (const auto& root : roots) served.push_back(guarded(root, ops));
  const pid_t command = startedAsNobody(argv + 5);
  actOnlyAs(agent);
  for (const auto& each : served) std::thread(serve, each.session).detach();
  int status = 0;
  while (waitpid(command, &status, 0) == -1)
    if (errno != EINTR) throw std::runtime_error("waiting for the command failed");
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}

/** Its home lies in the VM's own /tmp, made by the user it is for, so nothing of the base image is touched as root. */
void makeHome() {
  if (const char* home = std::getenv("HOME"); home && home[0] == '/') mkdir(home, 0700);
}

/**
 * Apple's `container exec` gives a command the image's values first and then those it was given, a name twice where both
 * have it; the program found and getenv() would go by the image's. As a shell does, the last of each name wins.
 */
std::vector<char*> lastOfEachName(char** given) {
  std::vector<char*> kept;
  std::unordered_map<std::string_view, size_t> keptAt;
  for (char** entry = given; *entry != nullptr; ++entry) {
    const std::string_view whole(*entry);
    const auto [found, isNew] = keptAt.try_emplace(whole.substr(0, whole.find('=')), kept.size());
    if (isNew) kept.push_back(*entry);
    else kept[found->second] = *entry;
  }
  kept.push_back(nullptr);
  return kept;
}

/** A command started as root in the VM, dropped to the user at once: its environment is what it was given, its own user's to use. */
[[noreturn]] void runAs(int argc, char** argv) {
  if (argc < 5 || std::string(argv[3]) != "--") throw std::runtime_error(USAGE);
  auto environment = lastOfEachName(environ);
  environ = environment.data();
  becomeOnly(agentIn(argv[2]));
  makeHome();
  execvp(argv[4], argv + 4);
  couldNotRun(argv[4]);
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc > 1 && std::string(argv[1]) == "as") runAs(argc, argv);
    _exit(guardAndRun(argc, argv));
  } catch (const std::exception& error) {
    std::cerr << "mirador-guard: " << error.what() << std::endl;
    _exit(1);
  }
}
