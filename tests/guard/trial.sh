#!/bin/bash
# What an agent tries in a VM's guarded workspace, as tests/guard-in-vm.test.ts sets it up: told of each attempt that went
# otherwise than it should, and at the end how many there were. usage: trial.sh <workspace>
cd "$1" || exit 9
attempts=0
wrong=0
said=$(mktemp)

went_wrong() {
  wrong=$((wrong + 1))
  echo "$1 -> $(tail -1 "$said")"
}
refused_with() {
  attempts=$((attempts + 1))
  if (eval "$2") >/dev/null 2>"$said"; then went_wrong "NOT REFUSED: $2"
  elif ! grep -qE "$1" "$said"; then went_wrong "REFUSED FOR ANOTHER REASON: $2"; fi
}
refused() { refused_with "Read-only file system|EROFS|cross-device link" "$1"; }
refused_or_there() { refused_with "Read-only file system|File exists|Is a directory" "$1"; }
fails() {
  attempts=$((attempts + 1))
  if (eval "$1") >/dev/null 2>"$said"; then went_wrong "DID NOT FAIL: $1"; fi
}
works() {
  attempts=$((attempts + 1))
  if ! (eval "$1") >/dev/null 2>"$said"; then went_wrong "DOES NOT WORK: $1"; fi
}
as_someone="-c user.name=agent -c user.email=agent@example.com"
RENAME_EXCHANGE=2
exchanged() { perl -e '$! = 0; syscall($ARGV[0] + 0, -100, $ARGV[2], -100, $ARGV[3], $ARGV[1] + 0) == 0 or die "$!\n"' "$(test "$(uname -m)" = x86_64 && echo 316 || echo 276)" "$RENAME_EXCHANGE" "$1" "$2"; }

for file in CLAUDE.md pkg/CLAUDE.md .team/gitconfig .claude/settings.json .git/config vendor/lib/.git/config vendor/lib/githooks/pre-commit .git/modules/mods/refs/config mods/refs/.git fixtures/remote.git/config; do
  works "cat $file"
  refused "echo x >> $file"
  refused "echo x > $file"
  refused "rm -f $file"
  refused "mv $file /tmp/moved"
  refused "mv $file $file.aside"
  refused "ln $file hard"
  refused "truncate -s 0 $file"
  refused "chmod 777 $file"
  refused "touch $file"
  refused "cp src/a.txt $file"
  refused "mv src/a.txt $file"
  refused "ln -sf /etc/passwd $file"
  refused "sed -i s/o/x/ $file"
  refused "exchanged src/a.txt $file"
done
refused "node -e 'fs.accessSync(\"CLAUDE.md\", fs.constants.W_OK)'"
refused "node -e 'fs.openSync(\"CLAUDE.md\", \"r+\")'"
refused "node -e 'fs.truncateSync(\"CLAUDE.md\")'"

for folder in pkg .claude .team; do refused "mv $folder moved-aside"; done
refused "rmdir pkg"
refused "rm -rf .claude"
refused "mkdir .claude/commands"
refused "touch .claude/new"
refused "touch vendor/lib/githooks/post-checkout"
refused "mkdir .claude/x && touch .claude/x/y"

# The same names as the disk of a Mac, or git, takes them for.
refused_or_there "echo x > claude.MD"
refused_or_there "echo x > .git/CONFIG"
refused_or_there "mkdir .GIT"
refused "mkdir src/.GiT"
refused "mkdir \$'src/.g\\xe2\\x80\\x8cit'"
refused_or_there "echo x > \$'.git/hook\\xc5\\xbf'"
refused_or_there "mkdir \$'.git/hoo\\xe2\\x84\\xaas'"

# What programs rename over a protected file.
for temporary in CLAUDE.md.tmp.123 .CLAUDE.md.swp "'#CLAUDE.md#'" CLAUDE.md___jb_tmp___ .git/config.lock .git/config.worktree .git/config.worktree.lock vendor/lib/.git/config.lock; do refused "echo x > $temporary"; done

# A repository planted for the owner's git to find.
refused "mkdir src/.git"
refused "echo 'gitdir: /tmp/x' > src/.git"
refused "ln -s /tmp/x src/.git"
refused "ln -s ../vendor/lib/.git src/.git"
works "mkdir src/planted"
refused "mv -T src/planted src/.git"
refused "git init src/repo"
refused "git clone -q vendor/lib src/clone"
refused "mv .git git2"
refused "mv vendor/lib/.git vendor/lib/git2"

