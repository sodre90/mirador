import type { Messages } from "../en/index.ts";

export const hints: Messages["hints"] = {
  voiceRecognition:
    "把你的语音转成文字的服务。自己的服务器可以是任何支持 OpenAI 语音转文字 API（POST /audio/transcriptions）的服务：OpenAI 本身，或者这台或另一台机器上的 Whisper 服务器。Mirador 向它发送 16 kHz 的 WAV。",
  voiceModel:
    "语言模型：把你说的话翻译成英文再放进消息框，并把回复概括后朗读出来。自己的服务器需要支持 OpenAI 的聊天 API（POST /chat/completions）；配置的 API 则是其环境所指定的那个，即 ANTHROPIC_BASE_URL 加 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，或者 OPENAI_BASE_URL 加 OPENAI_API_KEY。Mirador 直接调用它，不会启动该配置的 Agent。",
  voiceModelThinkingOff:
    "适用于运行“先思考再回答”模型的本地服务器，例如 Gemma 4 或 Qwen 3：思考会让翻译慢得多，还可能耗尽回答的长度。Mirador 会发送 enable_thinking 为 false 的 chat_template_kwargs，mlx_lm、vLLM 和 llama.cpp 等服务器都能理解。使用 OpenAI 的 API 时请保持关闭。",
  voiceEngineVoiceModel:
    "语音模型把你说的话翻译成英文，之后还会把回复概括后朗读出来。越大的模型翻译得越好，也越占内存：Mirador 只提供加载后占用不超过这台 Mac 一半内存的模型。如果不选，你说的话会按你说的语言放进消息框，除非下面设置了另一个语音模型。",
  thisMacModel:
    "Mirador 为此服务提供的模型。最佳、良好和一般是各模型在 Mirador 的 Mac 对比测试中的表现；还不在这台 Mac 上的模型，可用旁边的按钮下载。Mirador 只提供加载后占用不超过这台 Mac 一半内存的模型。",
  voiceEngineIdle: "已加载的模型会占用内存，语音模型最多 15 GB，所以闲置这么久后都会卸载。再次加载会让下一次听写等待。",
  voiceEngineLoaded: (minutes: number) => `已加载，所以会立即响应。闲置 ${minutes} 分钟后卸载，可在“这台 Mac 上的模型”中设置。`,
  voiceEngineUnloaded: "目前不占用内存。下次需要时才会加载，通常要 5 到 15 秒。",
  voiceEngineDownloadWaits: "另一个下载正在进行。等它结束后才能开始这个。",
  voiceEngineRemoveWaits: "有下载正在进行。等它结束后才能移除。",
  spokenVoiceKept: "Kokoro 随这台 Mac 的语音一起提供，用于朗读英文回复，只有“全部移除”才会删除它。",
  removeVoiceEngineArmed: "再次点击，将从这台 Mac 删除语音引擎及其模型。重新设置会再次下载它们。",
  removeVoiceEngineModelArmed: "再次点击，将从这台 Mac 删除这个模型。再次选择它会重新下载。",
  voiceModelProfile: "Mirador 用这个配置的密钥调用它的 API。它的 Agent 不会启动。",
  voiceAddress: "API 的地址，到版本号为止（含版本号），例如 https://api.openai.com/v1。Mirador 会补上每次调用的路径。",
  voiceLanguage:
    "你说的语言。指定语言对短音频有帮助，因为仅凭声音区分语言常常出错；这台 Mac 的引擎仍会把英语当作英语来听。选择任意语言时，由语音服务器决定，语音模型会翻译所有不是英语的内容。",
  translateToEnglish: "你说的话会以英文放进消息框，原话显示在下方，方便你发送前核对。",
  translateNeedsVoiceModel: "翻译需要语音模型。请在下面选一个。",
  replyVoice:
    "语音模型把每条回复概括成几句话后，由它来朗读。这台 Mac 的引擎用 Kokoro 说英语，用 OmniVoice 说匈牙利语，后者需单独下载，其许可证只允许非商业用途。自己的服务器用 OpenAI 的文字转语音 API（POST /audio/speech）和它的某个声音。对于你听写的消息，回复会在轮次结束时朗读，并在你听写所用的浏览器里播放。",
  replyLanguage: "朗读回复所用的语言。无论 Agent 用什么语言写，语音模型都会用这种语言概括。",
  replyVoiceName: "服务器的某个声音，就像 alloy 是 OpenAI 的声音之一。",
  readAloud: "朗读这条回复的简短摘要。",
  stopReadingAloud: "停止朗读这条回复。",
  copyReply: "以带格式的文本复制本轮次的回复，不含其中运行的工具。",
  copyReplyAsMarkdown: "以 Markdown 复制本轮次的回复，不含其中运行的工具。",
  keepTalking:
    "对你听写的内容的回复朗读完后，麦克风会再次打开，你接着说的话会立即发送。说“stop”或“thanks”，或按 Esc 即可结束。其间 Agent 提出的问题会朗读给你，你可以用语音回答；说“help”可以听到能说什么。",
  sendRightAway: "你说的话一变成文字就立即发送，而不是先留在消息框里让你检查。",
  dictate: "用说话代替打字。点一下开始，停顿或再点一下即停止；也可以按住不放边说边录。你说的内容会插入光标处。",
  dictateOff: "听写需要语音识别。可以在设置 → 语音中打开。",
  yolo:
    "不再询问，直接批准一切。\n\n当 Agent 请求运行某个工具的权限时，host 会立即用 Agent 自己的“allow”选项回应，而不是给你显示卡片。打开它也会批准已在等待的请求。没有提供 allow 选项的请求仍会询问你。\n\n这与 Agent 的模式无关：模式已允许的工具本来就不会询问。按对话保存。",
  conversationSettings:
    "此对话的配置、Agent、模型及其他设置。\n\n配置只提供它们的初始值：在这里更改不会改动配置本身。",
  yoloOn: "YOLO 已打开：Agent 的工具调用不经询问直接批准。可在此对话的设置中关闭。",
  profile:
    "Agent 运行时使用的配置（环境变量和启动前命令）。\n\n每个配置运行各自的 Agent 进程。切换时会在当前进程上关闭这个会话，并在新进程上恢复，因此 Agent 会保留整个对话。模型会回到新配置的默认值。\n\n在 Agent 工作时切换，会中止它的当前轮次、迁移会话，并请 Agent 从中断处继续；你排队的消息随后发出。\n\n其他 Agent 的配置只能在发出第一条消息之前选择：该 Agent 会开启一个全新的会话。对话开始后，请新建对话来使用它们。",
  questions:
    "Agent 在画布上向你提问时会怎样。\n\nAgent 等待：Agent 的 ask 调用保持打开，直到你点击提交，你的回答会作为结果在轮次中途返回。\n\n下一条消息：ask 调用立即返回，Agent 结束它的轮次，你的回答稍后作为你的下一条消息发出。适合需要你好好想想的问题。",
  conversationPluginSetting: "仅对这个对话生效。“配置的默认值”沿用其配置在“配置”中的设置；切换配置会回到它。",
  configOption:
    "Agent 为这个会话提供的设置。更改它会把新值发送给 Agent（ACP session/set_config_option），由 Agent 应用到这个对话。",
  dismissNewerVersion: "隐藏此提示，直到出现更新的版本。设置 › 关于 仍会继续显示它。",
  restartHost:
    "原地重新启动 host，让它按现在的代码运行。正在工作的 Agent 会停止，然后从中断处继续；排队的消息会保留。终端会作为新的 shell 回来，并保留它们原有的输出。已打开的页面会自动重新加载。",
  stop: "请求 Agent 停止它的轮次，与按 Esc 相同。如果几秒内仍未停止，这个按钮会变成“强制停止”，改为结束 Agent 进程；同一配置上的其他对话会从中断处继续。",
  promptTemplates: "你经常发送的消息，其中的值每次填写。可在设置中添加、修改和删除。",
  deleteTemplateArmed: "再次点击，将删除这个模板。在这里删除的默认模板不会恢复。",
  findAddress:
    "查询其他设备通过什么地址访问 Mirador：这台机器在 tailnet 上的名称，以及设备已经用过的地址。每个地址在提供给你之前都会先检查：它必须以这个 Mirador 的身份应答，包括它自己的端口和画布库的端口。host 从下次启动起使用你选的地址。",
  exposeOnTailscale:
    "为 Mirador 的两个端口运行 tailscale serve（镜像），这样 tailnet 就能通过 HTTPS 在 https://<这台机器在 tailnet 上的名称>:<其端口> 访问 Mirador，并在同一名称的画布端口上访问画布库。tailnet 上的其他内容不会改动；host 从下次启动起使用这些地址。",
  address:
    "其他设备打开 Mirador 的地址：仅限本机用 http://127.0.0.1:4600，或者用代理转发到它的地址，例如 https://macbook.example.ts.net:4600。端口是 Mirador 自己的，默认是 4600，除非 host 以其他端口启动。",
  canvasAddress:
    "画布页面加载 D3、Mermaid 和 three 的地址。Mirador 在它们自己的端口（4601）上提供这些库，这是与应用分开的源，所以 Agent 写的页面无法访问这个 Mirador 自己的存储。代理也必须转发这个端口：https://macbook.example.ts.net:4601。",
  reachRoute:
    "Mirador 一次只通过一种方式连接其他设备。选一个选项只是预览；它的“使用这个”或“保存地址”按钮才会应用并取消另一个，所以这里不会出现 host 没有使用的设置。host 从下次启动起读取它。可访问的地址必须由代理提供，例如 tailscale serve，或者由 host 自己在网络上用它生成的证书提供 HTTPS。",
  proxyElsewhere:
    "适用于你网络中另一台机器上的代理，例如 Nginx Proxy Manager，它无法访问这台机器自己的端口。保存地址后，Mirador 也会在网络上提供 HTTPS，由代理转发到这些端口。",
  networkReachability:
    "Mirador 在这个端口上自己提供 HTTPS，使用它生成的证书颁发机构，所以同一网络上的设备不需要代理，也不需要地址。每个浏览器会对证书警告一次（安装 mirador-ca.pem 后则永久信任）。",
  useThisNetwork:
    "让同一网络上的设备通过 HTTPS 访问这个 Mirador，与下方的选项相同。host 从下次启动起使用它。",
  inviteDevice:
    "生成一次性邀请码，另一个浏览器或应用可在 15 分钟内用它加入这个 Mirador。加入的设备可以在这里做任何事，包括在终端里运行命令。",
  inviteRoute:
    "点对点方式可以从任何地方连接这台 Mac，无需 VPN，需通过手机上的 Mirador 应用；浏览器只能通过地址加入。二维码和链接会随选择而变化。",
  removeMachineArmed: "再次点击，将从列表中移除这台机器。它会继续运行，这台电脑仍留在它的设备中，直到你在那里撤销。",
  thisComputer: "这台电脑自己的工作区和对话",
  manageMachines: "添加或移除机器",
  machineColor: "给这台机器设置一个颜色，以便在机器栏中区分。保存在这台电脑上。",
  machineColorStyle:
    "你给机器设置的颜色显示在哪里：仅在其机器栏按钮上，或者也作为其视图顶部的一条色带，让你一眼看出自己在哪台机器上工作。在“机器…”中给机器设置颜色。",
  machines: "运行 Mirador 的其他电脑，例如在这台电脑休眠时 Agent 仍能继续工作的服务器。",
  plugins: "插件为 Agent 提供画布上的额外工具，或带来视频、Google Docs 编辑器之类的应用。在这里安装、更新和设置它们。",
  revokeDeviceArmed: "再次点击，将让这台设备退出登录。它需要新的邀请码才能再次加入。",
  officialPlugin: "官方 Mirador 插件之一，列在 sodre90/mirador-plugins 目录中。",
  installOfficialPlugin: "克隆插件的仓库，并显示其中会运行的内容。在你同意之前，它的任何内容都不会运行。",
  addPlugin: "克隆仓库，并显示其中会运行的内容：构建命令和 host 代码。在你同意之前，它的任何内容都不会运行。",
  agreeToPlugin: "运行构建命令，然后把插件放进 Mirador 的插件文件夹。Mirador 从下次启动起加载它，包括 host 代码。",
  checkForUpdates: "现在就检查是否有更新的 Mirador，而不是等下一次自动检查（每 6 小时一次）。",
  checkPluginUpdates:
    "检查插件是否有更新的发布版本；对于跟随某个分支的插件，则检查该分支的新提交。在你更新之前不会有任何改变。",
  pluginUpdatesWaiting: "来自 git 仓库、有新发布版本或新提交的插件。Mirador 会在启动时和每 6 小时检查一次。除非“插件更新”设为自动安装，否则不会自行安装；你可以在 设置 › 插件 中更新它们。",
  pluginUpdateMode:
    "问我：每次更新都需要你确认。随 Mirador 更新：设为自动更新的插件会在 Mirador 本身更新时安装新发布版本。每次重启：每次 Mirador 启动时安装。Mirador 会提前下载并构建更新；如果更新改动了构建命令或 host 模块，或不是来自官方仓库，仍会等你确认。",
  pluginUpdatesByItself: "按“插件更新”设定的时机，无需询问即可安装此插件的新发布版本。官方插件默认开启。",
  undoPluginUpdate: "下次重启时恢复这次更新替换掉的版本。之后这个发布版本不会再自动安装，但你仍可手动更新到它。",
  updateAllPlugins: "克隆每个插件的更新发布版本或新提交，显示每个插件会运行的内容，然后一次性征求你对全部插件的同意。",
  updatePlugin:
    "克隆最新发布版本，或者分支的当前状态，并显示其中会运行的内容。你同意后会先构建，成功后才替换插件，所以更新失败时插件保持原样。",
  removePluginArmed: "再次点击，将移除这个插件。Mirador 从下次启动起不再加载它。",
  unlinkPluginArmed: "再次点击，将移除这个链接。它指向的文件夹保持不变。",
  copyOnSelect: "在终端中通过拖动、双击或三击选中的文本会立即进入剪贴板，就像在 iTerm2 和 Linux 终端中一样。",
  terminalLink: (click: string) => `${click}，在浏览器中打开该链接。`,
  terminalPreset: "终端的内置颜色：背景、前景和 ANSI 调色板。",
  terminalFontSize: "终端分屏和标签页中的字号（11 到 24 px）。终端获得焦点时，⌘+ 和 ⌘− 可逐级调整。",
  terminalFontFamily:
    "这台机器上安装的任何字体，填写字体名称，例如 JetBrains Mono。终端和状态栏会立即切换到它，并以常用字体作为后备。留空，或者填了这台机器没有的字体，则显示常用字体。",
  terminalLineHeight: "终端每行的高度，以字号的倍数表示。",
  terminalLetterSpacing: "终端字符之间的额外间距，单位为像素。",
  terminalCursorStyle: "终端光标的形状。",
  terminalCursorBlink: "终端光标是否闪烁。",
  terminalFontWeightBold: "终端中粗体文字的粗细程度。",
  terminalScrollback: "终端在内容滚出顶部后保留多少行。",
  connectedDevicesInSidebar: "有设备连接时，侧边栏底部会有一行显示连接数量；点击它可以查看是哪些设备。保存在这个浏览器中。",
  connectedDevices: (names: string[]) => `当前已连接：${names.join("、")}。点击可在 设置 → 设备 中查看所有设备。`,
  pageLibrariesSetting:
    "你从画布复制或保存的页面从哪里加载 D3、Mermaid 和 three.js。画布自己提供它们，而 Mirador 之外的页面访问不到。three.js 始终来自 CDN。",
  editsInCanvasSetting:
    "开启时，Agent 等你允许的编辑会占用画布，带有“统一 / 并排”切换和文件的行号，聊天里只保留一张小卡片。关闭时，聊天卡片显示差异，画布保持不变。",
  askPageBefore: "Agent 在提问前、同一轮次中展示了这个页面。它保留在问题上方，方便你同时阅读两者；它也单独保存在历史中。",
  canvasToggle: "隐藏或显示画布窗格。画布被隐藏时，绘图和问题仍会送达，并保留在历史中。",
  runCommand: "用你的登录 shell 在这个工作区的文件夹中运行 ! 后面的命令，不提供输入。输出显示在这里，并随你的下一条消息发给 Agent，就像 Claude Code 中的 ! 一样。交互式程序请使用终端。",
  undoFiles:
    "把这个工作区的文件恢复到这一轮开始前的样子：这一轮改动的内容会被还原，创建的内容会被删除。Mirador 保留了这些，因为这个工作区是 git 仓库；你自己的提交、分支和历史不受影响。\n\n对话保持不变。你的下一条消息会告知 Agent：文件已不再包含那一轮的更改。",
  undoFilesConfirm:
    "把工作区的文件写回这一轮开始时的样子。这一轮及之后的一切对文件所做的更改都会丢失；对话仍保留着相关记录。此后提交所改动的文件，例如 pull 带来的，保持已提交的样子。如果想保留文件现在的样子，请使用终端。",
  rewind:
    "把对话和这个工作区的文件都恢复到这一轮开始前的样子：这一轮及之后的每一轮都会从对话中移除，Agent 将在只包含这些轮次之前内容的会话中继续。\n\n被移除的轮次不会再出现，无论在时间线还是其他地方。Agent 自己的会话文件仍保留在磁盘上，它自己的恢复功能（Claude Code 的 --resume、pi 的 /resume）仍能访问到。你的提交、分支和历史不受影响。",
  rewindConfirm:
    "对话会失去这一轮及之后的每一轮，Agent 自己的历史也随之丢失；文件会恢复到这一轮开始时的样子，除非你选择保持现状。此后提交所改动的文件，例如 pull 带来的，保持已提交的样子。两者都无法从这里找回。",
  revertFiles: "列出上面计数背后的文件：此后新建、将被删除的；还原为这一轮开始时样子的；以及此后提交改动过、将保持原样的。",
  rewindPutFilesBack:
    "开启：文件会还原到这一轮开始时的样子，但此后提交改动过的除外。关闭：只回退对话，所有文件保持现状，包括将被移除的轮次对它们所做的更改。不会告知 Agent；它会发现文件就是现在的样子。",
  commandDelivery: "你用 ! 运行的命令会随你的下一条消息发给 Agent，使用 Claude Code 自己的 ! 命令所用的标签。",
  commandOutputsAttached: "你用 ! 运行的这些命令的输出，会排在你的下一条消息之前发给 Agent。点 ✕ 可以不发送。",
  terminalToggle: "隐藏或显示这个对话的终端，它们在其工作区的文件夹中运行。窗格隐藏或显示其他对话时，它们的 shell 会继续运行，重新加载页面会重新连接到它们。",
  terminalHide: "隐藏终端。它们的 shell 会继续运行；之后可从对话标题栏或命令面板再次显示。",
  terminalNewTab: "在这个对话终端的新标签页中打开一个 shell，位于其工作区的文件夹。每个窗口显示的这个对话的标签页都相同。",
  terminalSplit: "在同一个标签页中，在获得焦点的 shell 旁边再打开一个 shell（最多 4 个）。",
  terminalSplitDown: "在同一个标签页中，在获得焦点的 shell 下方再打开一个 shell（最多 4 个）。",
  terminalFindWholeWord: "全词匹配：只匹配独立成词的文本，不匹配较长单词的一部分。",
  terminalFindRegex: "使用正则表达式：文本按 JavaScript 正则表达式处理，例如 error|warn。",
  terminalShowAll: "再次显示此标签页的其他终端；这一个不再占满整个标签页。",
  terminalCloseBusy: (command: string) => `${command} 正在这个终端中运行。再次点击，或按 Enter 或 ⌘W，结束它并关闭终端；按 Esc 则保留。`,
  terminalCloseTab: "关闭这个标签页并结束其中的 shell。中键点击标签页也能关闭，如果其中有命令在运行，会先询问。",
  terminalCloseTabBusy: (command: string) =>
    `${command} 正在这个标签页中运行。再次点击、再次中键点击标签页，或按 Enter，结束它并关闭标签页；按 Esc 则保留。`,
  terminalCloseTabArmed: "再次点击，将结束这个标签页中的 shell，以及它们正在运行的所有内容。",
  terminalCloseSplit: "结束这个 shell 并关闭它的分屏。",
  terminalCloseSplitArmed: "再次点击，将结束这个 shell 以及它正在运行的所有内容。",
  subagentsRunning:
    "Agent 启动的、仍在工作的子 Agent，也列在消息框上方；点击可打开第一个。在后台启动的子 Agent 会一直计入，直到启动它的轮次结束，因为在此之前没有任何信号表明它何时完成。",
  searchAll: "搜索每个工作区中的每个对话。打开某个匹配项会在其所在对话中显示它。",
  find: "在这个对话的任何位置查找文本：包括尚未加载的较早条目，以及已折叠的卡片，找到时会展开。",
  fork: "把这个对话复制成同一配置下的新对话，这个对话保持不变。这里正在进行的轮次会继续；副本包含 Agent 目前已保存的内容。Agent 在这里处理过一条消息后才能使用。",
  findOlder: "上一个匹配项，向上（Enter）",
  findNewer: "下一个匹配项，向下（Shift+Enter）",
  findMatchCase: "区分大小写：大写和小写字母视为不同。",
  runningSubagent: "正在工作的子 Agent。点击可在对话中打开它的卡片，查看它目前做了什么。",
  approvalWaiting: "Agent 或它的某个子 Agent 在对话更上方等你批准。点击跳转到那里。",
  subagentTokens: (read: string, written: string, fresh: string) =>
    `输入 token：${read} 个从缓存读取，${written} 个写入缓存，${fresh} 个为新增。根据 Claude Code 的子 Agent 记录统计。`,
  inTerminal:
    "这个 Claude Code 会话也在终端中运行。host 通过 Claude Code 的会话注册表（<config dir>/sessions/<pid>.json）发现这一点，并显示终端正在做什么。",
  launch:
    "这个工作区中新对话启动时所用的配置，以及随之而来的 Agent。按工作区记忆。已有的对话保持它们运行所用的配置，直到你移动它们。",
  setUpProfile: "每个对话都在某个配置上运行。请在主窗格中设置你的第一个配置；如果不做更多设置，它会按这台机器上已设置的方式运行 Agent。",
  continueSession:
    "接续在这个目录的终端里启动的 Claude Code、opencode、pi 或 Codex 会话。可以原地继续它，也可以把它的历史 fork 到新对话中，原会话保持不动。",
  sessionSearch:
    "根据会话中说过的内容，在这个目录中查找会话，不论多久以前。搜索读取 Agent 自己对这里每个会话的记录，所以能找到列表中没有显示的会话。",
  profiles: "Agent 的命名设置：环境变量和启动前命令，应用于该配置所启动的 Agent 进程。每个对话都在某个配置上运行。",
  shellOutputStyle:
    "Agent 运行的每条 shell 命令在对话中如何显示（在你展开或折叠它之前）：命令，输出点一下才显示；仅在命令失败时展开输出；一行，命令也要点一下才显示；或者全部展开。你用 ! 运行的命令始终显示输出。",
  shellLook:
    "对话中 shell 块的颜色：Agent 的命令、你的命令，以及等待你批准的命令。“跟随主题”与应用其余部分一致；“自定义”使用你选的背景、文字和提示符颜色。",
  shellFont: "这台机器上安装的任何字体，填写字体名称，例如 JetBrains Mono。留空，或者填了这台机器没有的字体，则显示应用的等宽字体。",
  shellFontSize: "shell 块中文字的大小，相对于应用的文字大小。",
  timestamps: "关闭：时间显示在每位作者名字旁边，鼠标指向时也会显示在后续行上。\n开启：每一行都显示时间。",
  pulses:
    "工作中的对话和等待作业的对话的圆点会闪动。在 Linux 上它们每秒变化几次，因为每次变化都会让窗口重绘。\n关闭：它们保持静止。当系统要求减少动态效果时，它们也会保持静止。",
  textSize: "整个应用的文字大小：50%、70%、100%、140% 或 200%。⌘+ 和 ⌘− 逐级调整，⌘0 重置。",
  theme: "浅色、深色，或跟随系统设置。",
  waitingStyle:
    "侧边栏如何标记 Agent 在等你的对话：等待批准或回答（需要你），或者因为你在看别处而轮次已结束（完成，出错后为失败）。\n\n标签和计数：行上显示标签，其工作区上显示计数。仅圆点：彩色圆点和粗体标题。标签，顶部再加列表：还会在工作区上方列出每个等待中的对话。",
  waitingCount: "这个工作区中等你处理的对话。",
  workspaceColor: "给这个工作区设置一个颜色，以便在侧边栏中区分。每个窗口都会显示它。",
  workspaceColorStyle:
    "你给工作区设置的颜色显示在哪里：整张卡片上、仅标题上，或者在边缘显示色条并配以更淡的底色。点击工作区的首字母可给它设置颜色。",
  newConversation: "在这个工作区中开始一个对话，使用这个按钮旁边所选的配置。",
  addWorkspace: "添加一个项目目录。它的对话以该目录作为工作目录运行。",
  hideSidebar: "隐藏侧边栏，让对话、画布和终端占满整个宽度。此浏览器会记住这个设置。",
  showSidebar: "重新显示包含工作区和对话的侧边栏。",
  addWorkspaceGroup: "添加一个分组：可折叠的标题，用来收纳工作区，例如按项目或客户划分。拖动工作区的标题可放入分组，工作区和分组也可以拖成任意顺序。",
  foldWorkspace: "把这个工作区折叠为只剩标题。打开其中的某个对话会将其展开。",
  unfoldWorkspace: "再次显示这个工作区的对话。",
  workspaceGroupCount: "这个分组中的工作区。",
  waitingInGroup: "这个分组的工作区中等你处理的对话。",
  waitingAbove: "上方已滚出视野的、等你处理的对话。点击显示最近的一个。",
  waitingBelow: "下方已滚出视野的、等你处理的对话。点击显示最近的一个。",
  renameWorkspaceGroup: "重命名这个分组。",
  deleteWorkspaceGroup: "删除这个分组。它的工作区保留在原处。",
  deleteWorkspaceGroupArmed: "再次点击，将删除这个分组。它的工作区保留在原处。",
  removeWorkspace: "从应用中移除这个工作区及其对话。目录及其文件不受影响。",
  removeWorkspaceArmed: "再次点击，将从应用中移除这个工作区及其对话。目录及其文件不受影响。",
  deleteConversation: "从应用中删除这个对话、它的时间线和画布历史。Agent 自己的会话文件仍保留在磁盘上。",
  deleteConversationArmed: "再次点击，将删除这个对话。Agent 自己的会话文件仍保留在磁盘上。",
  deleteProfileArmed: "再次点击，将删除这个配置。它的对话可以改用其他配置继续。",
  splitter: "拖动调整大小，双击重置。",
  composerGrip: "向上拖动使消息框变高，向下拖动使其变小；文字变长时它仍会自动增高。这个浏览器中的每个对话使用相同的高度。双击可让它重新贴合文字。",
  paneGrip: "拖到另一个窗格上可交换两者，或使用命令面板中的“交换”。每个对话会记住自己的布局；设置里选的是新对话开始时使用的布局。",
  paneFullscreen: "让这个窗格占满工作区。双击标题栏效果相同。",
  paneExitFullscreen: "返回其他窗格。按 Esc 效果相同，终端中除外，终端会把 Esc 留给自己。",
  canvasHide: "隐藏画布。绘图和问题仍会送达并保留在历史中；可从对话标题栏或命令面板再次显示。",
  settings: "主题、时间戳、新对话开始时使用的布局、系统通知，以及在 macOS 上是否在你输入时纠正拼写或预测词语。",
  queue:
    "Agent 工作期间你发送的消息会在这里等待。\n\n使用 Claude Code、pi 和 Codex 时，标记为“并入当前轮次”的消息只在 Agent 运行工具期间在这里等待：工具一结束它就进入正在进行的轮次，所以 Agent 在下一步之前就会读到。标记为“轮次结束后”的消息会等到轮次结束，然后作为你的下一条消息发出。Enter 和 ⌥Enter（Alt+Enter）各对应一种发送方式；在设置中选择哪个对应哪种。opencode 无法把消息放进正在进行的轮次，所以用它时消息都会等待。\n\n等待的消息一次发出一条，每条在它前一个轮次结束时发出，按下停止后也是如此。拖动消息的 ⋮⋮ 可以改变发出的顺序。“编辑”会把消息移回消息框；在空消息框中按 ↑ 对最后一条也是同样效果。队列由 host 保存，所以重新加载页面和重启 host 后仍然保留。",
  usageLimit:
    "Claude Code 因用量上限而停止。host 不会让你排队的消息再去撞同一个上限，而是先留着它们，并像 Claude Code 一样，在上限重置一分钟后请 Agent 从中断处继续；之后你排队的消息跟上。它最多自动这样做连续两次；之后，或者消息中没有写明重置时间时，就等你处理。\n\n等待状态在 host 重启后仍然保留。",
  continueAfterUsageLimit: "现在就请 Agent 从中断处继续，例如在切换到登录另一个账号的配置之后。排队的消息随后发出。",
  tryAgain: "请 Agent 从中断处继续。它仍保留失败的那一轮开始时的消息。",
  stopWaitingForUsageLimit: "不再等待重置：Agent 不会自行继续，你排队的消息会立即发出。",
  jobWait:
    "Agent 让这个作业继续运行，并执行了 mirador when-done，所以不需要轮询它。Mirador 会时不时检查：进程每秒一次，容器每 5 秒一次，另一台机器上的作业通过 ssh 每 20 秒一次。作业结束时，消息会作为你的下一条消息发给 Agent，或者如果 Agent 要求如此，则只发给你。\n\n等待状态在 host 重启后仍然保留。",
  followJob:
    "在这个对话的终端标签页中跟踪它：它运行的内容、已运行多久，然后是随之产生的输出，来自进程写入的文件或容器的日志。作业结束时标签页会说明。按 Ctrl+C 关闭它；作业继续运行。",
  stopWaitingForJob: "不再等待这个作业：它结束时不会通知任何人。它会继续运行。",
  asyncTask:
    "Claude Code 自己在后台运行它，所以 Agent 不需要等待：可能是它用 run_in_background 启动的命令，或者是一个工作流。它结束时 Claude Code 会告知 Agent。\n\n该任务与 Agent 的进程同生共死。",
  asyncTaskOutput: "显示任务目前写出的内容：Claude Code 保存其输出的文件末尾，在此保持展开期间会刷新。再次点击可隐藏。",
  stopAsyncTask: "停止这个任务：Claude Code 会结束它，并让 Agent 知晓。启动它的轮次继续运行。",
  dismissAsyncTask: "忽略这个任务：把它从消息框上方移除。",
  clearFinishedAsyncTasks: "从消息框上方清除所有已完成的任务。",
  delegatedTask:
    "某个插件的工具（例如 delegate）在另一个配置上启动了这个对话，来为当前对话处理一项任务。它的第一轮结束时，其 Agent 的最后一条消息会作为你的下一条消息发给当前对话的 Agent。\n\n该回复在 host 重启后仍然保留。",
  openDelegatedTask: "打开处理这项任务的对话，观看进展或回答它的提问。",
  stopDelegatedTask: "停止它的轮次。这里的 Agent 会得知任务已停止，以及另一个 Agent 到目前为止说过的内容。",
  dismissDelegatedTask: "忽略这个任务：把它从消息框上方移除，并把它的对话从侧边栏移除。搜索仍能找到该对话。",
  delegatedFold: "这个对话交办任务的对话，例如通过 delegate。点击可在其下显示或隐藏它们。",
  claudeProgram: (installFolders: string) =>
    `Mirador 用来运行 Claude Code 的 claude 程序，位于 host 所在的电脑上。留空：使用 PATH 中的 claude，否则使用 ${installFolders} 中的。\n\n配置可以通过其环境中的 CLAUDE_CODE_EXECUTABLE 运行另一个程序。`,
  keepAwake:
    "在 Mirador 所在的电脑空闲时，阻止它进入睡眠。\n\nAgent 工作时：直到每个正在运行的轮次结束，让长时间的作业能够完成。\n\n始终：只要 Mirador 在运行，这样你的手机和其他设备随时可以连上它。\n\n适用于 macOS 和 Linux。",
  canvasUse:
    "按需：Agent 根据画布自己的说明来决定。\n\n经常：Claude Code、pi、Codex 和 Antigravity 的系统提示词，以及 Copilot 的画布说明，还会告诉它们，把解释、对比、计划和较大工作的总结放到画布上，并在画布上向你提出选择。\n\n页面比同样内容的文字回答消耗更多 token。",
  keepDeletedCanvas:
    "删除对话后，其画布会保留这么久。从“继续会话…”继续它的会话时，画布会原样恢复，包括审查和导览。超过这段时间后，只会恢复会话自身历史中保存的内容：页面、问题和清单。",
  terminalCommand:
    "Claude Code 只在它自己的终端中显示这个，所以这里会在那里打开它：这个对话的一个终端标签页，由这个对话的配置所用的 Claude Code 运行。面板是命令生效的地方；上面 Agent 的回答只是它的拒绝。",
  logIn:
    "在这个对话的终端标签页中打开 Agent 自己的登录流程，使用它的配置，所以有自己账号的配置会登录那个账号。显示你已登录后，请重新发送你的消息。",
  queuedGrip: "拖动可改变排队消息发出的顺序：它们从最上面开始发出。",
  queuedDelivery: "这条消息如何发出：在 Agent 的工具结束后并入正在进行的轮次，或者在轮次结束后发出。点击切换。",
  steerMessage: "把消息并入正在进行的轮次：Claude Code 会立即读到，打断它正在写的内容，或者在它运行工具时，工具一结束就读到。pi 在写完或运行完工具后读到。",
  afterTurnMessage: "保留这条消息，直到正在进行的轮次结束（或你按停止），然后作为你的下一条消息发出。",
  messageBox: "“输入时自动格式化”会在你输入时把 **粗体**、*斜体*、~~删除线~~、`代码`、``` 代码块、> 引用和 - 列表转换成相应格式，就像 Slack 一样；⌘B、⌘I、⌘⇧X 和 ⌘E 可对选中内容设置格式。无论哪种方式，Agent 拿到的都是同样的 markdown。",
  formatBar: "消息框上方的格式按钮。设置 › 对话 可以让它们始终显示。",
  formatBarSetting: "格式按钮是否一开始就显示在带格式的消息框上方，还是点击旁边的 Aa 后才显示。无论哪种，Aa 都可以显示和隐藏它们。",
  formatBold: "粗体，或输入 **文本**",
  formatItalic: "斜体，或输入 *文本*",
  formatStrike: "删除线，或输入 ~~文本~~",
  formatCode: "代码，或输入 `文本`",
  formatLink: "把选中的文本链接到一个地址，或输入 [文本](地址)",
  formatLinkAddress: "按 Enter 添加链接，地址留空则取消链接，按 Esc 保持原样。",
  formatBullets: "项目符号列表，或在行首输入 - 和一个空格。按 Enter 添加一项；⌘Enter（Ctrl+Enter）发送。",
  formatNumbers: "编号列表，或在行首输入 1. 和一个空格。按 Enter 添加一项；⌘Enter（Ctrl+Enter）发送。",
  formatQuote: "引用，或在行首输入 > 和一个空格",
  formatCodeBlock: "代码块，或在行首输入 ```。按 Enter 添加一行，在末尾按 ↓ 跳出，⌘Enter（Ctrl+Enter）发送。",
  enterWhileBusy: "Agent 工作时，Enter 对消息的处理方式；⌥Enter（Alt+Enter）执行另一种。使用 opencode 时，消息始终等到轮次结束。",
  openFile:
    "用 host 的系统为该文件指定的程序打开它，在 Mirador 所运行的机器上。脚本作为文本打开，使用 设置 › 对话 中选定的程序。程序文件不会被打开。",
  pushRelayAddress: "这台 Mac 把推送发往你手机的地址；留空则不发送。手机只有在向这台 Mac 注册后才会收到推送。",
  pushRelayToken: "中继的所有者为这台 Mac 生成的令牌。Mirador 会保存它，之后不再显示；留空则保留已设置的那个。",
  machineName: "手机对这台机器的称呼：它们连接时会获取这个名称，手机仍可以给它起自己的名字。它也会以这个名称作为 Mirador 加入其他机器。留空则使用电脑的名称。",
  scriptProgram:
    "指向脚本的文件链接在 host 的电脑上以文本打开时所用的程序。该类型对应的程序可能会直接运行它：Git for Windows 会运行 .sh 文件，Python 启动器会运行 .py 文件。\n\n系统的文本编辑器：在 macOS 上是你为文本选定的那个，在 Windows 上是记事本。Linux 没有自己的，所以在那里由 xdg-open 根据脚本类型选择程序，而可执行脚本（该程序可能会运行它）不会被打开。\n\n你指定的程序：它在 host 的 PATH 中的名称，例如 code 或 subl，或者它的完整路径。它会收到文件的路径。在 Windows 上请指定 .exe，例如 Code.exe：.cmd 或 .bat 会通过 cmd.exe 运行，而 cmd.exe 可能把文件名的一部分当作命令。",
  editor:
    "“在 … 中打开”在 host 电脑上使用的编辑器。Mirador 在 host 的 PATH 和各安装程序存放的位置查找每个编辑器的命令行启动器（idea、code、cursor、zed、subl），按此顺序取找到的第一个。",
  editorCommand:
    "一个程序及其参数，不经 shell 运行。{file} 替换为文件路径，{line} 替换为行号；没有 {file} 时路径放在最后。程序路径含空格时请加引号。",
  profilePicture:
    "你的头像，显示在你的消息旁边。它会被裁成正方形并在这里以 128 像素绘制，由 host 保存：打开这个 Mirador 的每个浏览器和设备都会看到它。",
  blockedImage: "在你的浏览器中打开这张图片。Mirador 自己不会从其他网站加载图片，所以 Agent 无法借此把它读到的内容发给对方；设置 → 对话 可以更改这一点。",
  scriptMessage:
    "Agent 启动的某个脚本把这条作为你的下一条消息发出，所以 Agent 会在脚本完成时接着继续。脚本通过 mirador message 发送。",
  miradorMessage:
    "Agent 的轮次结束时，Mirador 把这条发给了它：用来继续它宣布过但没有执行的步骤，或者在设置要求“经常”使用画布时使用画布，例如用 ask 向你提问而不是在聊天中提问。",
  pluginMessage: "某个插件把这条作为你的下一条消息发出，例如 Delegate 带着 Agent 交办的任务的回复，让 Agent 从这里接着继续。",
  gitBranch: "工作区目录中已检出的 git 分支。",
  model: "Agent 使用的模型，由上方的模型菜单选定。",
  cost: "到目前为止这个对话的花费，按 Agent 报告的数据。",
  credits: "这个对话已用的 AI 积分，按 GitHub Copilot 的计算。",
  profileChip: "这个对话的 Agent 运行时所用的配置。",
  quota: (limit: string, percent: string, resetsIn: string) =>
    `你的套餐的${limit}用量上限：已用 ${percent}，${resetsIn}后重新开始。\n\nAgent 在每次响应后报告它，对应这个对话所用配置的账号。`,
  statuslineCommand: (command: string) =>
    `你的状态栏，由 ${command} 输出。\n\nhost 像 Claude Code 一样运行它：在 stdin 上提供 Claude Code 的状态栏 JSON（模型、cwd、会话、记录、上下文窗口、花费）以及这个对话所用配置的环境。在这里可切换到内置状态栏。`,
  statuslineBuiltIn: (command: string) =>
    `内置状态栏。\n\nClaude Code 的设置指定了一个状态栏命令（${command}）；在这里可切换到它。`,
  canvasOlder: "显示上一个画布项目。",
  canvasNewer: "显示下一个画布项目。",
  canvasHistory: "Agent 在这个对话中绘制或询问的一切，最新的在前。",
  canvasClear: "清空画布。不会删除任何内容：该项目仍保留在历史中。",
  canvasOpenInWindow: "在一个始终保持最新的单独窗口中显示此项目，例如放在第二块屏幕上。再次打开会把该窗口带到前面。",
  canvasMore: "栏中的其他按钮（窄窗格放不下它们），以及这个工作区其他对话所用的、也可以在这里显示的应用。",
  canvasPageExport: "把这个页面复制为图片或 HTML，请 Agent 把它写成 Markdown，或者另存为单独的文件。",
  canvasPoint:
    "指向页面上的某处，向 Agent 提问或让它修改：点击会选中鼠标下带轮廓的元素，而不是执行页面本身的操作；拖动会在一个区域周围画框，作为图片发送。按 Esc 停止。要询问文字，直接选中它即可。",
  canvasPageFind: "在 Agent 显示的页面里查找文字：每个匹配项都会在页面上标出，当前的那个会滚动到视野中。",
  pageMarkChange: "告诉 Agent 那里要改什么：它会重新显示改好后的页面。",
  canvasEditsWaiting: "显示 Agent 等你允许或拒绝的编辑。",
  canvasChanges: "这一轮改动的文件，或所有未提交的更改，附带各自的行更改。",
  canvasApp: "在这个工作区中打开的应用，你和 Agent 一起修改它。每个显示它的对话都使用同一份文档。",
  canvasWorkspaceTab: "插件为这个工作区提供的标签页，在工作区的每个对话中都相同。",
  canvasChecklist:
    "Agent 工作的各个步骤，完成时会被勾选。你也可以勾选其中任何一项：Agent 会随你的下一条消息得知你的勾选。",
  checklistClose: "回到画布原先显示的内容。“清单”按钮可再次打开它。",
  checklistDismiss: "把清单从画布上永久移除。在 Agent 发布新的清单之前它不会再出现。",
  checklistPlan: "Agent 自己的待办列表，为它最后更新时的样子。只有 Agent 会勾选这些。",
  changesScope: {
    turn: "与这一轮开始时相比有差异的文件，无论是 Agent 还是其他东西造成的。",
    uncommitted: "git status：与上次提交有差异的文件，以及 Agent 在这个对话中编辑过的项目之外的文件。",
    session: "Agent 在这个对话中用编辑工具改动过的每个文件，即使后来的某一轮又改了回去；以及它的命令运行期间写入的文件，包括构建输出和它的提交。命令删除的文件，或它留下的作业之后写入的文件，不会列出；这个文件夹中另一个对话所写的文件也不会列出，判断依据是它运行期间其工具调用中提到了该文件。",
  },
  changesView: {
    list: "每个更改的文件各占一行，显示完整路径。保存在这个浏览器中。",
    tree: "按文件夹显示更改的文件。点击文件夹可折叠它。保存在这个浏览器中。",
    all: "按文件夹显示项目的每个文件，并标出有更改的。只有包含更改的文件夹一开始是展开的。保存在这个浏览器中。",
  },
  changesFoldAll: "折叠每个文件夹，只显示最上层。点击文件夹可再次展开。",
  changesIgnored: "显示或隐藏 git 忽略的、由 Agent 的命令写入的文件，例如构建输出。保存在这个浏览器中。",
  changesEditedByAgent: "这一轮中，这个对话的 Agent 用编辑工具改动的项目文件。",
  changesChangedOtherwise: "这一轮中，不是通过 Agent 的编辑工具改动的项目文件：由 Agent 运行的命令、你，或者在这个文件夹中工作的另一个对话或工具造成。",
  changesOthersMayHaveWritten:
    "在这个对话的命令运行期间写入，但另一个对话在这个文件夹中运行命令或编辑时也在写入，而两者运行的内容无法判断是谁写的。仅被另一个对话的工具调用提到的文件不会列出。",
  changesFromCommit: "这一轮开始后的某个提交改动了这个文件，例如 pull 带来的，或 Agent 自己的提交。",
  changesRefresh: "重新加载列表。Agent 每完成一次工具调用和轮次结束时也会重新加载。",
  changesByAgent: "这个对话的 Agent 用编辑工具改动了这个文件。",
  changesOpenInEditor: "在“设置 › 对话”中选择的编辑器里打开该文件，定位到第一处更改的行。",
  editDiffStyle: "“统一”把旧行和新行放在同一列；“并排”左边显示旧版本，右边显示新版本。保存在这个浏览器中。",
};

export const waitingHints: Messages["waitingHints"] = {
  permission: "需要你：Agent 在等你批准一个工具。",
  question: "需要你：Agent 在画布上向你提了一个问题。",
  finished: "完成：轮次在你看别处时结束了。打开这个对话会清除此标记。",
  error: "失败：轮次在你看别处时因出错而停止。打开这个对话会清除此标记。",
  unread: "未读：你把它标记为稍后回来看。打开这个对话会清除此标记。",
};

export const statusHints: Messages["statusHints"] = {
  idle: "空闲：等待你的下一条消息。",
  starting: "启动中：host 正在启动 Agent 进程，或在其上恢复会话。",
  running: "运行中：Agent 正在处理你的消息。按 Esc 或停止可取消这一轮。",
  error: "出错：Agent 无法启动或恢复。详情在标题栏下方。",
};
