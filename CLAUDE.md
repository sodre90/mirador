# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Commits

- **You may commit and push at any time without asking**: whenever a change is finished and its checks pass. This overrides the conservative git policy in the beads block above.
- **Author and committer:** whoever owns the checkout, from its git config. Never pass `--author`, set `user.name` or `user.email`, or write a name here.
- **Beads hook:** the beads `prepare-commit-msg` hook, which adds agent trailers, was removed on purpose. Never reinstall it.
- **One commit per finished change**, with only that change's files. Other work in the tree stays uncommitted. Include `.beads/interactions.jsonl` when it changed.
- **A pull request holds a single squashed commit:** fold follow-up fixes into it and update the branch with `git push --force-with-lease`.
- **Never amend or rebase a commit that's already on main:** make a new commit instead. Rewriting a pushed commit leaves main and origin/main with two copies of it. A pull request's own branch is the exception above.
- **Messages:** one plain sentence saying what the user gets, as in "Reorder queued messages by dragging them".

## Build & Test

```bash
bun install
bun start                  # host on 127.0.0.1:4600, canvas assets on :4601
bun run dev                # the same, with UI hot reload
bunx tsc --noEmit -p .     # type check
bun run test               # unit tests
scripts/e2e.sh [e2e/<spec>.spec.ts ...]   # e2e on this machine, 4 workers, from a copy of the tree
scripts/linux-test.sh      # type check, unit and e2e tests in Ubuntu via Docker
scripts/test-spec.sh e2e/<spec>.spec.ts   # just those specs, in Docker
```

- **Run e2e with `scripts/e2e.sh`:** it copies the files git tracks or would add into a temp folder and runs Playwright there, with its own test-results. Any number of runs, yours and agents', go at once, and the checkout can be edited while they run. The copy stays only when a test failed, for its traces. Playwright arguments pass through, e.g. `--workers=1`.
- **`bunx playwright test` runs from the checkout itself:** its hosts pick up edits to `web/` and `host/` mid-run, and two such runs wipe each other's test-results. Keep it for retaking the README screenshots (`MIRADOR_SCREENSHOTS=1`), which it writes into `docs/`.
- **E2E hosts take free ports:** `new TestHost()` takes four ports in a row in 20000–31999 at its first start (its own, canvas assets, and two for the network) and keeps them across restarts. Read `host.port` and `host.origin` in hooks and tests, not as the spec loads; an `environment` that depends on the port is a function of it. mirador-mobile's e2e uses 5800 and up.
- **E2E pages are English through the browser locale:** Mirador follows the browser's language unless one is chosen in Settings, and `playwright.config.ts` sets `en-US`. A spec that sets another locale gets that language, where `signIn` (which waits for English text) times out: open `host.authUrl` itself.
- **Serial specs:** run the whole file, not `-g`.
- **Canvas selectors need `:visible`:** each kept conversation keeps its canvas in the page, hidden, so `.canvas-panel` and `.canvas-frame` can match several, and `[data-pane="canvas"]` matches the canvas pane while it is hidden. Reviews and tours draw in the code review plugin's frame: reach them with `walkthroughView(page)` from `e2e/helpers.ts`.
- **Real Claude replies:** specs that wait for one get it from the owner's model server, never a Claude login: `LLM_SERVER_URL` and `LLM_SERVER_KEY`, exported or in `~/.config/mirador/e2e-model-server.env` (mode 600), natively and in Docker alike. Without them those specs fail. Each test host gives Claude Code its own `CLAUDE_CONFIG_DIR`, so e2e sessions stay out of `~/.claude`; only `usesClaudeLogin` hosts use it. The model server wins over an `ANTHROPIC_BASE_URL` the run inherits, but a spec that sets its own keeps it. Two `linux-test.sh` full-suite runs can't overlap (shared results dir).

## Architecture Overview

Mirador is a localhost web app that drives coding agents (Claude Code through `claude-agent-acp`, opencode, and pi through a patched `pi-acp`) over ACP, and gives them a canvas with the `show` and `ask` tools, plus the tools of canvas plugins, such as `review`, `tour` and `checklist` from the plugins it installs by itself (`plugins/defaults.json`), whose code lives in their own repos.

- **`host/`** is the Bun server:
  - the ACP client, with one agent process per profile and many sessions on it;
  - the canvas MCP server, which each session gets through `session/new`;
  - terminals;
  - the SQLite store in `~/.mirador`;
  - device invites for remote machines.
- **`web/`** is the React UI, bundled by Bun. It talks to the host over one WebSocket. Messages are typed in `shared/protocol.ts`.
- **`shared/`** holds the types and logic both sides use.
- **`desktop/`** is the Electrobun tray app that wraps it.
- **`site/`** is the website, mirador.sodre90.com. `bun scripts/build-site.ts` assembles it with the README's screenshots, and `.github/workflows/site.yml` publishes it; `e2e/site.spec.ts` checks it.
- **`e2e/`** holds the Playwright specs. Their helper hosts are in `e2e/test-host.ts`. **`tests/`** holds the unit tests.

## Conventions & Patterns

- **Names over comments.** Keep comments for a genuine "why" that a name cannot carry.
- **Tests come with every change.** Every user-visible change gets e2e coverage, and logic gets unit tests.
- **UI text is translated:** English in `web/i18n/en/`, Hungarian in `web/i18n/hu/`, Spanish in `web/i18n/es/` and Simplified Chinese in `web/i18n/zh/` (typed against English, so a missing key fails `tsc`), read through `t` from `web/i18n/index.ts`. Tooltips are `hints` there. New text goes into every language; `shared/i18n/GLOSSARY.md` holds the terms of each. Text for agents, the voice model or spoken commands stays English.
- **UI wording:** plain words and sentence case.
- **Secrets:** never print the `/auth?token=…` link, tokens or profile environment values. Host logs contain them, so filter `auth?token` out of anything you show.
- **The owner's own Mirador runs from this checkout.**
  - Host changes take effect after a restart (`⌘⇧R`). Leave the restart to the owner: it stops the turn that triggered it.
  - The real database `~/.mirador/state.sqlite` is read-only for agents. Work on a copy.
