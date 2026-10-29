# Mirador

**See what your coding agent means.**

Mirador runs your coding agents (Claude Code, opencode and pi) and gives them a **canvas** beside the conversation. On the canvas they draw what they mean, ask you with pictures, walk you through code, and hand you code reviews you can walk through. It runs on your own computer, with your own agent settings.

[![The trailer: no more walls of text, your agent draws now. A chat transcript crossed out beside a checkout sequence diagram on the canvas](docs/screenshots/trailer.jpg)](https://youtu.be/VmlHwR-yV4I)

▶ [Watch the trailer](https://youtu.be/VmlHwR-yV4I) (1:37) · [Website](https://mirador.sodre90.com/)

```bash
curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh
```

That installs the desktop app on a Mac with Apple Silicon, or on Linux (x64 or arm64), and starts it. On Windows (x64, experimental), `irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex` in PowerShell does the same. It runs the Claude Code, opencode or pi you already have. [More ways to get it](#get-it).

*A mirador is a lookout: the place you climb to see the whole landscape at once.*

## Why Mirador exists

Coding agents changed the pace of our work. In a few minutes an agent reads a codebase, changes ten files and explains what it did in a long stream of text. Writing code is no longer the slow part. **We are**: reading what the agent did, understanding it and reviewing it fast enough to stay in control.

And we do that reading in a terminal. A terminal is a wall of text scrolling by: tool calls, diffs and explanations, all in one font, all at the speed the agent types. But people understand pictures far faster than text. A sequence diagram explains a request path at a glance, where the same in prose takes a page. A mockup settles a layout question in a second, where three paragraphs describing the options don't.

Mirador was born from that gap. It keeps everything that makes a coding agent powerful (the real Claude Code, opencode and pi, with your own settings, hooks, extensions and MCP servers) and gives the agent a canvas next to the conversation:

- **It shows you** what it means: architecture, flows, data, mockups, charts, even 3D scenes, instead of describing them.
- **It asks you** with pictures: two to eight options, each with a preview, and you click one.
- **It walks you through code**: how something works, or what it just changed, as a tour of the code in the order it runs, with the changed lines marked.
- **It hands you a review** to walk through: the change as a guided tour of the code in the order it runs, with findings pinned to the lines they are about, ready to post to the pull request.

Understanding gets faster. Reviewing gets far, far faster. And you stay the one who decides.

**Mirador is a tool for developers, built by a developer**, to make our lives easier in the AI era: the agents are fast, and this is how we keep up with them.

## The four ideas

### Show: the agent draws what it means

![A conversation about a checkout flow, with the agent's sequence diagram on the canvas beside it](docs/screenshots/canvas.png)

The agent renders a page on the canvas: a diagram, a mockup, a chart, a comparison, a 3D scene. Pages are self-contained HTML in a sandbox, with Mermaid, D3 and three.js built in and working offline. If a page throws a script error, the agent is told and fixes it. Every page stays in the conversation's canvas history.

### Ask: questions you answer with a click

![The agent asks which settings layout to build, with a phone mockup preview for each option](docs/screenshots/ask.png)

Instead of a numbered list of options in text, the agent asks on the canvas: a question, an optional page explaining it, and up to eight options with a preview each. You click one, or type your own answer when the agent allows it, and add a note if you like. Several questions come at once, a page each, with a review before you send. The answer goes back to the agent, either as the tool's result or as your next message.

### Tour: the agent walks you through code

![The agent's tour of its fix: the steps on the left, the changed line of src/checkout.ts marked on the right](docs/screenshots/tour.png)

Instead of a long summary in text, the agent walks you through the code on the canvas: how something works, or what it just changed. A tour is a short summary and steps in the order the code runs, each with its lines. When it shows a change, the changed lines are marked and a *Files* tab holds the diff. Ask the agent about any lines, or open them in IntelliJ IDEA.

### Review: a guided tour of the change

![A code review open on its flow tour: the steps beside the current step's explanation, and the diff below them with the step's lines marked](docs/screenshots/review-flow.png)

The agent publishes its code review as a page you work through, not a wall of comments:

- **Overview**: the verdict, the summary and the findings by severity.
- **Flow**: a tour of the change in the order the code runs, one step at a time, with the lines marked.
- **Files**: every diff, with syntax colours.
- **Findings**: pinned to their lines. Each shows its severity and whether the agent confirmed it or only suspects it.

Keep or drop each finding, reword it, ask the agent about any lines, and open them in IntelliJ IDEA. Then post the findings you kept to the GitHub pull request as your pending review.

![The review's findings tab: a blocker, an issue and a nit, each with its lines](docs/screenshots/review-findings.png)

## Get it

Mirador runs on **macOS** (Apple Silicon), **Linux** (x64 and arm64) and **Windows** (x64, experimental), and in any browser on your network. Android and iOS apps are coming.

### The desktop app

```bash
curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh
```

The script downloads the latest release for your computer, installs it and starts it. Run it again to update.

- **macOS** (Apple Silicon): the app goes where it already is, else in `~/Applications`, which needs no admin rights. Quit a Mirador running from there first.
- **Linux** (x64 or arm64): the app needs glibc 2.36 or newer (Ubuntu 24.04, Debian 12, Fedora 37 or later), and the script says so on an older system. The libraries the app needs (GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg) are installed first, with `sudo apt-get` or `sudo dnf`; on other distributions the script names them. The app goes in `~/.local/share/com.sodre90.mirador`, with an entry in your applications menu.

**Windows** (x64, experimental), in PowerShell:

```powershell
irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex
```

The app goes in `%LOCALAPPDATA%\com.sodre90.mirador`, and starts. To run the script again, quit Mirador from its tray icon first, with *Run host in the background* off.

The app carries Mirador and the Bun it runs on, so it doesn't require Bun or a checkout. It runs the agents you have installed: Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`, or `irm https://claude.ai/install.ps1 | iex` on Windows), opencode and pi (`npm install -g @earendil-works/pi-coding-agent`, on Node 22.19 or later). The script tells you when none of them is there.

**With Homebrew**, on macOS or Linux:

```bash
brew install --cask sodre90/tap/mirador
```

The app updates itself, so `brew upgrade` leaves it alone. On Linux, Homebrew doesn't install the libraries the app needs; it prints the `apt` and `dnf` commands for them. `brew uninstall --cask mirador` quits the app and removes it (on Linux, turn off *Run host in the background* first), and `--zap` also removes its window's data. Your conversations in `~/.mirador` stay.

**By hand**, from the [releases](https://github.com/sodre90/mirador/releases):

**macOS**: `Mirador-macos-arm64.zip`. The app is signed with a Developer ID and notarized by Apple:

```bash
ditto -x -k Mirador-macos-arm64.zip ~/Applications
open ~/Applications/Mirador.app
```

**Linux**: `Mirador-linux-x64-Setup.tar.gz` or `Mirador-linux-arm64-Setup.tar.gz` (`uname -m` says which). It needs glibc 2.36 or newer (Ubuntu 24.04, Debian 12, Fedora 37 or later), GTK 3, WebKitGTK 4.1 and the Ayatana AppIndicator library ([details](desktop/README.md#install-on-linux)):

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2   # Debian, Ubuntu
sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2              # Fedora
mkdir mirador-setup && tar -xzf Mirador-linux-*-Setup.tar.gz -C mirador-setup && mirador-setup/installer
```

The installer starts Mirador, and puts it in your applications menu.

**Windows**: `Mirador-windows-x64-Setup.zip`. Extract it and run `Mirador-Setup.exe`. The app is not signed yet, so SmartScreen warns when the installer first runs: *More info*, then *Run anyway*. The installer installs without a click, then waits at "Installation complete" for *Close*, and starts Mirador.

**Signing in**: Mirador runs the `claude` on your PATH (or in `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`; on Windows in `%USERPROFILE%\.local\bin`), or the program set in *Settings › Agents*, so it uses the sign-in and version you already have. Without a sign-in, a conversation offers *Log in*, which opens that Claude Code's own sign-in in a terminal tab. For opencode, install [opencode](https://opencode.ai) and Mirador finds it. For pi, install it (`npm install -g @earendil-works/pi-coding-agent`) and Mirador finds it on your `PATH`; *Log in* opens pi itself in a terminal tab, where `/login` signs in.

### From source

```bash
bun install
bun start
```

Open the `http://127.0.0.1:4600/auth?code=…` link the host prints; it signs one browser in with a cookie, works once, and expires after 10 minutes. `bin/mirador sign-in` makes a new link for the next browser. Ctrl+C stops the host, and the agents with it.

### On Windows

Windows support is new and experimental: expect rough edges, and please report what breaks in an [issue](https://github.com/sodre90/mirador/issues).

- **Shells**: as Claude Code does, Mirador runs `!` commands, the status line, the pre-launch command and the sign-in tab in Git Bash (`CLAUDE_CODE_GIT_BASH_PATH`, else where Git is installed), or in PowerShell when there is no Git Bash. Terminal tabs open PowerShell: PowerShell 7 when it is installed, else Windows PowerShell.
- **The `mirador` command**: PowerShell and cmd run `bin\mirador.cmd`, and Git Bash runs the `bin/mirador` script beside it; to run `mirador` from a checkout, put its `bin` folder on your PATH. `mirador.cmd` goes through cmd, which reads `&`, `%…%` and `"` in its arguments as its own, so a PowerShell script the agent runs pipes such text in instead, as UTF-8 for accents and symbols:

  ```powershell
  $OutputEncoding = [Text.UTF8Encoding]::new($false)
  'Build done: 3 warnings & 1 "flaky" test' | mirador message
  ```

  In Git Bash, any text arrives as typed.
- **The data folder**, `%USERPROFILE%\.mirador`, is kept to your account, SYSTEM and Administrators at every host start, as `chmod 700` keeps it to you on macOS and Linux. Access someone gave the folder itself stays, and the host warns about it when it starts.
- **Before you uninstall**, turn off *Run host in the background* and *Open at login*: uninstalling doesn't remove them yet.

## Everything Mirador does

- [The canvas](#the-canvas)
- [Questions](#questions)
- [Edit approvals](#edit-approvals)
- [Code tours](#code-tours)
- [Code review](#code-review)
- [Conversations and agents](#conversations-and-agents)
- [The message box](#the-message-box)
- [Voice](#voice)
- [The transcript](#the-transcript)
- [Sidebar and workspaces](#sidebar-and-workspaces)
- [Layout](#layout)
- [Find and search](#find-and-search)
- [Terminals](#terminals)
- [Jobs left running and messages from scripts](#jobs-left-running-and-messages-from-scripts)
- [Notifications and waiting for you](#notifications-and-waiting-for-you)
- [Devices, other machines and the network](#devices-other-machines-and-the-network)
- [Settings](#settings)
- [Keyboard](#keyboard)
- [The desktop app](#the-desktop-app-1)
- [Working on Mirador in Mirador](#working-on-mirador-in-mirador)
- [Security](#security)
- [Command line and environment](#command-line-and-environment)

### The canvas

![The Changes view on the canvas: the uncommitted files of shop-api, the agent's edit of src/checkout.ts marked and open under its row](docs/screenshots/changes.png)

- **`show`**: the agent renders a page next to the conversation: diagrams, mockups, charts, comparisons, 3D scenes.
- **Libraries built in**: three.js (with OrbitControls), D3 v7 and Mermaid load from Mirador itself, so pages work offline.
- **Script errors come back**: the agent hears either "rendered without script errors" or the list of errors, and can fix its page.
- **Pages follow the theme**: a page is light when Mirador is light and dark when it is dark, from its first paint, and changes with the theme without reloading. Agents are told to colour their pages with `light-dark()`.
- **Changes**: *Changes* in the canvas bar lists the files this turn changed, this conversation changed, or the workspace's uncommitted work (*This turn*, *This session* or *Uncommitted*), and marks the ones the agent's edit tools changed. Files outside the project the agent edited are listed apart. *All files* shows every file of the project in its folders with the changed ones marked, and only the folders holding a change start open; *Tree* shows just the changed files in their folders, and *List* each with its whole path. A folder holding just one folder shares its row with it, and a click folds a folder to its count and line totals; *Fold all* folds them all. An unchanged file opens with *Open in IDEA*. Click a file for its line changes right under its row, Unified or Split, and *Open in IDEA* at its first change. The list shows at once when you come back to it, and refreshes as the agent works.
  - *This session* lists every file the agent's edit tools changed in this conversation, even where a later turn changed it back, and the files written while its commands ran, build output included, and the files of the commits they made.
  - In a folder that is not a git repository, *This turn* lists the files written since the turn began, a script's included, along with the agent's edits. Mirador checks up to 50,000 files there, and says when a folder holds more.
  - Changes leaves out the folders beads, Dolt and IntelliJ IDEA keep their own state in.
- **Export** (*Export ▾* in the canvas bar): copy the page as an image or as HTML, download it or save it to the project, or ask the agent to write it as Markdown, in the chat or as a file in the project.
- **As you left it**: coming back to a conversation brings its canvas back as it was, with *Changes* still open or the page still shown.
- **History**: everything shown or asked is kept per conversation, across reloads and restarts. *Older* and *Newer* step through it, and *History* lists it newest first, with each question's outcome. *Clear* empties the canvas without deleting anything.
- **Hide, show and full screen**: the canvas keeps receiving pages while hidden.
- **Claude Code and pi use the canvas** (*Settings → Canvas*): *As needed*, or *Often* (the default), which adds guidance to Claude Code's and pi's system prompts, such as ending a larger coding task with a tour of what changed. The canvas tools are always loaded, so Claude Code's tool search never hides them. opencode follows the canvas's own instructions, without this guidance.

### Questions

- **`ask`**: a question with 2 to 8 options, each with a description and an optional HTML preview, plus an optional page explaining the question. The option the agent recommends is tagged *Recommended*.
- **Several questions at once**: up to ten in one call, each with its own options. You answer them page by page, can change any answer on a review page, and send them together. Agents are told to ask this way rather than fold several questions into one.
- **Previews are shown whole**: option columns widen to the widest preview, and a page wider than the canvas is scaled down to fit.
- **Your own answer**: when the agent allows it, *Something else…* takes a typed answer, over several lines with Shift+Enter, and every answer can carry a note. With several questions, the review page before *Submit* also takes one note on all your answers.
- **Context stays**: a page the agent showed just before asking stays above the question.
- **Two ways to answer**, chosen per conversation: *Agent waits for my answer* returns your choice as the tool's result. *My answer is sent as the next message* lets the agent end its turn, and your choice arrives later as your message.
- **Answered or withdrawn** questions leave a short note in place of the question.

### Edit approvals

- **The edit takes the canvas**: when the agent asks to edit or write a file, the change shows on the canvas with the agent's own *Allow*, *Always allow* and *Reject*. The chat keeps a small card with the `+`/`−` counts and the same buttons.
- **The file's own line numbers**: Claude Code sends only the snippet it replaces, so Mirador finds it in the file, reading only the file the request names, and shows three lines around each change. A snippet it can't find shows as sent, without line numbers.
- **Unified or Split**: a toggle switches between one column and old-beside-new; the browser remembers the choice.
- **One at a time**: several waiting edits show oldest first, with how many more wait. *Clear* or *History* sets them aside, and *N edits waiting* in the canvas bar brings them back. Once answered, the canvas clears with a short note of the answer. Edits don't go into the canvas history.
- **Or in the chat**: switch off *Settings → Canvas → Show edits waiting for approval in the canvas* to keep the diff in the chat card, as it also is while the canvas is hidden.

### Code tours

- **`tour`**: the agent walks you through code without reviewing it: a title, a summary and steps in the order the code runs, each anchored to its lines. It explains how something works, or shows what a task changed.
- **The code as it was shown**: each step's lines are read from the files when the tour is published, from gitignored files and folders outside git too, so later edits don't change the tour.
- **What the task changed**: given a git ref to count from (such as `HEAD` for uncommitted work), the steps mark added and removed lines, and a *Files* tab shows the diff, new files included. Mirador keeps the files the tour was made from in the folder's git repository, under refs of its own, so *Show the rest of the file* works on older tours too, for each repository's newest 100 tours; your branches, history and staging area are untouched.
- **Checked before shown**: wrong anchors send the whole list of problems back to the agent, and nothing is shown.
- **Read it like a review**: the Overview with the summary, the Flow one step at a time, and the Files; ask the agent about any lines or open them in IDEA, with the same keys. There is no verdict, findings or posting.
- **When the agent makes one**: with *Often*, Claude Code ends a larger coding task with a tour of what it changed instead of a summary page. With *As needed*, when you ask, or when it explains how code works.

### Code review

- **`review`**: the agent publishes a review of `base...head` in a checkout, like a pull request: a title, a verdict, a summary, a tour of the code flow and findings. The diff comes from git, so the agent never pastes code.
- **Checked before shown**: anchors outside the diff, or unknown conversations, send the whole list of problems back to the agent, and nothing half-wrong is shown.
- **Full screen or beside the chat**: *Settings → Plugins → Code review → Open reviews* sets the default for every browser, and a button switches it. A new review brings a hidden canvas back.
- **Overview**: verdict, `+`/`−` counts, commit range, the summary (Markdown, tables included), the flow as a list and the findings by severity.
- **Flow**: the tour in the order the code runs, one step at a time, with the step's lines marked. ←/→ move between steps.
- **Files**: a filter box, the tour's files first, every diff with syntax colours, and the lines between changes shown 20 at a time or all at once.
- **Findings**: severity (blocker, issue, question, nit) and *✓ confirmed* or *? plausible*. *How it was checked* holds the agent's evidence, which is for you and is never posted.
- **Curate**: keep or drop each finding, reword it, ask the agent about it, or open it in IDEA.
- **Ask about any lines**: click line numbers (Shift+click extends), then `a` asks the agent with the code attached and `o` opens IDEA at that line. *Ask and update the review* (⌘Enter) has the agent republish when its answer changes anything.
- **Post to GitHub**: kept findings become comments on your pending review on the pull request, through `gh` (GitHub Enterprise too). You submit it on GitHub. Findings outside the pull request's diff stay in the review, marked as such, and GitHub refusals are reported per finding.
  - Posting needs the [GitHub CLI](https://cli.github.com) installed and logged in to the pull request's host: `gh auth login --hostname <host>`. Mirador uses the account gh has active there, so a work GitHub Enterprise and your personal github.com each post as their own account.
  - The Post panel checks this when it first shows. If gh is missing or not logged in, it says what to run and leaves Post off until *Check again* finds gh ready.
  - Reviews of a local branch, and of a pull request with findings only, are shown without gh. Answering the pull request's conversations reads them through gh, so it needs gh too.
- **Updates in place**: when you ask about a finding, the agent changes only what its answer changes: a comment's wording, severity or lines, a finding added or taken out, an answer, the tour, the summary or the verdict. You stay on your tab and finding, your choices stay, and each changed part flashes once. A comment you are editing takes the agent's rewording until you type; after that your draft stays, with the agent's version under it and *Use its wording*.
- **Re-review**: when the code under review changed, the agent publishes the whole review again. That keeps your keep/drop choices and rewordings, and the agent is told which findings you dropped or already posted.
- **Answer the pull request's conversations**: on a re-review the agent can reply to existing review threads, shown as GitHub has them (outdated, resolved). You keep, edit or drop each answer, and choose *Resolve when posted*.
- **Keys**: `1`–`5` tabs, `j`/`k` changes, `n`/`p` findings, `f` files, `a` ask, `o` open in IDEA.

### Conversations and agents

- **Claude Code, opencode and pi** over ACP, in the workspace's folder, with your normal settings: Claude Code with `~/.claude` (settings, hooks, MCP servers; claude-notifier is muted for Mirador's sessions), opencode with `~/.config/opencode` (providers, agents, plugins, MCP servers, and its permission settings: Mirador forces nothing, so with opencode's defaults most tools run without asking). opencode is found on `PATH`, else in `/opt/homebrew/bin`, `/usr/local/bin` or `~/.opencode/bin`. pi with `~/.pi/agent` (settings, models, extensions, skills), through [pi-acp](https://github.com/svkozak/pi-acp), which Mirador carries; pi is found on `PATH`. pi support is new and experimental.
- **Profiles** (*Profiles…*): an agent plus the environment it starts with, e.g. Claude Code through a work gateway or a local llama.cpp server, or opencode with another config (`OPENCODE_CONFIG=…`, or inline `OPENCODE_CONFIG_CONTENT='{…}'`), or pi with another agent folder (`PI_CODING_AGENT_DIR=…`) or another pi (`PI_ACP_PI_COMMAND=…`).
  - Every conversation runs on a profile. On first start Mirador offers one filled in: an installed agent as it is set up on this machine, with an empty environment. Conversations from before profiles move onto such a profile per agent.
  - The last profile stays until you create another; the workspaces of a deleted profile move to another one.
  - A profile can take a colour. A dot in it goes before the profile's name on a workspace's chip, in a conversation's header and in the statusline, and its conversations get an edge of it in the sidebar, so a workspace or conversation on the wrong profile stands out.
  - Environment lines are `KEY=value`, `-u KEY` and `# comment`, so the lines of a `claude_env=( … )` alias paste as they are.
  - An optional pre-launch command can start a proxy first; if it fails, you see its output.
  - Each profile has defaults for mode, effort, YOLO and questions, its own agent process and its own log (`logs/<agent>-<name>-<id>.log`). Saving a profile with a changed environment or pre-launch command restarts its agent.
  - Profiles, including their tokens, are stored in the SQLite database with owner-only permissions. Secrets are masked on screen.
- **Switch profile mid-conversation** (*Profile* in the conversation's header, even after the profile was deleted): the new profile's agent resumes the same session, on that profile's default model. pi keeps the session's own model when the new profile has it. Switching while the agent works stops the turn, and once the session is back the agent continues where it left off. A profile that keeps sessions elsewhere (another `CLAUDE_CONFIG_DIR`, or opencode's `XDG_DATA_HOME`) starts a fresh session instead. pi goes on in the same session even with another `PI_CODING_AGENT_DIR`: pi-acp finds its sessions through a map of its own in `~/.pi/pi-acp`. Until the first message, the menu also offers the other agents' profiles, and picking one moves the conversation to that agent; after that they show greyed out, for a new conversation.
- **Every agent option** in the header: model, mode, effort and whatever else the agent offers. Lists of more than 20 choices get a search box (opencode has 500+ models).
- **Plugins' profile settings** in the header, such as the delegate plugin's *Delegate to*: *Profile's* follows what the profile sets, and another choice holds for that conversation only, until it switches profile. The agent hears of a change with your next message. A conversation a plugin started, such as a delegated task, shows none.
- **YOLO** (off by default): Mirador approves every permission request of that conversation without asking, including requests already waiting. Claude Code's own *Bypass permissions* mode is separate.
- **Continue…** (in each workspace's card) lists the sessions the agent recorded for that folder, including ones started in a terminal, and replays the chosen one into a new conversation. *Continue* keeps the same session; *Fork* copies it.
- **A session still open in a terminal** is flagged (header badge, sidebar dot, a note above the message box), with what it is doing there: working, waiting for you, or idle. Mirador reads this from Claude Code's session registry (`~/.claude/sessions`, or the profile's `CLAUDE_CONFIG_DIR`). The turns you take in the terminal join the conversation once the terminal is idle, and the agent goes on from them.
- **Status**: idle, starting, running or error, with what each means on hover.
- **Stop**: Esc in the message box, or the Stop button. When the agent hasn't stopped within a few seconds, the button becomes *Force stop*, which ends the agent's process; other conversations on the same profile go on.
- **Rewind to here** (Claude Code and pi): hover one of your messages. That turn and every turn after it leave the conversation, the agent goes on in a session that holds only what came before, and in a git repository the files go back to how they were when the turn began. The palette offers it too.
- **Undo files**: puts the workspace's files back to how they were before a turn began, and keeps the conversation; the agent hears about it with your next message. It's on the message for opencode, and in the palette for every agent. Mirador keeps the files of each workspace's newest 100 turns in the workspace's git repository, under refs of its own, so your branches, history and staging area are untouched. A submodule that changed stays as it is, and the dialog says so. In a workspace below its repository's top, only that folder's files go back.
- **`/clear`** starts the agent afresh while the transcript stays on screen. It works queued, and across restarts.
- **Log in again**: when the agent's sign-in expires, *Log in* (or `/login`) opens the agent's own sign-in in a terminal tab, with the conversation's profile.
- **Usage limits**: when Claude's usage limit is reached, queued messages wait, and Mirador asks the agent to continue about a minute after the limit resets (at most twice in a row). *Continue now* and *Stop waiting* are there too. It survives a host restart.
- **Rename**: click the title in the header, double-click it in the sidebar, or *Rename conversation…* in the palette. A name you choose sticks; otherwise the title is your first message until the agent names the session.
- **Delete** with a two-click confirm; deleting while the agent works ends the turn quietly.
- **Nothing is lost**: conversations survive reloads and host restarts, and the agent's session resumes.

### The message box

- **Images**: paste or drag them in; each lands as `[Image #n]` where the caret is, and shows as a chip while it uploads. Deleting the marker drops the image, and a pasted image you never send is deleted from the host.
- **`@` paths**: completes workspace files, folder by folder, as well as absolute and `~` paths, anywhere in the message.
- **`/` commands**: the agent's commands plus Mirador's `/clear` and `/login`. Tab writes one out, Enter runs one that takes no arguments, Esc closes the list.
- **Claude Code's panels**: `/plugin`, `/hooks`, `/permissions`, `/memory`, `/status`, `/help` and the other commands Claude Code shows only in its own terminal open a terminal tab running Claude Code with the conversation's profile.
- **Edit a stopped message**: press ↑ after stopping an answer. Enter replaces the message, its answer and the files it changed; Esc keeps them, and your edit goes out as a new message after them.
- **`!` shell commands**: run in the workspace's folder with your login shell. The output shows inline with Run/Stop, and goes to the agent with your next message unless you drop it.
- **Prompt history**: ↑/↓ step through earlier messages, this conversation's first and then the workspace's, images included.
- **Prompt templates** with `{{parameters}}`: *Templates* sends one or inserts it, with a form for the parameters. Or press `⌘J` in the message box: typing narrows the list, Enter puts the template in at the caret with its first value selected, and Tab / Shift+Tab go through its values. Add, edit and delete them in *Settings → Conversations*; *Deep PR review*, *Start on a ticket* and *Code tour* come with Mirador, and a template added to Mirador later shows up once on an existing install too.
- **Queue while the agent works**: with Claude Code and pi each message either joins the running turn (steering: at once, or once the tools it runs finish) or waits until after the turn; Enter and ⌥Enter pick, and Settings can swap them. opencode can't be steered, so its messages wait. Drag queued messages to reorder them, *Edit* one back into the box, or press ↑ in an empty box to pull back the last. The queue lives in the database, so it survives reloads and restarts.
- **Drafts**: text and images are kept per conversation.
- **Resizable**: drag the box's top edge; double-click resets it.
- **macOS keys**: fn+←/→ go to the start and end of the line; spelling autocorrection and inline predictions are off by default and can be switched on.

### Voice

- **Dictate**: the mic button beside the message box, or `⌘⇧Space` anywhere in the window, also while a canvas page has focus. A tap listens until you pause or tap again, a hold until you let go, and Esc cancels. What you said goes in at the caret, or is sent at once with *Send right away*. It works in the desktop app, which asks for the microphone once, in a browser, and in another machine's Mirador in the rail, through that machine's speech recognition.
- **Any language, in English**: the voice model translates what you said into English, keeping code, file names and commands as they are, and *You said:* under the box shows your own words. Naming the language you speak helps on short clips. Turn *Translate into English* off to keep what was heard as it is.
- **Spoken replies**: after a message you dictated, the voice model sums the reply up in one to three sentences and reads them aloud as the turn ends, in the browser you dictated in. With a reply voice set, every reply has a button that reads it, and hearing it again starts at once, in the same words. Replies are read in English or Hungarian, whatever language the agent wrote in.
- **Keep talking**: with it on, once the reply to what you dictated has been read aloud, the microphone opens again with a rising chime, and what you say next is sent right away, with a falling chime once it has heard you, so a conversation goes on without the keyboard. While the agent works, a clock goes tick-tock every 15 seconds, and two low tones tell when the page loses the host. Esc, two minutes of quiet, or saying *stop* or *thanks* ends it, and *repeat that* reads the last reply again, in the same words; said on their own, in English or translated into it, neither goes to the agent. Only the part that sounded like speech goes to speech recognition, and what it makes up from noise, such as "Thanks for watching!", is not sent: the microphone listens on.
- **Questions by voice**: in Keep talking, a question the agent asks on the canvas is read aloud. With an option the agent recommends, that one is read in full first: say *yes* to take it, or *the others* to hear the rest by number. A number ("the second one") or an option's words choose one; anything else goes to the agent as your answer, marked as said aloud, so it can make sense of it or ask again, even for a question the canvas offers no box of your own for. Several questions are asked one at a time and sent together.
- **Words Mirador takes itself**: *stop* (or *that's all*, *thanks*) ends the conversation, *repeat that* says the last thing again, and *help* says what you can say. While the microphone listens, the line under the message box shows them too. "Hmm", "um" or "well" on their own aren't sent: the microphone listens on while you think.
- **Voice on this Mac** (Apple silicon, macOS 14 or later): *Settings → Voice* sets up a speech engine in `~/.mirador/voice`, and nothing you say leaves the Mac. Whisper large-v3 turbo hears you; a Gemma 4 voice model translates and sums up, from those that fit in half the Mac's memory (E4B, 12B or 26B-A4B); Kokoro reads English replies, and OmniVoice Hungarian ones, under a licence that allows only non-commercial use. A model loads when first needed, in 5 to 15 seconds, and unloads after 30 minutes unused. *Models on this Mac* lists what is on disk, and removes what you no longer use.
- **Servers of your own**: each part can be an OpenAI-style server instead: speech recognition (`/audio/transcriptions`), the voice model (`/chat/completions`) and the reply voice (`/audio/speech`, with one of its voices). The voice model can also call a profile's Anthropic or OpenAI API with its keys, without starting its agent. On Linux and Windows, voice uses these.

### The transcript

- **Grouped by author**, with avatars and times. Point at a line for its time, or switch on *Show timestamps* for every line.
- **Markdown** with tables, links that open in a new tab, and code blocks with a *Copy* button.
- **File links**: a file path the agent writes in backticks, and each file in a tool card, opens the file with the system's default program, on the machine Mirador runs on, if it is in the workspace or the agent changed it. A script opens as text, in the system's text editor or a program named in *Settings → Conversations → File links*, since the program for its type could run it. A program, or a link that leads to one, opens nothing.
- **Thinking** (folded), the agent's **plan** as a checklist, mode changes, turn ends and errors.
- **Permission requests** show the tool and its command, with the agent's own allow and reject options, and the outcome afterwards. Edits show on the canvas (see [Edit approvals](#edit-approvals)).
- **Tool calls** with diffs for edits, raw input and output a click away, and readable MCP tool names.
- **Shell commands** look like a terminal. *Settings → Appearance → Shell commands* picks how much shows: the command with its output a click away, the command with its output open when it failed, one line, or the command and its output.
- **Subagents** nest under their Agent card, which shows the prompt each got. While they work, a count shows in the header and a strip above the message box says what each is doing ("now: Read", elapsed time), with its model and tokens; a click opens its latest work.
- **Images** show inline, also in replayed sessions and the agent's replies; click for full size.
- **Long conversations** load the newest 200 entries and the earlier ones as you scroll up. Switching between recent conversations is instant and keeps your scroll position, and resizing panes keeps your place.
- **Statusline**: git branch, model, context used (tokens and share of the window), your plan's 5-hour and weekly usage and when each starts over (each meter turns amber past 75% and red past 90%), cost and profile. Or, in a Claude Code conversation, run your own Claude Code `statusLine` command, exactly as Claude Code would; opencode and pi conversations keep the built-in one.

### Sidebar and workspaces

- **Workspaces** are project folders (*Add workspace*, Tab completes paths), each a card with new conversations on top and *+ New* at the bottom. A path that isn't there yet, in a folder that is, makes a new folder; when its name begins an existing folder's, which Enter would take, ⇧Enter or *+ New folder* makes it. ⇧Enter always adds the path as typed. The chip beside *+ New* chooses the profile for new conversations, and each workspace remembers it. With more than one profile, adding a workspace asks which one its conversations start on, with none picked, so pressing Enter twice can't skip the choice. Removing a workspace never touches its files.
- **Drag to reorder** workspaces (by their heading), groups (by theirs) and conversations (within their workspace). Workspaces outside a group and the groups share one order, so a workspace can sit between two groups or below them. New workspaces, groups and conversations go first. Every window and reload keeps the order.
- **Groups**: ⊞ next to + adds a group, e.g. per project or client, named in place. Drag a workspace by its heading into a group, out of it or within it: dropped on the top edge of a group's heading it lands above the group, and lower on the heading last in it, folded or not. A group's workspaces are indented a little. Hover a group's heading to rename or delete the group; its workspaces stay where it was. A group folds to its heading, which then counts what waits in it; opening a conversation in a folded group unfolds it. The palette has *New group…*, and moves a workspace into a group or out of its own, to just below it. Every window keeps the groups; folding is per browser.
- **Colours**: eight pastels, picked from the workspace's initials badge or the palette, drawn as a tinted card, a heading or an edge stripe.
- **Waiting marks**: *Needs you*, *Done* and *Failed* (see [Notifications](#notifications-and-waiting-for-you)). When waiting conversations are scrolled out of view, a chip at the sidebar's top or bottom edge says so; a click shows the nearest.
- **Devices connected**: a line at the bottom says how many devices are connected; it can be switched off.
- **Resizable**, remembering its width; double-click restores it.

### Layout

- **Three panes**: conversation, canvas and terminals, in six arrangements. Drag a pane's grip onto another to swap them, or pick *Swap* in the palette.
- **Per conversation**: each conversation remembers its arrangement, split sizes, hidden panes and full screen. *Settings → Layout* sets the default for new ones; the palette resets it.
- **Full screen** any pane (button, or double-click its bar); Esc comes back.
- **Show or hide** the canvas and terminals from the header or the palette, the canvas with ⌘\ and the terminals with `` ⌃` ``.
- **Text size** across the app, from 50% to 200%: *Settings → Appearance*, or ⌘+ and ⌘− (⌘0 resets).

### Find and search

- **⌘F** finds in the open conversation, including entries not loaded yet and folded cards, which it unfolds. It shows the match count; Enter goes to the older match and Shift+Enter to the newer. *Aa* matches case.
- **⌘⇧F** searches every conversation in every workspace, newest first, with snippets. Opening a result jumps to it with the find bar on it.

### Terminals

![Two terminals side by side under the conversation: git log on the left, git diff --stat on the right](docs/screenshots/terminals.png)

- **Each conversation's own shells**, in the workspace's folder, in tabs, each with up to four splits side by side (*Split right*) or stacked (*Split down*); drag a divider to resize. They keep running while another conversation is shown, while hidden and across reloads, every window shows the same ones, and they close when the conversation is deleted. Each tab keeps where it was scrolled to.
- **Back after a restart**: a conversation's tabs and splits come back with what their shells printed, and a new shell under that output.
- **From the keyboard and the palette**: `` ⌃` `` shows or hides them and ⌘⇧↓ focuses them; the palette also opens a tab, splits, and fills the window with the terminal. ⌘+ and ⌘− change their font size (11 to 24 px).
- **macOS keys**, the ones cmux and iTerm2 share: `⌘D` splits right and `⌘⇧D` down, `⌥⌘←→↑↓` move between splits, `⌘[`/`⌘]` go to the previous or next split, `⌘T` opens a tab, `⌘⇧[`/`⌘⇧]`, `⌘1…⌘9` and `⌃1…⌃9` switch tabs, and `⌘⇧↩` zooms the focused split (*Show all* brings the others back). In Chrome, `⌘T`, `⌘W`, `⌘⇧[`/`⌘⇧]` and `⌥⌘←→` stay Chrome's.
- **Closing**: `⌘W` closes the focused shell, and a middle click closes a tab. Either asks first while a command runs: Enter ends it, and so does `⌘W` again when `⌘W` asked; Esc keeps it.
- **Line editing** as in a macOS terminal: `⌘←`, `⌘→`, `⌘⌫`, `⌥←`, `⌥→`, and `⌘K` clears for good.
- **Find** with `⌘F` (`Ctrl+Shift+F` on Linux and Windows, where `Ctrl+F` stays the shell's) searches the focused split's scrollback. Every match is highlighted. Enter goes to the match further up, Shift+Enter further down. Match case, whole word and regular expression are toggles, as in VS Code. Esc, or `⌘W` in the desktop app, closes it and puts the cursor back in the shell.
- **Copy on select** (*Settings → Terminal*), also of a selection dragged past the terminal's edge, which scrolls the terminal as you drag. On Linux, `Ctrl+Shift+C` and `Ctrl+Shift+V` copy and paste, and `Ctrl+C` stays the interrupt.
- **On a touch screen**, a finger scrolls the output, and a quick swipe keeps it going until a touch stops it. In a full-screen program such as less or vim it scrolls as a wheel does there.
- **Nerd Font aware**, with a dark terminal in both themes.

### Jobs left running and messages from scripts

- **`mirador when-done`**: instead of polling a job it started in the background, the agent runs `mirador when-done --pid <pid> "<message>"` (or `--container <name>` for Docker and Podman, and `--host <user@host>` for a job on another machine, over ssh) and ends its turn, which then neither notifies you nor marks the conversation *Done*. When the job ends, the message arrives as your next message, so the agent carries on; with `--no-resume` only you get notified. Agents can also call the canvas server's `when_done` tool, which does the same; opencode's agents use that, as their commands carry no session id, and so do pi's.
  - Mirador checks a process every second, a container every 5 seconds and another machine every 20 seconds. Over ssh it gives up after 30 failed checks in a row, saying the job may still run. A mistyped pid or a missing container is refused at once.
  - Waits are kept in the database, so they go on after a host restart, and a job that ended meanwhile is noticed then.
  - While it waits, the conversation shows the job above the message box, with *Stop waiting*.
  - **Click the job to follow it** in a terminal tab, locally or over ssh: its command line and how long it has run, then its output file (`tail -f`) or the container's logs, until it ends. Clicking again shows the same tab. Ctrl+C closes the tab and leaves the job running.
- **`mirador message "<text>"`** (or text on stdin) sends text to the agent's conversation as your next message: at once if the agent is idle, else queued. It shows as *From a script*. It finds the conversation by the session id every command the agent runs inherits (`CLAUDE_CODE_SESSION_ID` from Claude Code, `PI_SESSION_ID` from pi), with the `MIRADOR_URL` and `MIRADOR_SCRIPT_TOKEN` Mirador gives its agents. opencode's commands carry no session id, so they, and anything else, need `--session <agent session id>`. The script token survives restarts, and unknown sessions or empty messages are refused with the reason.

### Notifications and waiting for you

- **System notifications** for a question, a permission request, a finished turn or an error, unless that conversation is on screen in a focused window. In a browser, switch them on in *Settings → Notifications*; clicking one opens the conversation. The desktop app shows them natively instead, and browser tabs on that computer then stay quiet so nothing arrives twice. Every joined device gets its own.
- **Waiting for you**: the sidebar marks each conversation whose agent waits for you. *Needs you* means a permission request or a question is unanswered. *Done* (or *Failed*) means a turn ended while you looked elsewhere, until you open it. *Settings → Appearance → Waiting for you* picks the look: a pill and a count per workspace, only a dot and a bold title, or the pills plus a list of everything waiting above the workspaces. Every window shows the same marks, and they survive host restarts. The browser tab's title counts the conversations waiting for you, and on macOS so do the desktop app's menu bar icon and its Dock icon's badge. The desktop app also shows a dot, red while a conversation needs you or failed and green while one is done: before the count in the macOS menu bar, and on the tray icon on Linux and Windows. Its menu lists the conversations waiting for you, most urgent first; choosing one opens it.

### Devices, other machines and the network

- **Devices** (*Settings → Devices*): other browsers join with an invite (*Invite a device*: a one-time code valid for 15 minutes, a link and a QR code), or ask to join and are let in by typing the number they show, on any open page or with `mirador approve`. With no page or app of the machine open, its host shows the request through `notify-send` where libnotify is installed, and the notification's *Open Mirador* signs in a browser there. The list shows which devices are connected, with how many pages each has open (or *in the background*, while only its app listens for notifications), and where they connect from, including the Tailscale login. Revoke any of them at once.
- **How other devices reach it** (*Settings → Devices*): one way at a time, and the host uses the chosen one from its next start. **At an address a proxy gives it** — *Find the address* asks each candidate whether it answers as this Mirador, on its own port and on the canvas port, and offers the ones that do: this machine's name on its tailnet, and the addresses devices have already reached it at. Where Tailscale is installed but nothing answers yet, *Expose Mirador on Tailscale* runs `tailscale serve` for both ports itself. **Over the network, with no address** — Mirador serves HTTPS itself on its own port, with a certificate authority of its own (download `mirador-ca.pem`) or your certificate (`MIRADOR_TLS_CERTIFICATE`, `MIRADOR_TLS_KEY`). Or **only on this machine**.
- **Other machines, side by side**: *Machines…* adds another Mirador computer by address or invite link. Its view opens in this window from the rail on the left, with a badge counting its waiting conversations, its notifications arriving here, and a colour of its own. A joining machine pins the certificate authority named in the invite, so a different one is refused.

### Settings

*Settings…* opens a dialog of pages (Up/Down switch between them). Each page says whether a setting is kept in this browser or on the host.

- **Appearance**: text size, theme (Light, Dark, Match system), *Waiting for you* style, workspace colours, machine colours, shell commands, timestamps. The choices come with pictures.
- **Conversations**: *Sending while the agent works* (Enter or ⌥Enter to steer), prompt templates, macOS typing aids, and the program scripts open in from file links.
- **Agents**: which Claude Code program the host runs, when not the one it finds.
- **Terminal**: font size and copy on select.
- **Canvas**: how often Claude Code uses it, and whether edits waiting for approval show on it.
- **Plugins**: the plugins you have, each with its own settings, such as where reviews open, kept on the host. The official ones, from the [mirador-plugins](https://github.com/sodre90/mirador-plugins) catalog fetched when the page opens, carry an *Official* tag and what they do, and *More official plugins* lists the ones you don't have, with *Install*. An agent recommends one when it would help, and installs it only once you answer *Install* to its question; Mirador uses a new plugin from its next start. At its first start Mirador installs the checklist and code review plugins by itself; remove either and it stays removed. Each plugin shows its version. One added from git without a branch installs at its newest release, and Mirador looks for a newer release, or for one that follows a branch, new commits, when it starts and every six hours. A count on *Settings…* and on the Plugins tab shows how many plugins have an update, each plugin lists it ("1.2.0 → 1.3.0" and its commits), and *Update all* installs them for the next start; *Check for updates* looks right away.
- **Voice**: speech recognition, the voice model and the reply voice, each on this Mac, on a server of your own, or off (the voice model can also go through a profile); the language you speak, *Translate into English*, *Send right away* and *Keep talking*; the models on this Mac. See [Voice](#voice).
- **Layout**: the default arrangement for new conversations, and whether the canvas and terminals start hidden.
- **Devices** and **Notifications**, as above.
- **About**: the Mirador version, and the Claude Code it runs.
- **Newer versions**: the downloaded app checks GitHub's latest published release when the host starts and every 6 hours; a host running from a checkout fetches the branch it follows and counts the commits it lacks. A banner says so until you dismiss it, and *Settings › About* and the tray menu show it too. *Check for updates* in *Settings › About* looks now, and says whether Mirador is up to date or why it couldn't tell. A release build of the desktop app then downloads the release itself, shows *Downloading…* and offers *Restart to update*. Elsewhere, or where the app cannot replace itself (it says why), they link to the download.

Hovering almost any control explains what it does behind the scenes, together with its keyboard shortcut.

### Keyboard

| Keys | What they do |
| --- | --- |
| `⌘K` | The palette: any conversation, new conversation, continue a session, rewind or undo a turn's files, workspace colour and group, rename, canvas and terminal, layout reset, machines, search, settings, restart the host |
| `⌥↑` `⌥↓` / `⌥⇧↑` `⌥⇧↓` | Previous or next conversation / workspace |
| `⌥1`…`⌥9` | The n-th conversation of the current workspace |
| `⌥T` / `⌥⇧T` | New conversation / add a workspace |
| `⌘\` / `` ⌃` `` | Show or hide the canvas / the terminals |
| `⌘⇧←` `⌘⇧→` `⌘⇧↓` | Focus the message box / the canvas / the terminal |
| `⌘F` / `⌘⇧F` | Find in the conversation (in a terminal, in its output) / search everywhere |
| `⌘J` | In the message box, find a prompt template and put it in |
| `⌘⇧Space` | Dictate: a tap listens until you pause, a hold until you let go |
| `⌘+` `⌘−` / `⌘0` | Text size bigger or smaller / back to 100% (in a terminal, its font size) |
| `⌘R` / `⌘⇧R` | Reload the page / restart the host |
| `?` | Every shortcut, terminal keys included |

Off macOS, Ctrl stands in for ⌘ and Alt for ⌥. The ⌥ bindings go by physical key, so they work on layouts where ⌥ types characters, but they then shadow those characters (e.g. ⌥1…9 on the Hungarian layout). They also work while a canvas page has focus, except those that create or restart something: a page the agent wrote can't start conversations.

### The desktop app

A native window around Mirador, for macOS, Linux and Windows ([full details](desktop/README.md)).

- **Menu bar or tray app**: closing the window leaves it running, and on macOS the Dock icon hides until the window comes back. On macOS `⌘W` closes the open dialog, else the focused terminal's shell, and asks before it closes the window. The menu has the Mirador version and the host's status, a newer version when there is one, *Open*, *Restart host*, *Run host in the background*, *Open at login* and *Quit*. On a Linux desktop without a tray, *Desktop app…* in the sidebar has the same menu.
- **Uses a host that is already running** and never stops one it didn't start. Otherwise it starts one through your login shell, so agents see the same environment as in your terminal.
- **Run the host in the background**: a LaunchAgent on macOS, a systemd user service on Linux, or a scheduled task on Windows, so the host keeps running without the app and starts at login.
- **Open at login** (on by default).
- **Native notifications**, also while the window is closed (on Linux through `notify-send`).
- **One window, one app**: a second launch hands over to the running app. Links to other sites open in your browser.

### Working on Mirador in Mirador

- **The host watches its own source.** `⌘R` reloads the page with the UI code as it is now (the bundle rebuilds when `web/` or `shared/` changes), also in the desktop window.
- **Restart in place**: when `host/` or `shared/` changed, a banner offers a restart (also `⌘⇧R`, or *Restart the host* in the palette). The host stops working agents' turns the way Stop does, re-executes itself in the same process (so the desktop app, launchd or your terminal keeps seeing the same host), and then asks those agents to continue. Terminal shells start again, under the output they had. Queued messages and waiting marks survive any restart, and open pages reload by themselves.
- **A desktop app older than its checkout** shows a banner until it quits, so you know to rebuild it.
- **`bun run dev`** hot-reloads the UI, for working on `web/`.

### Security

- **Signed-in browsers only**: a token cookie, set by a one-time sign-in link so the token itself never sits in browser history or a log, and origin checks that turn away other sites and clients.
- **Canvas pages are sandboxed** on a separate origin: they can't reach the host, the page around them or the network.
- **Per-device tokens**, revocable at once. Other sites can't make your machine join them.
- **The network port** exposes no sign-in link, no MCP endpoint and no script-message route.
- **Secrets stay local**: profile environments are stored owner-only and masked on screen.

### Command line and environment

- `mirador sign-in` prints a one-time sign-in link for a browser on this machine. `mirador invite` prints a one-time invite code (and a link once the machine has an address). `mirador approve` lets in a device that asked to join. `mirador devices` lists devices, even while Mirador is stopped. `mirador when-done` waits for a job, and `mirador message` sends the agent's conversation a message. Put `bin/mirador` on your `PATH` with a link: `ln -s "$PWD/bin/mirador" ~/.local/bin/mirador`.
- **Environment**: `MIRADOR_PORT` (default 4600; canvas assets use the next port), `MIRADOR_CANVAS_PORT`, `MIRADOR_DATA_DIR` (default `~/.mirador`), `MIRADOR_NETWORK` and `MIRADOR_NETWORK_PORT`, `MIRADOR_PUBLIC_ORIGIN` and `MIRADOR_PUBLIC_CANVAS_ORIGIN`, `MIRADOR_TLS_CERTIFICATE` and `MIRADOR_TLS_KEY`, `MIRADOR_BUN`.
- **State** lives in the data directory: the SQLite database, browser and script tokens, `config.json` (address and network), and agent logs under `logs/`.

## Develop

```bash
bun run typecheck
bun run test            # unit tests
bunx playwright test    # e2e: a real Claude Code on haiku against your model server, opencode and pi against a scripted fake model (installed Google Chrome on macOS, Playwright's Chromium elsewhere)
MIRADOR_E2E_MINIMAL_ENV=1 bunx playwright test e2e/agent-flow.spec.ts   # host started with a bare environment
MIRADOR_EXPERIMENT=1 MIRADOR_TEST_MODEL=default MIRADOR_TEST_EFFORT=default bunx playwright test e2e/experiment-unprompted.spec.ts
MIRADOR_SCREENSHOTS=1 bunx playwright test e2e/readme-screenshots.spec.ts   # retakes this README's screenshots from a demo
```

The e2e specs' Claude Code never uses your Claude login, and keeps its settings and sessions in each test host's own folder, out of your `~/.claude`. Specs that wait for a real reply need a model server that speaks the Anthropic API: export `LLM_SERVER_URL` and `LLM_SERVER_KEY`, or write them to `~/.config/mirador/e2e-model-server.env`. Without one, those specs fail. The experiment and the screenshots above are the exceptions: they run on your login and `~/.claude`.

On Linux, from any machine with Docker (`MIRADOR_LINUX_ARCH=x64` or `arm64`, default this machine's; the other one runs emulated and slowly):

```bash
scripts/linux-test.sh      # type check, unit and e2e tests in Ubuntu 24.04
scripts/linux-desktop.sh   # builds the desktop app's installer, installs it and checks it starts, opens at login and stays single-instance
MIRADOR_LINUX_RELEASE=1 scripts/linux-desktop.sh   # the same for the release installer, which carries Mirador
```

Build the arm64 release installer on an x64 Linux machine too: in Docker on Apple Silicon, Electrobun's toolchain crashes (see `desktop/README.md`).

A release is made with three goals, each when the one before has been checked. Write the notes into `dist/release-notes-x.y.z.md` first:

```bash
make release VERSION=x.y.z LINUX_HOST=user@host   # in a worktree of its own: names the release, runs every test, builds and checks every app, and leaves a draft on GitHub whose files are checked against dist/x.y.z
make publish VERSION=x.y.z                        # publishes the draft as the latest release
make tap VERSION=x.y.z                            # pushes its Homebrew cask to the tap
```

An x.y.0 release is made from `main` and starts the branch `release/x.y.x` at its commit. A patch, x.y.1 and on, is made from that branch, so a fix goes out without what `main` gained since: commit it on `main`, cherry-pick it onto `release/x.y.x`, then `make release VERSION=x.y.z`.

After the gate the Linux, Windows and macOS builds run at once, and each makes its update files as soon as it is in. A step that fails names the steps to go on from once it is fixed (`FROM=step`, or `FROM=step,step` with the failed step of each build). The Windows app is built by the *Windows release* workflow on GitHub's Windows runner, which `make release` starts for the release's commit, waits for, and downloads from. The workflow's e2e survey runs a third of the suite on each of three runners at once, and going on from the `windows` step after a red run runs only its failed jobs again. `WINDOWS=no` makes a release without it and without `install.ps1`. Every app carries the Bun `.bun-version` names, the one the checks run on: a release build refuses any other, and the gate refuses to run on another. The rest it builds with the goals below, which can also be run alone. The release assets go to `dist/` (`make help` lists the goals):

```bash
make macos                               # the macOS app carrying Mirador, zipped (on a Mac)
make macos-signed                        # the same, signed with your Developer ID and notarized by Apple (see desktop/README.md)
make linux                               # both Linux release installers, built and checked as above (on an x64 Linux machine)
make linux-remote LINUX_HOST=user@host   # from a Mac: make linux on that machine, with the installers and update files copied back
make update-files                        # what the apps fetch to update themselves, with patches from the last 5 releases (on a Mac, after the builds)
make checksums                           # install.sh and install.ps1 copied in with them, and the SHA-256 of all of it, for the release notes
make cask                                # the Homebrew cask for the sodre90/homebrew-tap tap, with the SHA-256 of the macOS zip and the Linux installers
```

Layout: `host/` (Bun server, ACP client, canvas MCP server, SQLite store), `web/` (React UI bundled by Bun), `shared/` (types and logic both sides use), `desktop/` (the Electrobun app), `site/` (the website, assembled with the README's screenshots by `bun scripts/build-site.ts` and published to GitHub Pages by `.github/workflows/site.yml`), `e2e/` (Playwright specs), `tests/` (unit tests), `spike/` (throwaway feasibility spike, see `spike/FINDINGS.md`). Work is tracked in beads (`bd ready`).

## License

MIT, see [LICENSE](LICENSE).