# One without a .git, which git takes any folder with a HEAD for.
for head in HEAD src/HEAD src/head vendor/lib/HEAD "\$'src/H\\xe2\\x80\\x8cEAD'"; do
  refused "echo 'ref: refs/heads/main' > $head"
  refused "ln -s refs/heads/main $head"
  refused "ln src/a.txt $head"
  refused "mkfifo $head"
  refused "mv src/a.txt $head"
done
works "mkdir src/HEAD"
refused "exchanged src/a.txt src/HEAD"
refused "exchanged src/HEAD src/a.txt"
works "rmdir src/HEAD"
refused "exchanged src/a.txt node_modules/pkg/HEAD"
refused "node -e 'fs.renameSync(\"src/a.txt\", \"src/HEAD\")'"
refused "git init -q --bare src/bare"
refused "git clone -q --bare . src/clone.git"
refused "cp -r fixtures/remote.git src/remote.git"
refused "mv fixtures/remote.git fixtures/aside.git"
refused "git -C fixtures/remote.git config core.fsmonitor planted"
refused "echo x > fixtures/remote.git/hooks/post-receive"
works "echo x >> docs/HEAD"
refused "echo x > docs/config"
refused "mkdir docs/hooks"
refused "ln docs/HEAD src/linked"
refused "echo x >> node_modules/pkg/HEAD"
refused "ln node_modules/pkg/HEAD src/linked"
works "mv node_modules/pkg/HEAD node_modules/pkg/headline"
refused "mv node_modules/pkg/headline node_modules/pkg/HEAD"
works "rm -rf src/bare src/clone.git src/remote.git"
works "mkdir -p src/HEAD/deep && echo x > src/HEAD/deep/x && mv src/HEAD src/headless && mv src/headless src/HEAD && cat src/HEAD/deep/x && rm -r src/HEAD"
works "git push -q fixtures/remote.git HEAD:refs/heads/pushed"
works "git -C fixtures/remote.git log -1 pushed"

# What git runs or is led elsewhere by.
refused "mkdir .git/hooks/x"
refused "echo x > .git/hooks/pre-commit"
refused "mv .git/hooks .git/hooks-aside"
refused "rm -rf .git/hooks"
refused "mkdir .git/worktrees"
refused "echo x > .git/commondir"
refused "echo x > .git/gitdir"
refused "echo /elsewhere/objects > .git/objects/info/alternates"
refused "mkdir -p .git/aside/info && echo /elsewhere/objects > .git/aside/info/alternates && mv .git/aside/info/alternates .git/objects/info/alternates"
refused "mv .git/objects .git/objects-aside"
refused "echo $(git rev-parse HEAD) > .git/info/grafts"
refused "mv .git/info .git/info-aside"
works "echo planted.txt >> .git/info/exclude"
refused "mkdir .git/remotes"
refused "echo 'URL: /elsewhere' > .git/branches"
works "git $as_someone commit -q --allow-empty -m 'objects of its own' && git commit-graph write --reachable && test -f .git/objects/info/commit-graph"
works "mkdir .git/foo && echo x > .git/foo/config"
refused "mv .git/modules .git/modules-aside"
refused "mv .git/foo .git/modules"
refused "mv .git/foo .git/hooks"
refused "mkdir .git/modules/new"
refused "echo x > .git/modules/mods/x"
refused "mkdir -p .git/modules/mods/refs/hooks && touch .git/modules/mods/refs/hooks/pre-commit"
refused "mv .git/modules/mods .git/modules/mm"
refused "mv .git/modules/mods/refs .git/modules/mods/r2"
refused "git worktree add /tmp/worktree"
refused "git config user.name planted"
refused "git -C vendor/lib config core.fsmonitor planted"
refused "git submodule add ./vendor/lib mods/two"

# Links and the like in a git folder, which the owner's git would write through.
refused "ln -s /tmp/x .git/planted"
works "rm .git/logs/HEAD"
refused "ln -s /tmp/x .git/logs/HEAD"
works "ln -s /tmp/x src/l"
refused "mv -T src/l .git/index"
refused "node -e 'fs.renameSync(\"src/l\", \".git/logs/l\")'"
refused "node -e 'fs.linkSync(\"src/l\", \".git/logs/l\")'"
refused "ln -s /tmp/x vendor/lib/.git/l"
refused "ln src/a.txt .git/l"
refused "mkfifo .git/p"
refused "mkfifo .git/logs/p"
works "rm src/l"
works "git reset -q && git checkout -q -- ."

