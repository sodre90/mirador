import type { ConversationStatus, WaitingFor } from "../shared/model.ts";

export const hints = {
  voiceRecognition:
    "What turns your speech into text. A server of your own is anything that speaks OpenAI's speech-to-text API (POST /audio/transcriptions): OpenAI itself, or a Whisper server on this or another machine. Mirador sends it 16 kHz WAV.",
  voiceModel:
    "The language model that translates what you say into English before it goes into the message box, and sums up replies to read aloud. A server of your own speaks OpenAI's chat API (POST /chat/completions); a profile's API is the one its environment names, ANTHROPIC_BASE_URL with ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, or OPENAI_BASE_URL with OPENAI_API_KEY. Mirador calls it directly, without starting the profile's agent.",
  voiceModelThinkingOff:
    "For a local server running a model that thinks before it answers, such as Gemma 4 or Qwen 3: thinking makes a translation take far longer and can use up the answer. Mirador sends chat_template_kwargs with enable_thinking false, which servers such as mlx_lm, vLLM and llama.cpp understand. Leave it off for OpenAI's API.",
  voiceEngineVoiceModel:
    "The voice model translates what you say into English, and later sums up replies to read aloud. Bigger ones translate better and need more memory: Mirador offers those that hold at most half of this Mac's memory while loaded. Without one, what you say goes into the message box in the language you spoke, unless another voice model is set below.",
  thisMacModel:
    "Mirador's models for this service. Best, good and fair are how each did in Mirador's comparison on a Mac; one that isn't on this Mac yet downloads with the button beside it. Mirador offers those that hold at most half of this Mac's memory while loaded.",
  voiceEngineIdle: "A loaded model holds memory, a voice model up to 15 GB, so each unloads once unused this long. Loading it again makes the next dictation wait.",
  voiceEngineLoaded: (minutes: number) => `Loaded, so it answers at once. It unloads after ${minutes} minute${minutes === 1 ? "" : "s"} unused, set under Models on this Mac.`,
  voiceEngineUnloaded: "Not holding memory now. It loads when next needed, usually in 5 to 15 seconds.",
  voiceEngineDownloadWaits: "Another download is going on. This one can start once it ends.",
  voiceEngineRemoveWaits: "A download is going on. Removing can start once it ends.",
  spokenVoiceKept: "Kokoro comes with voice on this Mac for English replies, and goes only with Remove all.",
  removeVoiceEngineArmed: "Click again to delete the speech engine and its models from this Mac. Setting up again downloads them again.",
  removeVoiceEngineModelArmed: "Click again to delete this model from this Mac. Choosing it again downloads it again.",
  voiceModelProfile: "Mirador calls this profile's API with its keys. Its agent doesn't start.",
  voiceAddress: "The API's address up to and including its version, as in https://api.openai.com/v1. Mirador adds the path of each call.",
  voiceLanguage:
    "The language you speak. Naming it helps on short clips, where telling languages apart by sound alone often goes wrong; this Mac's engine still hears English as English. With any language, the speech server decides, and the voice model translates whatever isn't English.",
  translateToEnglish: "What you say goes into the message box in English, with what you said under it, so you can check it before sending.",
  translateNeedsVoiceModel: "Translating needs a voice model. Pick one below.",
  replyVoice:
    "What reads replies aloud, once the voice model has summed each up in a few sentences. This Mac's engine speaks English with Kokoro, and Hungarian with OmniVoice, a download of its own whose licence allows only non-commercial use. A server of your own speaks OpenAI's text-to-speech API (POST /audio/speech) with one of its voices. After a message you dictated, its reply is read as the turn ends, in the browser you dictated in.",
  replyLanguage: "The language replies are read in. The voice model sums them up in it, whatever language the agent wrote in.",
  replyVoiceName: "One of the server's voices, as alloy is one of OpenAI's.",
  readAloud: "Reads a short summary of this reply aloud.",
  stopReadingAloud: "Stops reading this reply aloud.",
  keepTalking: "Once the reply to what you dictated has been read aloud, the microphone opens again and what you say next is sent right away. Saying \"stop\" or \"thanks\", or Esc, ends it. A question the agent asks meanwhile is read aloud for you to answer by voice; say \"help\" to hear what you can say.",
  sendRightAway: "Sends what you said as soon as it is text, instead of leaving it in the message box for you to check first.",
  dictate: "Speak instead of typing. Tap to start, and it stops when you pause or tap again; or hold it while you talk. What you said goes in at the caret.",
  dictateOff: "Dictating needs speech recognition. Settings → Voice can turn it on.",
  yolo:
    "Approve everything without asking.\n\nWhen the agent asks for permission to run a tool, the host answers with the agent's own \"allow\" option at once instead of showing you a card. Switching it on also approves a request that is already waiting. Requests that offer no allow option still ask you.\n\nThis is separate from the agent's Mode: tools that the Mode already allows never ask at all. Saved per conversation.",
  profile:
    "The profile (environment variables and pre-launch command) the agent runs with.\n\nEach profile runs its own agent process. Switching closes this session on the current process and resumes it on the new one, so the agent keeps the whole conversation. The model goes back to the new profile's default.\n\nSwitching while the agent works stops its turn, moves the session, and asks the agent to continue where it left off; messages you queued go out after that.\n\nProfiles of another agent can be picked only before the first message: that agent starts a fresh session. Once the conversation has begun, start a new conversation to use them.",
  questions:
    "What happens when the agent asks you something on the canvas.\n\nAgent waits: the agent's ask call stays open until you press Submit, and your answer comes back as its result, mid-turn.\n\nNext message: the ask call returns at once, the agent ends its turn, and your answer is sent later as your next message. Good for questions you want to think about.",
  conversationPluginSetting: "For this conversation only. Profile's follows what its profile sets in Profiles; switching profile goes back to it.",
  configOption:
    "The agent offers this setting for the session. Changing it sends the new value to the agent (ACP session/set_config_option), which applies it to this conversation.",
  dismissNewerVersion: "Hides this until there is something newer still. Settings › About keeps showing it.",
  restartHost:
    "Starts the host again in place, so it runs its code as it is now. Agents that are working stop, then continue where they left off; queued messages are kept. Terminals come back as new shells under the output they had. Open pages reload by themselves.",
  stop: "Asks the agent to stop its turn, as Esc does. When it has not stopped within a few seconds, this becomes Force stop, which ends the agent process instead; other conversations on the same profile continue where they left off.",
  promptTemplates: "Messages you send often, with the values you fill in each time. Settings adds, changes and deletes them.",
  deleteTemplateArmed: "Click again to delete this template. Defaults deleted here do not come back.",
  findAddress:
    "Asks what address other devices reach Mirador at: this machine's name on its tailnet, and the addresses devices have already used. Each one is checked before it is offered — it has to answer as this Mirador, on its own port and on the canvas libraries' port. The host uses the address you pick from its next start.",
  exposeOnTailscale:
    "Runs tailscale serve for Mirador's two ports, mirrored, so the tailnet reaches Mirador over HTTPS at https://<this machine on the tailnet>:<its port> and the canvas libraries at the same name on the canvas port. Nothing else on the tailnet is changed; the host uses the addresses from its next start.",
  address:
    "Where other devices open Mirador: http://127.0.0.1:4600 on this machine alone, or an address a proxy forwards to it, such as https://macbook.example.ts.net:4600. The port is Mirador's own, 4600 unless the host was started with another.",
  canvasAddress:
    "Where a canvas page loads D3, Mermaid and three from. Mirador serves them on a port of their own (4601), an origin separate from the app's, so a page an agent wrote cannot reach this Mirador's own storage. A proxy has to forward that port as well: https://macbook.example.ts.net:4601.",
  reachRoute:
    "Mirador reaches other devices one way at a time. Picking a choice only shows it; its Use this or Save address button applies it and takes the other one back, so nothing here is set that the host does not use. The host reads it from its next start. An address it can be reached at has to be given by a proxy, such as tailscale serve, or the host serves HTTPS on the network itself with a certificate it makes.",
  proxyElsewhere:
    "For a proxy such as Nginx Proxy Manager on another machine of your network, which can't reach this machine's own ports. Saving the address then also has Mirador serve HTTPS on the network, and the proxy forwards to those ports.",
  networkReachability:
    "Mirador serves HTTPS itself on this port, with a certificate authority it makes, so devices on the same network need no proxy and no address. Each browser warns once about the certificate (or trusts it for good once it installs mirador-ca.pem).",
  inviteDevice:
    "Makes a one-time code another browser or app joins this Mirador with, within 15 minutes. A joined device can do everything here, including run commands in terminals.",
  removeMachineArmed: "Click again to remove this machine from the list. It keeps running, and this computer stays among its devices until you revoke it there.",
  thisComputer: "This computer's own workspaces and conversations",
  manageMachines: "Add or remove machines",
  machineColor: "Give this machine a colour, to tell it apart in the rail. Kept on this computer.",
  machineColorStyle:
    "Where a machine you gave a colour shows it: on its rail button only, or also as a strip along the top of its view, so you can tell at a glance which machine you work on. Give a machine a colour in Machines….",
  machines: "Other computers running Mirador, such as a server whose agents keep working while this one sleeps.",
  revokeDeviceArmed: "Click again to sign this device out. It needs a new invite code to join again.",
  officialPlugin: "One of the official Mirador plugins, listed in the sodre90/mirador-plugins catalog.",
  installOfficialPlugin: "Clones the plugin's repo, builds it and puts it in Mirador's plugins folder. Mirador uses it from its next start.",
  addPlugin:
    "Clones the repo into Mirador's plugins folder and runs the build command its plugin.json names. Mirador loads the plugin from its next start.",
  checkForUpdates: "Looks for a newer Mirador now, rather than at the next look by itself, which comes every 6 hours.",
  checkPluginUpdates:
    "Looks for a newer release of the plugin, or for a plugin that follows a branch, the branch's new commits. Nothing changes until you update.",
  pluginUpdatesWaiting:
    "Plugins from git repos with a newer release or new commits. Mirador looks when it starts and every 6 hours, and installs nothing by itself: update them in Settings › Plugins.",
  updateAllPlugins: "Updates every plugin with a newer release or new commits, one after the other. Mirador uses them from its next start.",
  updatePlugin:
    "Clones the newest release, or the branch as it is now, and builds it, and only then replaces the plugin, so a failed update leaves it as it was. Mirador uses the new one from its next start.",
  removePluginArmed: "Click again to remove this plugin. Mirador stops loading it from its next start.",
  unlinkPluginArmed: "Click again to remove the link. The folder it points to stays as it is.",
  copyOnSelect: "Text you select in a terminal, by dragging or double- or triple-clicking, goes to the clipboard at once, as in iTerm2 and Linux terminals.",
  terminalLink: (click: string) => `${click} to open the link in your browser.`,
  terminalPreset: "Built-in colours for terminals: background, foreground and ANSI palette.",
  terminalFontSize: "Font size in terminal splits and tabs (11 to 24 px). ⌘+ and ⌘− step it when a terminal is focused.",
  terminalFontFamily:
    "Any font installed on this machine, by name, e.g. JetBrains Mono. Terminals and the statusline switch to it at once, with the usual fonts as fallback. Empty, or a font this machine lacks, shows the usual font.",
  terminalLineHeight: "Height of a terminal line, as a multiple of the font size.",
  terminalLetterSpacing: "Extra space between terminal characters, in pixels.",
  terminalCursorStyle: "The shape of the terminal cursor.",
  terminalCursorBlink: "Whether the terminal cursor blinks.",
  terminalFontWeightBold: "How heavy bold text in terminals is.",
  terminalScrollback: "How many lines a terminal keeps after they scroll off the top.",
  connectedDevicesInSidebar: "While devices are connected, a line at the bottom of the sidebar says how many; click it to see which. Remembered in this browser.",
  connectedDevices: (names: string[]) => `Connected now: ${names.join(", ")}. Click to see all devices in Settings → Devices.`,
  pageLibrariesSetting:
    "Where a page you copy or save out of the canvas loads D3, Mermaid and three.js from. The canvas serves them itself, which a page outside Mirador cannot reach. three.js always comes from the CDN.",
  editsInCanvasSetting:
    "On, an edit the agent waits for you to allow takes the canvas, with a Unified / Split toggle and the file's line numbers, and the chat keeps a small card. Off, the chat card shows the diff and the canvas stays as it is.",
  askPageBefore: "The agent showed this page just before asking, in the same turn. It stays above the question so you can read both; it is also in History on its own.",
  canvasToggle: "Hide or show the canvas pane. Drawings and questions still arrive while it's hidden and stay in History.",
  runCommand: "Runs the command after ! in this workspace's folder with your login shell, without input. Its output shows here and goes to the agent with your next message, as with ! in Claude Code. For interactive programs, use the terminal.",
  undoFiles:
    "Puts this workspace's files back to how they were before this turn began: what the turn changed is restored, what it created is deleted. Mirador kept them because this workspace is a git repository; your own commits, branches and history are untouched.\n\nThe conversation stays as it is. The agent is told with your next message that the files no longer hold that turn.",
  undoFilesConfirm:
    "Writes the files of the workspace back to how they were when the turn began. What the turn and everything after it did to the files is lost; the conversation keeps its record of it. Files that commits changed since, such as a pull's, stay as committed. Use the terminal if you want the files as they are now.",
  rewind:
    "Takes the conversation and this workspace's files back to how they were before this turn began: the turn and every turn after it leave the conversation, and the agent goes on in a session that holds only what came before them.\n\nThe turns that leave are not offered back, in the timeline or anywhere else. The agent's own session file stays on disk, where its own resume (Claude Code's --resume, pi's /resume) can still reach it. Your commits, branches and history are untouched.",
  rewindConfirm:
    "The conversation loses this turn and every turn after it, and the agent's own history with them; the files go back to how they were when it began, unless you keep them as they are. Files that commits changed since, such as a pull's, stay as committed. Neither comes back from here.",
  revertFiles: "Lists the files behind the counts above: those created since, which are deleted; those put back as they were when this turn began; and those commits changed since, which stay as they are.",
  rewindPutFilesBack:
    "On: the files go back to how they were when this turn began, but for those commits changed since. Off: only the conversation goes back, and every file stays as it is now, with what the turns that leave did to it. The agent is not told; it finds the files as they are.",
  commandDelivery: "Commands you run with ! go to the agent with your next message, in the tags Claude Code uses for its own ! commands.",
  commandOutputsAttached: "These outputs of commands you ran with ! go ahead of your next message to the agent. ✕ keeps them out of it.",
  terminalToggle: "Hide or show this conversation's terminals, which run in its workspace's folder. Their shells keep running while the pane is hidden or another conversation is shown, and reloading the page reattaches to them.",
  terminalHide: "Hide the terminals. Their shells keep running; show them again from the conversation header or the command palette.",
  terminalNewTab: "Open a shell in a new tab of this conversation's terminals, in its workspace's folder. Every window shows the same tabs for this conversation.",
  terminalSplit: "Open another shell beside the focused one, in the same tab (up to 4).",
  terminalSplitDown: "Open another shell below the focused one, in the same tab (up to 4).",
  terminalFindWholeWord: "Match whole word: only where the text stands on its own, not inside a longer word.",
  terminalFindRegex: "Use regular expression: the text is a JavaScript regular expression, such as error|warn.",
  terminalShowAll: "Show this tab's other terminals again; this one stopped filling the tab.",
  terminalCloseBusy: (command: string) => `${command} runs in this terminal. Click again, or press Enter or ⌘W, to end it and close the terminal; Esc keeps it.`,
  terminalCloseTab: "Close this tab and end its shells. A middle-click on the tab closes it too, asking first when a command runs in it.",
  terminalCloseTabBusy: (command: string) =>
    `${command} runs in this tab. Click again, middle-click the tab again, or press Enter, to end it and close the tab; Esc keeps it.`,
  terminalCloseTabArmed: "Click again to end the shells in this tab, and whatever they are running.",
  terminalCloseSplit: "End this shell and close its split.",
  terminalCloseSplitArmed: "Click again to end this shell and whatever it is running.",
  subagentsRunning:
    "Subagents the agent started that are still at work, also listed above the message box; click to open the first one. One started in the background counts until the turn that started it ends, since nothing tells when it finished before that.",
  searchAll: "Search every conversation in every workspace. Opening a match shows it in its conversation.",
  find: "Find text anywhere in this conversation: in earlier entries not loaded yet, and in folded cards, which unfold where it is found.",
  findOlder: "Previous match, further up (Enter)",
  findNewer: "Next match, further down (Shift+Enter)",
  findMatchCase: "Match case: capital and small letters count as different.",
  runningSubagent: "A subagent at work. Click to open its card in the conversation and see what it has done so far.",
  approvalWaiting: "The agent, or one of its subagents, waits for your approval further up the conversation. Click to go to it.",
  subagentTokens: (read: string, written: string, fresh: string) =>
    `Input tokens: ${read} read from the cache, ${written} written to it, ${fresh} new. Counted from Claude Code's transcript of the subagent.`,
  inTerminal:
    "This Claude Code session is also running in a terminal. The host sees that in Claude Code's session registry (<config dir>/sessions/<pid>.json) and shows what the terminal is doing.",
  launch:
    "The profile new conversations in this workspace start on, and with it their agent. Remembered per workspace. Existing conversations keep the profile they run on until you move them.",
  setUpProfile: "Every conversation runs on a profile. Set up your first one in the main pane; with nothing more set, it runs the agent as it is set up on this machine.",
  continueSession:
    "Pick up a Claude Code, opencode or pi session that was started in a terminal in this directory. Continue it in place, or fork its history into a new conversation and leave the original alone.",
  sessionSearch:
    "Find sessions in this directory by what was said in them, however old. The search reads the agent's own records of every session here, so it finds sessions the list does not show.",
  profiles: "Named setups for an agent: environment variables and a pre-launch command, applied to the agent process the profile starts. Every conversation runs on one.",
  shellOutputStyle:
    "How each shell command the agent runs shows in a conversation until you open or close it: its command with the output a click away, the output open only when the command failed, one line with the command too a click away, or everything open. Commands you run with ! always show their output.",
  shellLook:
    "The colours of shell blocks in a conversation: the agent's commands, yours, and commands waiting for your approval. Follow the theme matches the rest of the app; Custom takes the background, text and prompt colours you pick.",
  shellFont: "Any font installed on this machine, by name, e.g. JetBrains Mono. Empty, or a font this machine lacks, shows the app's monospace font.",
  shellFontSize: "The size of shell blocks' text, against the app's text size.",
  timestamps: "Off: the time shows next to each author's name, and on a later line while you point at it.\nOn: every line shows its time.",
  pulses:
    "The dots of working conversations, and of ones waiting on a job, pulse. On Linux they change a few times a second, as each change makes the window redraw.\nOff: they stay still. They also stay still when your system asks for reduced motion.",
  textSize: "Text size across the app: 50%, 70%, 100%, 140%, or 200%. ⌘+ and ⌘− step it, ⌘0 resets.",
  theme: "Light, dark, or follow the system setting.",
  waitingStyle:
    "How the sidebar marks a conversation whose agent waits for you: for an approval or an answer (Needs you), or because its turn ended while you looked elsewhere (Done, or Failed after an error).\n\nPill and count: a pill on the row and a count on its workspace. Dot only: a coloured dot and a bold title. Pills and a list on top: also lists every waiting conversation above the workspaces.",
  waitingCount: "Conversations in this workspace waiting for you.",
  workspaceColor: "Give this workspace a colour, to tell it apart in the sidebar. Every window shows it.",
  workspaceColorStyle:
    "How a workspace you gave a colour shows it: on its whole card, on its heading only, or as a stripe down its edge over a softer tint. Click a workspace's initials to give it a colour.",
  newConversation: "Start a conversation in this workspace, on the profile picked next to this button.",
  addWorkspace: "Add a project directory. Its conversations run with it as the working directory.",
  addWorkspaceGroup: "Add a group: a heading that folds, to gather workspaces under, e.g. per project or client. Drag a workspace by its heading into a group, and workspaces and groups into any order.",
  foldWorkspace: "Fold this workspace to its heading. Opening one of its conversations unfolds it.",
  unfoldWorkspace: "Show this workspace's conversations again.",
  workspaceGroupCount: "Workspaces in this group.",
  waitingInGroup: "Conversations in this group's workspaces waiting for you.",
  waitingAbove: "Conversations waiting for you, scrolled out of view above. Click to show the nearest.",
  waitingBelow: "Conversations waiting for you, scrolled out of view below. Click to show the nearest.",
  renameWorkspaceGroup: "Rename this group.",
  deleteWorkspaceGroup: "Delete this group. Its workspaces stay where it is.",
  deleteWorkspaceGroupArmed: "Click again to delete this group. Its workspaces stay where it is.",
  removeWorkspace: "Remove this workspace and its conversations from the app. The directory and its files are not touched.",
  removeWorkspaceArmed: "Click again to remove this workspace and its conversations from the app. The directory and its files are not touched.",
  deleteConversation: "Delete this conversation, its timeline and its canvas history from the app. The agent's own session files stay on disk.",
  deleteConversationArmed: "Click again to delete this conversation. The agent's own session files stay on disk.",
  deleteProfileArmed: "Click again to delete this profile. Its conversations can continue with another profile.",
  splitter: "Drag to resize, double-click to reset.",
  composerGrip: "Drag up to make the message box taller, down to make it smaller; it still grows with longer text. Every conversation in this browser uses the same height. Double-click to let it fit the text again.",
  paneGrip: "Drag onto another pane to swap the two, or use Swap in the palette. Each conversation remembers its own layout; Settings picks the one new conversations start with.",
  paneFullscreen: "Fill the workspace with this pane. Double-clicking the bar does the same.",
  paneExitFullscreen: "Back to the other panes. Esc does the same, except in a terminal, which keeps Esc for itself.",
  canvasHide: "Hide the canvas. Drawings and questions still arrive and stay in History; show it again from the conversation header or the palette.",
  settings: "The theme, timestamps, the layout new conversations start with, system notifications, and on macOS whether it corrects your spelling or predicts words as you type.",
  queue:
    "Messages you send while the agent works wait here.\n\nWith Claude Code and pi, a message tagged \"joins the turn\" waits here only while the agent runs tools: it goes into the running turn as soon as they finish, so the agent reads it before its next step. One tagged \"after the turn\" waits until the turn ends, then goes out as your next message. Enter and ⌥Enter (Alt+Enter) send one way each; Settings picks which. opencode can't take messages into a running turn, so with it they all wait.\n\nMessages that wait go out one at a time, each when the turn before it ends, also after you press Stop. Drag a message by its ⋮⋮ to change the order they go out in. Edit moves a message back into the message box; ↑ in an empty box does the same for the last one. The queue is kept by the host, so it survives a page reload and a host restart.",
  usageLimit:
    "Claude Code stopped at its usage limit. Instead of sending your queued messages into the same wall, the host keeps them, and like Claude Code it asks the agent to continue where it left off a minute after the limit resets; your queued messages follow. It does that at most twice in a row by itself; after that, or when the message names no reset time, it waits for you.\n\nThe wait survives a host restart.",
  continueAfterUsageLimit: "Ask the agent to continue where it left off now, e.g. after switching to a profile that signs in to another account. Queued messages follow.",
  tryAgain: "Ask the agent to continue where it left off. It still has the message the failed turn began with.",
  stopWaitingForUsageLimit: "Stop waiting for the reset: the agent does not continue by itself, and messages you queued go out now.",
  jobWait:
    "The agent left this job running and ran mirador when-done, so it need not poll it. Mirador checks on it now and then: a process every second, a container every 5 seconds, a job on another machine every 20 seconds over ssh. When it ends, the message goes to the agent as your next message, or, if the agent asked so, only to you.\n\nThe wait survives a host restart.",
  followJob:
    "Follow it in a terminal tab of this conversation: what it runs, how long it has run, then its output as it comes, from the file a process writes to or from the container's logs. The tab says when the job ends. Ctrl+C closes it; the job keeps running.",
  stopWaitingForJob: "Stop waiting for this job: when it ends, nobody is told. It keeps running.",
  asyncTask:
    "Claude Code itself runs this in the background, so the agent need not wait for it: a command it started with run_in_background, or a workflow. Claude Code tells the agent when it ends.\n\nThe task lives and dies with the agent's process.",
  asyncTaskOutput: "Show what the task has written so far: the end of the file Claude Code keeps its output in, refreshed while this stays open. Click again to hide it.",
  stopAsyncTask: "Stop this task: Claude Code ends it and the agent hears of it. The turn that started it keeps running.",
  dismissAsyncTask: "Dismiss this task: remove it from above the message box.",
  clearFinishedAsyncTasks: "Clear all finished tasks from above the message box.",
  delegatedTask:
    "A plugin's tool, such as delegate, started this conversation on another profile to work on a task for this one. When its first turn ends, its agent's last message comes to this conversation's agent as your next message.\n\nThe reply survives a host restart.",
  openDelegatedTask: "Open the conversation working on this task, to watch it or answer what it asks.",
  stopDelegatedTask: "Stop its turn. The agent here hears that the task stopped, with whatever the other agent said so far.",
  dismissDelegatedTask: "Dismiss this task: remove it from above the message box, and its conversation from the sidebar. Search still finds the conversation.",
  delegatedFold: "Conversations this one handed tasks to, such as with delegate. Click to show or hide them under it.",
  claudeProgram: (installFolders: string) =>
    `The claude program Mirador runs Claude Code with, on the host's computer. Empty: the claude on PATH, else in ${installFolders}.\n\nA profile can run another one through CLAUDE_CODE_EXECUTABLE in its environment.`,
  canvasUse:
    "As needed: the agent decides from the canvas's own instructions.\n\nOften: Claude Code's and pi's system prompts also tell them to put explanations, comparisons, plans and the summary of a larger piece of work on the canvas, and to ask you choices there.\n\nPages cost more tokens than the same answer as text.",
  terminalCommand:
    "Claude Code shows this one only in its own terminal, so this opens it there: a terminal tab of this conversation, run by the Claude Code this conversation's profile uses. The panel is where the command happens; the agent's answer above is only its refusal.",
  logIn:
    "Opens the agent's own sign-in in a terminal tab of this conversation, with its profile, so a profile with an account of its own signs that one in. Once it says you are signed in, send your message again.",
  queuedGrip: "Drag to change the order queued messages go out in: they leave from the top.",
  queuedDelivery: "How this message goes out: into the running turn once the agent's tools finish, or after the turn ends. Click to switch.",
  steerMessage: "Adds the message to the running turn: Claude Code reads it at once, cutting off what it is writing, or, while it runs tools, as soon as they finish. pi reads it once it finishes writing or running its tools.",
  afterTurnMessage: "Keeps the message until the running turn ends (or you press Stop), then sends it as your next message.",
  messageBox: "Formats as you type turns **bold**, *italic*, ~~strike~~, `code`, ``` code blocks, > quotes and - lists into formatting as you type them, as in Slack; ⌘B, ⌘I, ⌘⇧X and ⌘E format a selection. The agent gets the same markdown either way.",
  formatBar: "Formatting buttons over the message box. Settings › Conversations can keep them shown.",
  formatBarSetting: "Whether the formatting buttons show over the formatted message box from the start, or only after Aa beside it is clicked. Aa shows and hides them either way.",
  formatBold: "Bold, or type **text**",
  formatItalic: "Italic, or type *text*",
  formatStrike: "Strikethrough, or type ~~text~~",
  formatCode: "Code, or type `text`",
  formatLink: "Link the selected text to an address, or type [text](address)",
  formatLinkAddress: "Enter links, an empty address unlinks, and Esc leaves it as it was.",
  formatBullets: "Bulleted list, or start a line with - and a space. Enter adds an item; ⌘Enter (Ctrl+Enter) sends.",
  formatNumbers: "Numbered list, or start a line with 1. and a space. Enter adds an item; ⌘Enter (Ctrl+Enter) sends.",
  formatQuote: "Quote, or start a line with > and a space",
  formatCodeBlock: "Code block, or type ``` at the start of a line. Enter adds a line, ↓ at its end steps out, ⌘Enter (Ctrl+Enter) sends.",
  enterWhileBusy: "What Enter does with a message while the agent works; ⌥Enter (Alt+Enter) does the other. With opencode, messages always wait for the turn to end.",
  openFile:
    "Opens the file in the program the host's system uses for it, on the machine Mirador runs on. A script opens as text, in the program Settings › Conversations choose. A program does not open.",
  scriptProgram:
    "Where a file link to a script opens, as text, on the host's computer. The program for its type could run it: Git for Windows runs .sh files, Python's launcher .py files.\n\nThe system's text editor: on macOS the one you chose for text, on Windows Notepad. Linux has none of its own, so there xdg-open picks the program for the script's type, and an executable script, which that program could run, does not open.\n\nA program you name: its name on the host's PATH, such as code or subl, or its full path. It gets the file's path. On Windows name an .exe, such as Code.exe: a .cmd or .bat would run through cmd.exe, which could take part of a file's name for a command.",
  profilePicture:
    "Your picture, shown next to your messages. It is cut to a square and drawn at 128 pixels here, and kept by the host: every browser and device that opens this Mirador sees it.",
  blockedImage: "Opens the image in your browser. Mirador does not load images from other sites itself, so an agent cannot send them what it read; Settings → Conversations can change that.",
  scriptMessage:
    "A script the agent started sent this as your next message, so the agent picks up when the script is done. Scripts send with mirador message.",
  pluginMessage: "A plugin sent this as your next message, such as Delegate with the reply of a task the agent handed off, so the agent picks up from there.",
  gitBranch: "The git branch checked out in the workspace directory.",
  model: "The model the agent uses, as chosen in the Model menu above.",
  cost: "What the conversation has cost so far, as the agent reports it.",
  profileChip: "The profile this conversation's agent runs with.",
  quota: (limit: string, percent: string, resetsIn: string) =>
    `${limit} usage limit of your Claude plan: ${percent} used, starts over in ${resetsIn}.\n\nThe agent reports it after each response, for the account of this conversation's profile.`,
  statuslineCommand: (command: string) =>
    `Your statusline, printed by ${command}.\n\nThe host runs it like Claude Code does: Claude Code's statusline JSON on stdin (model, cwd, session, transcript, context window, cost) and the conversation's profile environment. Switch to the built-in statusline here.`,
  statuslineBuiltIn: (command: string) =>
    `The built-in statusline.\n\nClaude Code's settings name a statusline command (${command}); switch to it here.`,
  canvasOlder: "Show the previous canvas item.",
  canvasNewer: "Show the next canvas item.",
  canvasHistory: "Everything the agent drew or asked in this conversation, newest first.",
  canvasClear: "Empty the canvas. Nothing is deleted: the item stays in History.",
  canvasMore: "The bar's other buttons, which a narrow pane has no room for, and the apps other conversations of this workspace use, to show here too.",
  canvasPageExport: "Copy this page as an image or as HTML, ask the agent to write it as Markdown, or save it as a file of its own.",
  canvasPoint:
    "Point at something on the page to ask the agent about it or have it changed: a click picks the outlined element under the mouse, instead of doing what the page does, and a drag draws a box around an area, which goes as a picture. Esc stops. To ask about text, just select it.",
  pageMarkChange: "Tell the agent what to change there: it shows the page again with the change made.",
  canvasEditsWaiting: "Show the edit the agent waits for you to allow or reject.",
  canvasChanges: "The files this turn changed, or all uncommitted changes, with their line changes.",
  canvasApp: "The app open in this workspace, which you and the agent change together. Every conversation that shows it works on the same document.",
  canvasChecklist:
    "The steps of the agent's work, ticked as it finishes them. You can tick any of them too: the agent hears of your ticks with your next message.",
  checklistClose: "Back to what the canvas showed. The Checklist button opens it again.",
  checklistDismiss: "Take the checklist off the canvas for good. It stays gone until the agent publishes a new one.",
  checklistPlan: "The agent's own to-do list, as it last updated it. Only the agent ticks these.",
  changesScope: {
    turn: "The files that differ from how they were when this turn began, as the agent or anything else left them.",
    uncommitted: "git status: the files that differ from the last commit, and the files outside the project the agent edited in this conversation.",
    session: "Every file the agent changed with its edit tools in this conversation, even where a later turn changed it back, and the files written while its commands ran, build output and its commits included. A file a command deleted, or a job it left running wrote later, is not listed, nor one another conversation in this folder wrote, as told by its tool calls naming the file while it ran.",
  },
  changesView: {
    list: "Each changed file on its own row, with its whole path. Remembered in this browser.",
    tree: "The changed files in their folders. Click a folder to fold it. Remembered in this browser.",
    all: "Every file of the project in its folders, the changed ones marked. Only the folders holding a change start open. Remembered in this browser.",
  },
  changesFoldAll: "Fold every folder, so only the top level shows. Click a folder to open it again.",
  changesIgnored: "Show or hide the files git ignores that the agent's commands wrote, such as build output. Remembered in this browser.",
  changesEditedByAgent: "The project's files this conversation's agent changed with its edit tools in this turn.",
  changesChangedOtherwise: "The project's files changed in this turn without the agent's edit tools: by commands the agent ran, by you, or by another conversation or tool working in this folder.",
  changesOthersMayHaveWritten:
    "Written while this conversation's commands ran, but also while another conversation in this folder ran a command or an edit, and what the two ran doesn't tell which wrote it. Files only another conversation's tool calls name are left out.",
  changesFromCommit: "A commit since the turn began changed this file, such as a pull's or the agent's own.",
  changesRefresh: "Load the list again. It also loads after each tool call the agent finishes and when the turn ends.",
  changesByAgent: "This conversation's agent changed this file with its edit tools.",
  changesOpenInIdea: "Open the file in IntelliJ IDEA at its first changed line.",
  editDiffStyle: "Unified shows the old and new lines in one column; Split shows the old version on the left and the new one on the right. Remembered in this browser.",
} as const;

export const waitingHints: Record<WaitingFor, string> = {
  permission: "Needs you: the agent waits for you to approve a tool.",
  question: "Needs you: the agent asked you a question on the canvas.",
  finished: "Done: the turn ended while you were looking elsewhere. Opening the conversation clears this.",
  error: "Failed: the turn stopped with an error while you were looking elsewhere. Opening the conversation clears this.",
  unread: "Unread: you marked it to come back to. Opening the conversation clears this.",
};

export const statusHints: Record<ConversationStatus, string> = {
  idle: "Idle: waiting for your next message.",
  starting: "Starting: the host is launching the agent process or resuming the session on it.",
  running: "Running: the agent is working on your message. Esc or Stop cancels the turn.",
  error: "Error: the agent could not start or resume. The details are under the header.",
};
