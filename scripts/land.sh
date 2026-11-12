#!/usr/bin/env bash
# Lands work on main and keeps the main checkout's index and files in step with it, so the sessions sharing that checkout
# never find their commits there as staged reverts.
#
#   scripts/land.sh -m "<message>" -- <path>...   commit those paths as they are on disk and land the commit on main
#   scripts/land.sh                                in a worktree: land the commits it holds on top of main
#
# It neither pushes nor runs the commit hooks; the beads pre-commit hook has nothing to do here (export.git-add is off).
set -euo pipefail

fail() {
  echo "land: $*" >&2
  exit 1
}

for variable in GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE; do
  [ -z "${!variable:-}" ] || fail "$variable is set, which points git at another index or tree; unset it and run again"
done
export GIT_LITERAL_PATHSPECS=1

message=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m)
      [ $# -ge 2 ] || fail "-m needs a message"
      message=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *) fail "unexpected $1; paths go after --" ;;
  esac
done
[ -z "$message" ] || [ $# -gt 0 ] || fail "say which paths to commit after --"
[ -n "$message" ] || [ $# -eq 0 ] || fail "say what the commit does with -m"

physical() { (cd "$1" && pwd -P); }

main_checkout=$(git worktree list --porcelain | awk '/^worktree /{path = substr($0, 10)} $0 == "branch refs/heads/main" {print path}')
[ -n "$main_checkout" ] || fail "no checkout has main checked out"
main_checkout=$(physical "$main_checkout")
here=$(physical "$(git rev-parse --show-toplevel)")
before=$(git rev-parse --verify refs/heads/main)

commit_on_main_through_an_own_index() {
  local scratch tree landed changes
  scratch=$(mktemp -d)
  trap "rm -rf '$scratch'" EXIT
  GIT_INDEX_FILE=$scratch/index git read-tree "$before"
  GIT_INDEX_FILE=$scratch/index git add --all -- "$@"
  changes=$(GIT_INDEX_FILE=$scratch/index git diff --cached --name-status "$before")
  [ -n "$changes" ] || fail "those paths hold nothing new"
  tree=$(GIT_INDEX_FILE=$scratch/index git write-tree)
  landed=$(git commit-tree "$tree" -p "$before" -m "$message")
  git update-ref -m "land: ${message%%$'\n'*}" refs/heads/main "$landed" "$before" ||
    fail "main moved while landing; nothing landed, run the same command again"
  git reset -q -- "$@"
}

fast_forward_the_main_checkout() {
  local head
  head=$(git rev-parse --verify HEAD)
  [ "$head" != "$before" ] || fail "nothing to land: this worktree holds no commits beyond main"
  git merge-base --is-ancestor "$before" "$head" || fail "main has commits this worktree lacks; run git rebase main, then land again"
  git -C "$main_checkout" merge --ff-only --quiet "$head" ||
    fail "the main checkout has uncommitted edits to files these commits change; nothing landed"
}

if [ "$here" = "$main_checkout" ]; then
  [ -n "$message" ] || fail 'the main checkout is shared: land with -m "<message>" -- <path>...'
  commit_on_main_through_an_own_index "$@"
else
  if [ -n "$message" ]; then
    git add --all -- "$@"
    git -c core.hooksPath=/dev/null commit --quiet -m "$message" -- "$@"
  fi
  fast_forward_the_main_checkout
fi

git log --oneline "$before..refs/heads/main"
git diff --stat "$before" refs/heads/main
echo "Landed on main; push it with git push origin main."