# Work as usual.
works "echo b > src/b.txt"
works "mkdir -p src/deep/er && echo c > src/deep/er/c"
works "mv src/b.txt src/b2.txt"
works "mv src/deep src/deep2"
works "ln -s ../b2.txt src/deep2/l"
works "ln src/b2.txt src/hard && rm src/hard"
works "chmod +x src/b2.txt && test -x src/b2.txt"
works "touch -d 2001-01-01 src/b2.txt"
works "mkdir pkg/sub && echo p > pkg/other.txt && rm -rf pkg/sub pkg/other.txt"
works "mkfifo src/pipe && rm src/pipe"
works "git status --porcelain"
works "git add -A"
works "git $as_someone commit -qm second"
works "git branch topic"
works "git checkout -q topic"
works "echo t > src/t.txt && git add src/t.txt && git $as_someone commit -qm topic"
works "git checkout -q -"
works "echo m > src/m.txt && git add . && git $as_someone commit -qm main2"
works "git $as_someone rebase -q topic"
works "git $as_someone merge -q topic"
works "echo s >> src/a.txt && git $as_someone stash -q && git stash pop -q"
works "git branch -D topic"
works "git tag v1"
works "git gc -q"
works "git pack-refs --all"
works "git fsck"
works "git checkout -q -- src/a.txt"
works "git reset -q --hard HEAD~1"
works "git -C vendor/lib status"
works "cd vendor/lib && echo n > n && git add n && git $as_someone commit -qm n"
works "cd mods/refs && echo q > q && git add q && git $as_someone commit -qm q"
works "git clone -q . /tmp/clone\$\$"
works "dd if=/dev/urandom of=src/big bs=1M count=20 && cp src/big src/big2 && cmp src/big src/big2 && rm src/big src/big2"
works "node -e 'const f = fs.openSync(\"src/u\", \"w+\"); fs.unlinkSync(\"src/u\"); fs.writeSync(f, \"x\"); if (fs.fstatSync(f).size !== 1) throw 1'"
works "node -e 'fs.writeFileSync(\"src/moved\", \"zz\"); const f = fs.openSync(\"src/moved\", \"r+\"); fs.renameSync(\"src/moved\", \"src/moved2\"); fs.ftruncateSync(f, 1); fs.fchmodSync(f, 0o644); if (fs.readFileSync(\"src/moved2\", \"utf8\") !== \"z\") throw 2'"
works "for i in 1 2 3 4 5 6 7 8 9; do echo \$i > src/swap.tmp && mv src/swap.tmp src/swap && test \$(cat src/swap) = \$i || exit 1; done"
works "mkdir -p src/x/y && echo 1 > src/x/y/f && mv src/x src/z && echo 2 >> src/z/y/f && mv src/z/y/f src/z/f && cat src/z/f && rm -rf src/z"
works "bash -c 'exec 9>src/lock; flock -n 9; flock -n src/lock true && exit 1; exit 0'"

# Ways around the guard: to the folder behind it, or to its own process.
guard=$(grep -lx mirador-guard /proc/[0-9]*/comm | head -1 | cut -d/ -f3)
works "test -n '$guard'"
fails "ls /mirador/raw"
fails "ls /mirador/raw/0"
fails "umount '$1'"
fails "mount --bind /mirador/raw/0 /tmp"
fails "nsenter -t $guard -m true"
fails "ls /proc/$guard/root"
fails "ls /proc/$guard/fd"
fails "cat /proc/$guard/environ"
fails "cat /proc/$guard/mem"
fails "kill -9 $guard"
fails "kill -9 1"
fails "echo x > /mirador/guard/folders"
fails "mv /mirador/guard/folders /mirador/guard/aside"
fails "unshare -Urm ls /mirador/raw/0"
fails "unshare -Urm umount '$1'"
fails "unshare -Urm umount -l '$1'"
fails "unshare -Urm sh -c 'mkdir -p /tmp/bound && mount --bind /mirador/raw /tmp/bound && ls /tmp/bound'"
fails "unshare -Urm sh -c 'mkdir -p /tmp/bound && mount --rbind / /tmp/bound && ls /tmp/bound/mirador/raw/0'"
fails "unshare -Urm sh -c 'mount -t tmpfs none /mirador/raw && ls /mirador/raw/0'"
fails "unshare -Urm sh -c \"echo planted > '$1/CLAUDE.md'\""

rm -f "$said"
echo "$attempts attempts, $wrong went otherwise than they should"
