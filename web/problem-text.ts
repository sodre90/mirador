import type { AgentGone, HostProblem, PrelaunchFailure } from "../shared/host-problems.ts";
import type { problems } from "./i18n/en/problems.ts";

export type ProblemWords = typeof problems;

export function goneText(gone: AgentGone, { gone: words }: ProblemWords) {
  switch (gone.kind) {
    case "no-answer":
      return words.noAnswer(gone.seconds);
    case "exited":
      return words.exited(gone.how);
    case "could-not-start":
      return words.couldNotStart(gone.cause);
    default:
      return words[gone.kind];
  }
}

const PATHS_NAMED_AT_MOST = 5;

const pathList = (paths: string[], words: ProblemWords) => {
  const named = paths.slice(0, PATHS_NAMED_AT_MOST).join(", ");
  return paths.length > PATHS_NAMED_AT_MOST ? `${named} ${words.andMorePaths(paths.length - PATHS_NAMED_AT_MOST)}` : named;
};

function prelaunchText(failure: PrelaunchFailure, { prelaunch: words }: ProblemWords) {
  switch (failure.kind) {
    case "timed-out":
      return words.timedOut(failure.seconds);
    case "exited":
      return words.exited(failure.how);
    case "could-not-run":
      return words.couldNotRun(failure.cause);
  }
}

const causeText = ({ cause, causeProblem }: { cause: string; causeProblem?: HostProblem }, words: ProblemWords): string =>
  causeProblem ? problemText(causeProblem, words) : cause;

