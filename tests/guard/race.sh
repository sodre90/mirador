#!/bin/bash
# What an agent tries for some seconds, as fast as it can, while the owner replaces what the guard protects: tells each
# attempt that went through, and at the end how many there were. usage: race.sh <workspace> <seconds>
cd "$1" || exit 9
ends=$((SECONDS + $2))
attempts=0
try() {
  attempts=$((attempts + 1))
  if (eval "$1") >/dev/null 2>&1; then echo "WENT THROUGH: $1"; fi
}
while [ $SECONDS -lt $ends ]; do
  for file in .git/config .git/config.lock vendor/lib/.git/config CLAUDE.md CLAUDE.md.tmp pkg/CLAUDE.md .claude/settings.json; do
    try "echo '# planted' >> $file"
    try "ln $file src/planted$attempts"
  done
  try "mkdir .claude"
  try "touch .claude/planted"
  try "mkdir .git/hooks"
  try "touch .git/hooks/post-checkout"
  try "mkdir pkg/.git"
done
echo "$attempts attempts"
