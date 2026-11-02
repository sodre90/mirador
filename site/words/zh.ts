import type { SiteWords } from "./en.ts";

export const zh: SiteWords = {
  attributes: {
    title: "Mirador：给你的编程智能体一块画布",
    description:
      "Mirador 在对话旁边给你的编程智能体一块画布：它把想法画出来，用图来问你，并带你逐步看懂它的更改和审查。免费开源，支持 macOS、Linux 和 Windows。",
    ogDescription: "你的编程智能体把想法画出来，用图来问你，并带你逐步看懂它的更改和审查，就在对话旁边。",
    sections: "栏目",
    language: "语言",
    copy: "复制",
    copied: "已复制",
    trailer: "预告片",
    trailerAlt: "预告片：告别大段文字，你的智能体现在会画图了",
    trailerPlayer: "Mirador 预告片",
    canvasAlt: "一段关于结账流程的对话，旁边的画布上是智能体画的时序图",
    askAlt: "智能体询问要做哪种设置布局，每个选项都附有界面预览",
    tourAlt: "智能体对其修复的导览：左侧是步骤，右侧标出了 src/checkout.ts 中改动的那一行",
    reviewAlt: "一份打开在流程导览上的代码审查：步骤列表旁是当前步骤的讲解，下方是差异，并标出了该步骤涉及的行",
    changesAlt: "更改视图：一个项目中未提交的文件，智能体的编辑在其所在行下方展开",
    terminalsAlt: "对话下方并排的两个终端",
    privacyTitle: "隐私政策 · Mirador",
    privacyDescription: "Mirador 和 Mirador Android 版如何处理你的数据：数据留在你自己的设备上。",
  },
  nav: { features: "功能", install: "安装", faq: "常见问题" },
  hero: {
    eyebrow: "免费开源 · macOS、Linux 和 Windows",
    title: '一眼看懂你的编程智能体<span class="gradient">想说什么。</span>',
    lede: "Mirador 在对话旁边给你的编程智能体一块画布。它把想法画出来，用图来问你，带你逐步走过它的更改和审查，让你一眼就能看懂。",
    or: "或",
    windows: "Windows",
    download: "下载",
    star: "在 GitHub 上加星",
  },
  trailerCaption: "观看预告片（2:33）",
  why: {
    title: "写代码早已不是瓶颈，读代码才是。",
    body: "几分钟之内，智能体就能读完一个代码库、改掉十个文件，再用一长串文字解释它做了什么：同一种字体，以它打字的速度源源不断地涌来。人看图远比看字快：一张时序图让请求的来龙去脉一目了然，同样的内容写成文字却要一整页。Mirador 不是又一个智能体：它运行的就是你已经在用的那些，沿用你自己的设置，并给它们一个展示给你看的地方。",
  },
  show: {
    kicker: "展示",
    title: "你的智能体，把想法画出来。",
    body: "图表、界面原型、数据图、对比，甚至 3D 场景，都画在聊天旁边的画布上，而不是一整页文字。内置 Mermaid、D3 和 three.js，离线也能用。页面出现脚本错误时，智能体会收到通知并自行修复。",
  },
  ask: {
    kicker: "提问",
    title: "做决定，有图可看。",
    body: "智能体不再甩给你一串编号列表，而是在画布上提问：最多八个选项，每个都带预览。点选一个，或者输入你自己的答案并附上备注。多个问题一次问完，每题一页，发送前还能先整体检查一遍。",
  },
  tour: {
    kicker: "导览",
    title: "按代码运行的顺序，一步步走一遍。",
    body: "某个功能是怎么实现的，或者智能体刚刚改了什么：一段简短的总结，加上贯穿代码的步骤，每一步都对应具体的行，改动过的行会被标出。可以就任意几行提问，或者在 IntelliJ IDEA 中打开它们。",
  },
  review: {
    kicker: "审查",
    title: "可以一步步走读的代码审查。",
    body: "结论和总结、对这次更改的引导式导览、每一处差异，以及钉在对应代码行上的发现，每条都标明是已确认还是仅为怀疑。保留你认同的发现，改改措辞，再作为你的待提交审查发布到 GitHub 拉取请求上。",
  },
  more: {
    title: "与智能体共度一天，还有这些",
    changes: {
      title: "每一处更改，哪怕在项目之外",
      body: "这一轮或这次对话改了什么，或者所有未提交的工作，每个文件的差异点一下就能看到。",
    },
    terminals: { title: "每个对话旁都有一个 shell", body: "标签页和分屏在你切换时继续运行，重启后也会恢复。" },
    approve: { title: "看着差异批准每次编辑", body: "智能体请求的编辑会先显示在画布上，带着文件自己的行号，再由你决定是否允许。" },
    needsYou: { title: "一眼看出谁在等你", body: "所有项目都在一个侧边栏里，标出正在等你、已完成或已失败的对话。" },
    resume: { title: "从终端停下的地方接着来", body: "继续你在终端里开始的会话，完整历史一并带上。" },
    point: { title: "指着问", body: "指着智能体画的页面上的任何部分，就它提问，或者让它改。" },
    agents: {
      title: "你的智能体，齐聚一堂",
      body: "真正的智能体，带着你的 hooks 和 MCP 服务器。一个智能体可以把耗时但简单的任务交给另一个，比如本地模型，再检查交回来的结果。",
    },
    jobs: {
      title: "长任务，它会等",
      body: "智能体让构建或测试继续跑着，哪怕是在通过 ssh 连接的构建服务器上或容器里，任务结束时 Mirador 会叫醒它。",
    },
    plugins: {
      title: "插件",
      body: "官方插件为画布增加工具，比如 Media：在视频的某一帧上标出问题，智能体就会剪掉它并重新渲染。",
    },
    talk: { title: "跟它说话", body: "口述你的消息，听回复的要点，然后接着说，解放双手。" },
  },
  install: {
    title: "安装",
    unix: "在搭载 Apple 芯片的 Mac 上，或在 Linux（x64 或 arm64）上，这条命令会下载、安装并启动应用：",
    windows: "在 Windows（x64，实验性）上，在 PowerShell 中运行：",
    brew: "或者在 macOS 和 Linux 上用 Homebrew 安装：",
    notes:
      'macOS 应用已经过 Apple 签名和公证。Windows 应用尚未签名，所以手动运行安装程序时 SmartScreen 会发出警告。Linux 需要几个系统库，<a href="https://github.com/sodre90/mirador#get-it">README</a> 中列出了它们，还介绍了手动安装和从源码运行的方法。也可以从<a href="https://github.com/sodre90/mirador/releases/latest">最新版本</a>下载文件。之后，应用会自行更新。',
  },
  faq: {
    title: "常见问题",
    cost: {
      question: "要花多少钱？",
      answer: "分文不取。Mirador 以 MIT 许可证开源，无需注册账户。你照常使用智能体自己的订阅或 API 密钥。",
    },
    agents: {
      question: "它支持哪些编程智能体？",
      answer: "目前通过 Agent Client Protocol（ACP）支持 Claude Code、opencode、pi 和 Codex（后两者为实验性）。更多智能体即将到来。",
    },
    privacy: {
      question: "我的代码会离开我的电脑吗？",
      answer:
        "Mirador 运行在你的电脑上。你的智能体照常与它的模型提供商通信，而 Mirador 本身只会向 GitHub 查询是否有新版本。没有任何遥测。",
    },
    terminal: {
      question: "它会取代我的终端吗？",
      answer: "不会。它运行的是同一个智能体，带着你的设置、hooks 和 MCP 服务器，还能继续你在终端里开始的会话。",
    },
    phones: { question: "手机上能用吗？", answer: "Android 和 iOS 应用即将推出。" },
  },
  footer: { madeBy: "Mirador · MIT 许可证 · 由 Péter Erdős 开发", releases: "版本发布", trailer: "预告片", privacy: "隐私" },
  privacy: {
    title: "隐私政策",
    updated: "最后更新：2026 年 11 月 1 日",
    englishPrevails: '这是译文。如与<a href="../privacy.html">英文版隐私政策</a>有出入，以英文版为准。',
    intro:
      "本政策适用于 Mirador（你在电脑上运行的应用）和 Mirador Android 版（连接到它的手机应用）。两者均由 Péter Erdős 开发。简而言之：你的数据留在你自己的设备上。两个应用都没有账户、分析、广告或崩溃报告。唯一会经过我们运营的服务器的，是下文所述的可选通知服务和点对点服务，而它们无法读取你发送的内容。",
    computerTitle: "电脑上的 Mirador",
    computer:
      "Mirador 把你的对话、设置以及你邀请的设备保存在你电脑上的一个数据库中。你用它运行的编程智能体会与它们各自的模型提供商通信，适用这些提供商的条款，与不使用 Mirador 时一样。Mirador 本身只访问 GitHub，用于查看是否有新版本，以及下载它安装的插件。",
    androidTitle: "Mirador Android 版",
    android:
      "手机应用只连接你与它配对的 Mirador 电脑：通过你选择的网络（例如 Tailscale）直接连接，或按下文所述以点对点方式连接。手机与你电脑之间的每个连接都经过加密。它显示的内容来自这些电脑，你发送的内容也发往这些电脑：",
    messages: "你写的<strong>消息和回答</strong>会发送到运行该对话的电脑。",
    photos: "你附加的<strong>照片和截图</strong>，无论来自相机、相册还是其他应用的分享，都会上传到那台电脑。",
    camera: "<strong>相机</strong>用于扫描将手机与电脑配对的二维码，以及拍摄你选择附加的照片。",
    microphone:
      "<strong>麦克风</strong>仅在你按住发送按钮进行听写时使用。如果手机自带语音识别，你说的话会留在手机上。否则，由 Android 的语音输入服务将其转为文字，该服务可能依据其自己的隐私政策在其服务器上处理这些内容。",
    replies: "<strong>朗读的回复</strong>在你的电脑上生成，在手机上播放。",
    phoneStorage:
      "手机在自己的存储中保存与它配对的电脑、你的设置和未发送的草稿，其中各电脑的访问令牌保存在 Android 的安全存储中。开启应用锁后，指纹或面部解锁由 Android 验证；应用本身永远看不到它。",
    notificationsTitle: "应用关闭时的通知",
    notifications:
      "除非你在电脑上的 Mirador 中设置了推送中继，否则此功能处于关闭状态。开启后，手机会把它从 Firebase Cloud Messaging（Google 的推送服务）获得的通知令牌交给你的电脑，由你的电脑保存。为了通知你，你的电脑会把令牌和通知发送到推送中继，并用只有你的手机和电脑持有的密钥加以密封；推送中继再将它们转交给 Google 投递。中继（无论是我们的，还是你自己运行的）不会存储或记录令牌或通知。中继和 Google 能看到令牌以及通知的发送时间，但无法读取通知的内容。Google 依据其自己的隐私政策处理该令牌。",
    peerToPeerTitle: "点对点",
    peerToPeer:
      "除非你电脑上的 Mirador 设置为使用此功能，否则它处于关闭状态。开启后，手机和电脑通过一个中介服务器找到彼此，在它们连接期间，中介服务器能看到它们的公钥和网络地址。当它们无法直接互通时，它们的流量会经过中介服务器，并经过加密，使中介服务器无法读取。",
    deletingTitle: "删除你的数据",
    deleting:
      "卸载应用会删除它存储的所有内容。要阻止某部手机访问某台电脑，请在 Mirador 的<strong>设置 → 设备</strong>中将其移除；这也会从那台电脑上删除该手机的通知令牌。",
    sharingTitle: "分享与出售",
    sharing:
      "我们不会出售你的数据，也不会与任何人分享，除了投递通知和建立连接之外，不会将其用于任何其他用途。Google Play 可能会依据 Google 自己的隐私政策收集有关安装和应用崩溃的数据。",
    childrenTitle: "儿童",
    children: "Mirador 是面向软件开发者的工具，并非为儿童设计。",
    changesTitle: "变更与疑问",
    changes:
      '本政策的变更会发布在此页面上，并注明新的日期。如有疑问，请在 <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a> 提交 issue。',
  },
};