/** A problem the host described, in the language of these words. */
export function problemText(problem: HostProblem, words: ProblemWords): string {
  switch (problem.code) {
    case "could-not-resume":
      return words.couldNotResume(causeText(problem, words));
    case "could-not-set-option":
      return words.couldNotSetOption(problem.option, problem.value, causeText(problem, words));
    case "option-change-unanswered":
      return words.optionChangeUnanswered(problem.option, problem.current, problem.value, problem.seconds);
    case "agent-cannot-load-sessions":
      return words.agentCannotLoadSessions(problem.agent);
    case "agent-cannot-fork-sessions":
      return words.agentCannotForkSessions(problem.agent);
    case "claude-program-missing":
      return words.claudeProgramMissing(problem.program);
    case "claude-not-installed":
      return words.claudeNotInstalled(problem.installFolders, problem.installCommand);
    case "profile-environment-invalid":
      return words.profileEnvironmentInvalid(problem.profile, problem.errors);
    case "agent-not-running":
      return words.agentNotRunning(problem.agent);
    case "no-such-conversation":
      return words.noSuchConversation(problem.id);
    case "agent-cannot-search-sessions":
      return words.agentCannotSearchSessions(problem.agent);
    case "agent-cannot-list-sessions":
      return words.agentCannotListSessions(problem.agent);
    case "conversation-runs-on-other-agent":
      return words.conversationRunsOnOtherAgent(problem.agent, problem.profile, problem.profileAgent);
    case "files-no-longer-kept":
      return words.filesNoLongerKept(problem.turns);
    case "agent-cannot-leave-session-behind":
      return words.agentCannotLeaveSessionBehind(problem.agent);
    case "not-a-slash-command":
      return words.notASlashCommand(problem.line);
    case "agent-has-no-such-command":
      return words.agentHasNoSuchCommand(problem.agent, problem.line);
    case "unknown-agent":
      return words.unknownAgent(problem.agent);
    case "profile-is-for-other-agent":
      return words.profileIsForOtherAgent(problem.profile, problem.profileAgent, problem.agent);
    case "unknown-questions-setting":
      return words.unknownQuestionsSetting(problem.value);
    case "unknown-colour":
      return words.unknownColour(problem.value);
    case "not-a-directory":
      return words.notADirectory(problem.path);
    case "unknown-canvas-use":
      return words.unknownCanvasUse(problem.value);
    case "unknown-keep-awake":
      return words.unknownKeepAwake(problem.value);
    case "unknown-conversation-order":
      return words.unknownConversationOrder(problem.value);
    case "unknown-plugin-update-mode":
      return words.unknownPluginUpdateMode(problem.value);
    case "unknown-keep-deleted-canvas":
      return words.unknownKeepDeletedCanvas(problem.value);
    case "unknown-workspace-colour":
      return words.unknownWorkspaceColour(problem.value);
    case "not-a-machine-address":
      return words.notAMachineAddress(problem.address);
    case "machine-already-added":
      return words.machineAlreadyAdded(problem.origin);
    case "unknown-machine-colour":
      return words.unknownMachineColour(problem.value);
    case "answer-all-questions":
      return words.answerAllQuestions(problem.count);
    case "tab-terminal-limit":
      return words.tabTerminalLimit(problem.count);
    case "unknown-workspace":
      return words.unknownWorkspace(problem.id);
    case "plugin-has-no-setting":
      return words.pluginHasNoSetting(problem.plugin, problem.setting);
    case "not-a-setting-choice":
      return words.notASettingChoice(problem.value, problem.setting);
    case "plugin-setting-not-per-conversation":
      return words.pluginSettingNotPerConversation(problem.setting);
    case "app-not-installed":
      return words.appNotInstalled(problem.app);
    case "app-storage-keeps-text":
      return words.appStorageKeepsText(problem.app);
    case "app-storage-full":
      return words.appStorageFull(problem.app, problem.characters, problem.key);
    case "file-leads-outside-workspace":
      return words.fileLeadsOutsideWorkspace(problem.path);
    case "agent-did-not-change-file":
      return words.agentDidNotChangeFile(problem.path);
    case "not-a-workspace-file":
      return words.notAWorkspaceFile(problem.path);
    case "not-a-line-number":
      return words.notALineNumber(problem.line);
    case "file-does-not-exist":
      return words.fileDoesNotExist(problem.path);
    case "file-does-not-exist-in":
      return words.fileDoesNotExistIn(problem.path, problem.workspace);
    case "file-would-run":
      return words.fileWouldRun(problem.path);
    case "no-program-for-file":
      return words.noProgramForFile(problem.path);
    case "file-cannot-open-as-text":
      return words.fileCannotOpenAsText(problem.path);
    case "executable-not-opened":
      return words.executableNotOpened(problem.file);
    case "script-program-not-found":
      return words.scriptProgramNotFound(problem.program);
    case "editor-launcher-missing":
      return words.editorLauncherMissing(problem.editor, problem.launcher);
    case "editor-command-not-found":
      return words.editorCommandNotFound(problem.program);
    case "file-name-unsafe-through-cmd":
      return words.fileNameUnsafeThroughCmd(problem.path, problem.program);
    case "script-program-through-cmd":
      return words.scriptProgramThroughCmd(problem.program);
    case "git-failed":
      return words.gitFailed(problem.command, problem.directory, problem.output);
    case "snapshot-blob-unreadable":
      return words.snapshotBlobUnreadable(problem.blob, problem.directory);
    case "not-in-git-repository":
      return words.notInGitRepository(problem.directory);
    case "commit-needs-message":
      return words.commitNeedsMessage;
    case "commit-needs-files":
      return words.commitNeedsFiles;
    case "not-an-uncommitted-change":
      return words.notAnUncommittedChange(problem.path);
    case "worktree-needs-repository":
      return words.worktreeNeedsRepository(problem.directory);
    case "landing-needs-branch":
      return words.landingNeedsBranch(problem.directory);
    case "nothing-to-land":
      return words.nothingToLand(problem.branch);
    case "landing-overlaps-uncommitted":
      return words.landingOverlapsUncommitted(problem.branch, pathList(problem.paths, words));
    case "landing-rebase-while-working":
      return words.landingRebaseWhileWorking(problem.branch);
    case "landing-worktree-edits-clash":
      return words.landingWorktreeEditsClash(problem.branch, pathList(problem.paths, words));
    case "landing-conflicts":
      return words.landingConflicts(problem.branch, pathList(problem.paths, words));
    case "landing-mid-operation":
      return words.landingMidOperation(problem.directory);
    case "save-path-absolute":
      return words.savePathAbsolute(problem.name);
    case "save-path-outside":
      return words.savePathOutside(problem.name);
    case "save-path-is-folder":
      return words.savePathIsFolder(problem.name);
    case "save-already-there":
      return words.saveAlreadyThere(problem.path);
    case "save-path-part-is-file":
      return words.savePathPartIsFile(problem.name);
    case "config-file-must-be-object":
      return words.configFileMustBeObject(problem.path);
    case "tailscale-serve-exited":
      return words.tailscaleServeExited(problem.exitCode);
    case "machine-certificate-not-its-own":
      return words.machineCertificateNotItsOwn(problem.machine, problem.hostname);
    case "machine-did-not-answer":
      return words.machineDidNotAnswer(problem.machine);
    case "machine-certificate-untrusted":
      return words.machineCertificateUntrusted(problem.machine);
    case "machine-gave-no-token":
      return words.machineGaveNoToken(problem.machine);
    case "machine-authority-not-in-link":
      return words.machineAuthorityNotInLink(problem.machine);
    case "machine-authority-changed":
      return words.machineAuthorityChanged(problem.machine);
    case "join-request-denied":
      return words.joinRequestDenied(problem.machine);
    case "join-request-timed-out":
      return words.joinRequestTimedOut(problem.machine);
    case "git-ls-remote-failed":
      return words.gitLsRemoteFailed(problem.output);
    case "plugin-renamed":
      return words.pluginRenamed(problem.name, problem.installedName, problem.folder);
    case "git-fetch-failed":
      return words.gitFetchFailed(problem.output);
    case "git-clone-failed":
      return words.gitCloneFailed(problem.output);
    case "repo-is-not-a-plugin":
      return words.repoIsNotAPlugin(causeText(problem, words));
    case "plugin-tag-version-mismatch":
      return words.pluginTagVersionMismatch(problem.tag, problem.release, problem.version);
    case "plugin-build-failed":
      return words.pluginBuildFailed(problem.command, problem.output);
    case "plugin-invalid-after-build":
      return words.pluginInvalidAfterBuild(causeText(problem, words));
    case "plugin-invalid-after-cloning":
      return words.pluginInvalidAfterCloning(causeText(problem, words));
    case "plugin-folder-taken":
      return words.pluginFolderTaken(problem.name);
    case "plugin-name-taken":
      return words.pluginNameTaken(problem.folder, problem.name);
    case "plugin-not-installed":
      return words.pluginNotInstalled(problem.folder);
    case "plugin-not-from-git":
      return words.pluginNotFromGit(problem.folder);
    case "plugin-has-nothing-to-update-from":
      return words.pluginHasNothingToUpdateFrom(problem.folder);
    case "plugin-name-already-used":
      return words.pluginNameAlreadyUsed(problem.name);
    case "plugin-tool-name-reserved":
      return words.pluginToolNameReserved(problem.tool);
    case "plugin-tool-name-taken":
      return words.pluginToolNameTaken(problem.tool, problem.plugin);
    case "plugin-api-too-new":
      return words.pluginApiTooNew(problem.api, problem.newest);
    case "plugin-canvas-needs-newer-api":
      return words.pluginCanvasNeedsNewerApi(problem.brought, problem.named);
    case "plugin-profile-settings-needs-newer-api":
      return words.pluginProfileSettingsNeedsNewerApi(problem.brought, problem.named);
    case "plugin-file-outside-folder":
      return words.pluginFileOutsideFolder(problem.path);
    case "plugin-file-missing":
      return words.pluginFileMissing(problem.path);
    case "plugin-host-module-missing-exports":
      return words.pluginHostModuleMissingExports(problem.names);
    case "plugin-tasks-unusable":
      return words.pluginTasksUnusable(problem.tasks);
    case "item-plugin-not-installed":
      return words.itemPluginNotInstalled(problem.plugin);
    case "plugin-takes-no-actions":
      return words.pluginTakesNoActions(problem.plugin);
    case "newer-version-git-failed":
      return words.newerVersionGitFailed(problem.command, problem.exitCode);
    case "newer-version-fetch-failed":
      return words.newerVersionFetchFailed(problem.upstream);
    case "newer-version-github-answered":
      return words.newerVersionGithubAnswered(problem.status);
    case "diff-too-many-lines":
      return words.diffTooManyLines(problem.lines);
    case "statusline-timed-out":
      return words.statuslineTimedOut(problem.seconds);
    case "statusline-exited":
      return words.statuslineExited(problem.exitCode, problem.firstError);
    case "image-at-most":
      return words.imageAtMost(problem.megabytes);
    case "image-type-unsupported":
      return words.imageTypeUnsupported(problem.type);
    case "dropped-file-at-most":
      return words.droppedFileAtMost(problem.megabytes);
    case "dropped-file-name-unusable":
      return words.droppedFileNameUnusable(problem.name);
    case "voice-engine-model-being-removed":
      return words.voiceEngineModelBeingRemoved(problem.model);
    case "voice-engine-model-downloading":
      return words.voiceEngineModelDownloading(problem.model);
    case "voice-engine-model-not-on-mac":
      return words.voiceEngineModelNotOnMac(problem.model);
    case "voice-profile-has-no-key":
      return words.voiceProfileHasNoKey(problem.profile);
    case "speech-server-timed-out":
      return words.speechServerTimedOut(problem.minutes);
    case "voice-model-timed-out":
      return words.voiceModelTimedOut(problem.minutes, problem.askNotToThink);
    case "reply-voice-server-timed-out":
      return words.replyVoiceServerTimedOut(problem.minutes);
    case "speech-server-answered":
      return words.speechServerAnswered(problem.status, problem.detail);
    case "voice-model-answered":
      return words.voiceModelAnswered(problem.status, problem.detail);
    case "reply-voice-server-answered":
      return words.replyVoiceServerAnswered(problem.status, problem.detail);
    case "voice-model-ran-out-of-room":
      return words.voiceModelRanOutOfRoom(problem.askNotToThink);
    case "reply-voice-wav-unreadable":
      return words.replyVoiceWavUnreadable(problem.format, problem.bits);
    case "engine-speech-server-stopped-starting":
      return words.engineSpeechServerStoppedStarting(problem.log);
    case "engine-voice-model-server-stopped-starting":
      return words.engineVoiceModelServerStoppedStarting(problem.log);
    case "engine-speaking-server-stopped-starting":
      return words.engineSpeakingServerStoppedStarting(problem.log);
    case "engine-speech-server-start-timed-out":
      return words.engineSpeechServerStartTimedOut(problem.seconds);
    case "engine-voice-model-server-start-timed-out":
      return words.engineVoiceModelServerStartTimedOut(problem.seconds);
    case "engine-speaking-server-start-timed-out":
      return words.engineSpeakingServerStartTimedOut(problem.seconds);
    case "engine-has-no-such-model":
      return words.engineHasNoSuchModel(problem.model);
    case "engine-files-list-failed":
      return words.engineFilesListFailed(problem.host, problem.status, problem.repo);
    case "engine-file-outside-model-folder":
      return words.engineFileOutsideModelFolder(problem.repo, problem.path);
    case "engine-needs-space":
      return words.engineNeedsSpace(problem.needed, problem.free);
    case "engine-download-answered":
      return words.engineDownloadAnswered(problem.host, problem.status, problem.url);
    case "engine-command-failed":
      return words.engineCommandFailed(problem.command, problem.lastError, problem.exitCode);
    case "engine-download-differs":
      return words.engineDownloadDiffers(problem.url);
    case "engine-adding-failed":
      return words.engineAddingFailed(problem.models, causeText(problem, words));
    case "not-a-language-code":
      return words.notALanguageCode(problem.language);
    case "unloading-minutes":
      return words.unloadingMinutes(problem.most);
    case "engine-could-not-reach":
      return words.engineCouldNotReach(problem.host, problem.cause);
    case "engine-download-host-busy":
      return words.engineDownloadHostBusy(problem.host, problem.status);
    case "engine-download-broke-off":
      return words.engineDownloadBrokeOff(problem.url);
    case "engine-download-wrong-size":
      return words.engineDownloadWrongSize(problem.url, problem.bytes);
    case "plugin-window-needs-newer-api":
      return words.pluginWindowNeedsNewerApi(problem.brought, problem.named);
    case "workspace-tab-needs-newer-api":
      return words.workspaceTabNeedsNewerApi(problem.brought, problem.named);
    case "plugin-background-needs-newer-api":
      return words.pluginBackgroundNeedsNewerApi(problem.brought, problem.named);
    case "plugin-typed-settings-need-newer-api":
      return words.pluginTypedSettingsNeedNewerApi(problem.brought, problem.named);
    case "plugin-statusline-needs-newer-api":
      return words.pluginStatuslineNeedsNewerApi(problem.brought, problem.named);
    case "canvas-host-module-needs":
      return words.canvasHostModuleNeeds(problem.needs.map((need) => problemText(need, words)));
    case "canvas-need-item-shape":
      return words.canvasNeedItemShape(problem.item, problem.placements);
    case "canvas-need-item-opens-with-room":
      return words.canvasNeedItemOpensWithRoom(problem.item, problem.rooms);
    case "canvas-need-tool-name":
      return words.canvasNeedToolName(problem.tool);
    case "canvas-need-tool-shape":
      return words.canvasNeedToolShape(problem.tool);
    case "canvas-need-command-shape":
      return words.canvasNeedCommandShape(problem.tool);
    case "plugin-command-needs-newer-api":
      return words.pluginCommandNeedsNewerApi(problem.brought, problem.named);
    case "plugin-command-unknown":
      return words.pluginCommandUnknown(problem.command);
    case "command-arguments-syntax":
      return words.commandArgumentsSyntax(problem.near);
    case "command-argument-unknown":
      return problem.known.length === 0 ? words.commandTakesNothing(problem.argument) : words.commandArgumentUnknown(problem.argument, problem.known);
    case "command-arguments-missing":
      return words.commandArgumentsMissing(problem.missing.map((name) => `${name}=…`));
    case "agent-gone":
      return words.agentGone(problem.agent, goneText(problem.gone, words));
    case "prelaunch-failed":
      return words.prelaunchFailed(problem.agent, prelaunchText(problem.failure, words), problem.output);
    case "profile-test-unanswered":
      return words.profileTestUnanswered(problem.seconds);
    default:
      return words.fixed[problem.code];
  }
}

/** An error the host sent: in the page's language when the host described it, else as it came, e.g. from the agent. */
/** A newer host's problem this page has no words for is said in the host's English. */
export const errorText = ({ message, problem }: { message: string; problem?: HostProblem }, words: ProblemWords) =>
  (problem && problemText(problem, words)) || message;
