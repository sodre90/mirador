# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## Beads issue tracker

This project tracks its work in **bd (beads)**. The session start hook prints the workflow (`.beads/PRIME.md`) and the memories; `bd prime` prints them again.

- Use `bd` for all task tracking, not TodoWrite, TaskCreate or markdown TODO lists.
- Use `bd remember` for persistent knowledge, not MEMORY.md files.
- Issues live in a local Dolt DB; sync uses `refs/dolt/data` on the git remote; `.beads/issues.jsonl` is a passive export.

## Commits

- **You may commit and push at any time without asking**: whenever a change is finished and its checks pass.
- **Author and committer:** whoever owns the checkout, from its git config. Never pass `--author`, set `user.name` or `user.email`, or write a name here.
- **Beads hook:** the beads `prepare-commit-msg` hook, which adds agent trailers, was removed on purpose. Never reinstall it.
- **One commit per finished change**, with only that change's files. Other work in the tree stays uncommitted. Include `.beads/interactions.jsonl` when it changed.
- **Land commits on main with `scripts/land.sh`:**
  - In the main checkout, which several sessions share, run `scripts/land.sh -m "<message>" -- <paths>`. It commits those paths as they are on disk through an index of its own, then updates the shared index for them.
  - It takes whole files: name files, not folders, and compare `git diff <file>` with what you wrote first. When another session's edits are in a file too, message that session rather than landing them.
  - In a worktree, commit there and run `scripts/land.sh`, or pass it `-m` and paths the same way. It fast-forwards the main checkout, and refuses when the commits change a file someone is editing there.
  - Then `git push origin main`.
  - Never move main any other way:
    - a plain `git commit` in the main checkout takes in what other sessions staged;
    - `git update-ref` or `git branch -f` on main, or a `GIT_INDEX_FILE` left exported, leaves the main checkout's index and files behind main, where its new commits show up as staged reverts.
