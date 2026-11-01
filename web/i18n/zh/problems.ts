import type { Messages } from "../en/index.ts";

export const problems: Messages["problems"] = {
  couldNotResume: (cause) => `无法恢复智能体之前的会话（${cause}），将开始一个新会话。`,
  couldNotSetOption: (option, value, cause) => `无法将 ${option} 设为 ${value}：${cause}`,
  optionChangeUnanswered: (option, current, value, seconds) =>
    `${option} 仍为 ${current}：智能体已有 ${seconds} 秒未响应改为 ${value} 的请求。智能体响应后即会更改。`,
  usageLimitReached: "已达到 Claude 的用量限制。",
  conversationHasNoProfile: "此对话没有配置，或其配置已被删除。请在对话顶部选择一个配置。",
  workspaceGone: "该工作区已不存在。",
  conversationDeletedWhileOpening: "在打开智能体会话时，该对话已被删除。",
  agentCannotLoadSessions: (agent) => `${agent} 无法加载已有会话。`,
  agentCannotForkSessions: (agent) => `${agent} 无法分叉会话。`,
  opencodeNotInstalled: "未安装 opencode：PATH 和常用安装目录中都没有 opencode 程序。",
  piNotInstalled: "未安装 pi：PATH 中没有 pi 程序。请用 npm install -g @earendil-works/pi-coding-agent 安装。",
  claudeProgramMissing: (program) => `在“设置 › 智能体”中设置的 Claude Code 程序 ${program} 不存在或无法运行。`,
  claudeNotInstalled: (installFolders, installCommand) =>
    `未安装 Claude Code：PATH 和 ${installFolders} 中都没有 claude。请用 \`${installCommand}\` 安装，或在“设置 › 智能体”中设置它的路径。`,
  profileEnvironmentInvalid: (profile, errors) => `配置“${profile}”的环境无效：${errors}`,
  agentNotRunning: (agent) => `${agent} 智能体未在运行`,
  agentGone: (agent, gone) => `${agent} 智能体进程${gone}。`,
  gone: {
    "not-running": "未在运行",
    stopped: "已停止",
    "force-stopped": "已被强制停止",
    "restarted-for-profile": "因配置更改已重启",
    "restarted-for-claude-program": "因 Claude Code 程序更改已重启",
    noAnswer: (seconds) => `启动后 ${seconds} 秒内未响应`,
    exited: (how) => `已退出（${how}）`,
    couldNotStart: (cause) => `无法启动：${cause}`,
  },
  prelaunchFailed: (agent, failure, output) => `${agent} 的启动前命令${failure}${output ? `：${output}` : ""}`,
  prelaunch: {
    timedOut: (seconds) => `在 ${seconds} 秒后超时`,
    exited: (how) => `已退出（${how}）`,
    couldNotRun: (cause) => `无法运行：${cause}`,
  },
  imageMissing: "此消息的一张图片丢失了，请重新粘贴。",
  notAnImageOfConversation: "那不是此对话中的图片。",
  unknownConversation: "未知对话。",
  agentStillWorking: "智能体仍在处理上一条消息。",
};
