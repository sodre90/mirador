# Beads workflow

Track all work in beads (`bd`), not TodoWrite, TaskCreate or markdown lists. Create a bead before you write code and claim it when you start. Keep what outlasts the session with `bd remember "<insight>"`, not in MEMORY.md files; find it again with `bd memories <keyword>` or `bd recall <key>`.

Before you say a piece of work is done:
1. Close what is finished (`bd close <id> ...`) and file beads for what is left.
2. Run the checks: type check and tests.
3. Commit and land it as CLAUDE.md's Commits section says.

Commands:
- Find work: `bd ready`, `bd list --status=open|in_progress`, `bd blocked`, `bd search <query>`, `bd show <id>`.
- Create: `bd create --title="…" --description="…" --type=task|bug|feature --priority=0-4` (0 is critical, 4 backlog); `--parent=<id>` makes it a child.
- Change: `bd update <id> --claim`, `bd update <id> --title|--description|--notes|--design "…"`, `bd close <id> --reason="…"`, `bd dep add <issue> <depends-on>`.
- Never `bd edit`: it opens an editor and blocks you. `bd prime --export` prints bd's full command reference.