- **A fix on a release branch is always forward-merged:** merge the branch with `git merge` into every newer release branch and then into main, in a worktree, keeping main's version number, and land the merge commit with `scripts/land.sh`. Don't cherry-pick or port it instead: the next merge would bring it again and conflict. If main moves before the merge lands, merge again on the new main: a rebase, which `scripts/land.sh` suggests, drops the merge. The work isn't done until main holds it.
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
scripts/e2e.sh [e2e/<spec>.spec.ts ...]   # e2e on this machine, 6 workers on macOS (4 elsewhere), from a copy of the tree
scripts/linux-test.sh      # type check, unit and e2e tests in Ubuntu via Docker
scripts/test-spec.sh e2e/<spec>.spec.ts   # just those specs, in Docker
```

- **Run e2e with `scripts/e2e.sh`:** it copies the files git tracks or would add into a temp folder and runs Playwright there, with its own test-results. Any number of runs, yours and agents', go at once, and the checkout can be edited while they run. The copy stays only when a test failed, for its traces, the test hosts' logs (`host-logs/`) and `results.json`. The release gate runs a red run's failed spec files again alone at one worker: when they pass it goes on, calling them flakes in their beads; otherwise it stops. It files a bead for each failed test, or adds to the one it filed before. Unit tests go the same way: the gate runs their files in parallel, and a red run's failed files again one after another. Playwright arguments pass through, e.g. `--workers=1`.
- **`bunx playwright test` runs from the checkout itself:** its hosts pick up edits to `web/` and `host/` mid-run, and two such runs wipe each other's test-results. Keep it for retaking the README screenshots (`MIRADOR_SCREENSHOTS=1`), which it writes into `docs/`.
- **E2E hosts take free ports:** `new TestHost()` takes four ports in a row in 20000–31999 at its first start (its own, canvas assets, and two for the network) and keeps them across restarts. Read `host.port` and `host.origin` in hooks and tests, not as the spec loads; an `environment` that depends on the port is a function of it. mirador-mobile's e2e uses 5800 and up.
- **E2E pages are English through the browser locale:** Mirador follows the browser's language unless one is chosen in Settings, and `playwright.config.ts` sets `en-US`. A spec that sets another locale gets that language, where `signIn` (which waits for English text) times out: open `host.authUrl` itself.
- **Serial specs:** run the whole file, not `-g`.
- **Canvas selectors need `:visible`:** each kept conversation keeps its canvas in the page, hidden, so `.canvas-panel` and `.canvas-frame` can match several, and `[data-pane="canvas"]` matches the canvas pane while it is hidden. Reviews and tours draw in the code review plugin's frame: reach them with `walkthroughView(page)` from `e2e/helpers.ts`.
- **Real Claude replies:** specs that wait for one get it from the owner's model server, never a Claude login: `LLM_SERVER_URL` and `LLM_SERVER_KEY`, exported or in `~/.config/mirador/e2e-model-server.env` (mode 600), natively and in Docker alike. Without them those specs fail. Each test host gives Claude Code its own `CLAUDE_CONFIG_DIR`, so e2e sessions stay out of `~/.claude`; only `usesClaudeLogin` hosts use it. The model server wins over an `ANTHROPIC_BASE_URL` the run inherits, but a spec that sets its own keeps it. Two `linux-test.sh` full-suite runs can't overlap (shared results dir).

## Architecture Overview

Mirador is a localhost web app that drives coding agents (Claude Code through `claude-agent-acp`, opencode, pi through a patched `pi-acp`, and Codex through `codex-acp`) over ACP, and gives them a canvas with the `show` and `ask` tools, plus the tools of canvas plugins, such as `review`, `tour` and `checklist` from the plugins it installs by itself (`plugins/defaults.json`), whose code lives in their own repos.

- **`host/`** is the Bun server:
  - the ACP client, with one agent process per profile and many sessions on it;
  - the canvas MCP server, which each session gets through `session/new`;
  - terminals;
  - the SQLite store in `~/.mirador`;
  - device invites for remote machines.
- **`web/`** is the React UI, bundled by Bun. It talks to the host over one WebSocket. Messages are typed in `shared/protocol.ts`.
- **`shared/`** holds the types and logic both sides use.
- **`desktop/`** is the Electrobun tray app that wraps it.
- **`site/`** is the website, mirador.sodre90.com. Its `index.html` and `privacy.html` are templates whose text is in `site/words/`, one dictionary per language typed against English; `bun scripts/build-site.ts` renders English at the root and each other language in its own folder, with the README's screenshots, and `.github/workflows/site.yml` publishes it; `e2e/site.spec.ts` checks it.
- **`e2e/`** holds the Playwright specs. Their helper hosts are in `e2e/test-host.ts`. **`tests/`** holds the unit tests.

## Conventions & Patterns

- **Names over comments.** Keep comments for a genuine "why" that a name cannot carry.
- **Tests come with every change.** Every user-visible change gets e2e coverage, and logic gets unit tests.
- **UI text is translated:** English in `web/i18n/en/`, Hungarian in `web/i18n/hu/`, Spanish in `web/i18n/es/`, Simplified Chinese in `web/i18n/zh/` and German in `web/i18n/de/` (typed against English, so a missing key fails `tsc`), read through `t` from `web/i18n/index.ts`. Tooltips are `hints` there. New text goes into every language, on the website too (`site/words/`); `shared/i18n/GLOSSARY.md` holds the terms of each. Text for agents, the voice model or spoken commands stays English.
- **UI wording:** plain words and sentence case.
- **Secrets:** never print the `/auth?token=…` link, tokens or profile environment values. Host logs contain them, so filter `auth?token` out of anything you show.
- **The owner's own Mirador runs from this checkout.**
  - Host changes take effect after a restart (`⌘⇧R`). Leave the restart to the owner: it stops the turn that triggered it.
  - The real database `~/.mirador/state.sqlite` is read-only for agents. Work on a copy.
