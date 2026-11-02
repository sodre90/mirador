import type { SiteWords } from "./en.ts";

export const zh: SiteWords = {
  attributes: {
    title: "Mirador：给你的编程 Agent 一块画布",
    description:
      "Mirador 在对话旁边给编程 Agent 一块画布：它用图讲思路，用图问问题，还带你过一遍它的改动和代码审查。免费开源，支持 macOS、Linux 和 Windows。",
    ogDescription: "你的编程 Agent 用图讲思路，用图问问题，还带你过一遍它的改动和代码审查，就在对话旁边。",
    sections: "目录",
    language: "语言",
    copy: "复制",
    copied: "已复制",
    trailer: "预告片",
    trailerAlt: "预告片：告别大段文字，Agent 会画图了",
    trailerPlayer: "Mirador 预告片",
    canvasAlt: "一段关于结账流程的对话，旁边画布上是 Agent 画的时序图",
    askAlt: "Agent 在问要做哪种设置页布局，每个选项都带一张界面预览",
    tourAlt: "Agent 对自己这次修复的导览：左边是步骤，右边标出了 src/checkout.ts 里改动的那一行",
    reviewAlt: "一份代码审查，停在流程导览上：步骤列表旁是当前步骤的讲解，下面是 diff，标出了这一步涉及的行",
    changesAlt: "改动视图：项目里未提交的文件，Agent 的编辑在对应文件下方展开",
    terminalsAlt: "对话下方并排的两个终端",
    privacyTitle: "隐私政策 · Mirador",
    privacyDescription: "Mirador 和 Mirador Android 版如何处理你的数据：数据只留在你自己的设备上。",
  },
  nav: { features: "功能", install: "安装", faq: "常见问题" },
  hero: {
    eyebrow: "免费开源 · macOS、Linux 和 Windows",
    title: '一眼看懂<br><span class="gradient">你的编程 Agent 在想什么。</span>',
    lede: "Mirador 在对话旁边给编程 Agent 一块画布。它用图讲思路，用图问问题，还带你过一遍它的改动和代码审查，一眼就能看明白。",
    or: "或",
    windows: "Windows",
    download: "下载",
    star: "GitHub 点个 Star",
  },
  trailerCaption: "观看预告片（2:33）",
  why: {
    title: "写代码不再是瓶颈，读代码才是。",
    body: "几分钟里，Agent 读完一个代码库、改了十个文件，然后用一大段文字解释它干了什么：清一色的字体，按它打字的速度往外刷。人看图比看字快得多：一张时序图能让请求链路一目了然，写成文字却要一整页。Mirador 不是又一个 Agent：它跑的就是你现在在用的那些，设置照旧，只是多给了它们一个画给你看的地方。",
  },
  show: {
    kicker: "画图",
    title: "Agent 用图讲思路。",
    body: "架构图、界面原型、数据图表、方案对比，甚至 3D 场景，都画在聊天旁边的画布上，不再是满屏文字。内置 Mermaid、D3 和 three.js，离线可用。页面报了脚本错误，Agent 会收到并自己修好。",
  },
  ask: {
    kicker: "选择",
    title: "做决定，看图说话。",
    body: "Agent 不再甩给你一串编号选项，而是在画布上问：最多八个选项，每个都带预览。点一个，或者自己输入答案、附上备注。多个问题一次问完，一题一页，发送前还能回头检查一遍。",
  },
  tour: {
    kicker: "代码导览",
    title: "按代码执行的顺序，带你走一遍。",
    body: "某个功能是怎么跑的，或者 Agent 刚改了什么：一段简短总结，加上一步步穿过代码的讲解，每步都对应具体的行，改过的行会标出来。对哪几行有疑问直接问，或者在 IntelliJ IDEA 里打开。",
  },
  review: {
    kicker: "代码审查",
    title: "可以一步步走读的代码审查。",
    body: "结论和总结、这次改动的导览、每一处 diff，以及钉在对应行上的问题，每条都标明是已确认还是只是怀疑。留下你认同的，改改措辞，再作为你的待提交 review 发到 GitHub 的 PR 上。",
  },
  more: {
    title: "和 Agent 一起干活的一整天，还有这些",
    changes: {
      title: "每一处改动，项目外的也算",
      body: "这一轮或这次对话改了什么，或者全部未提交的改动，每个文件的 diff 点一下就能看。",
    },
    terminals: { title: "每个对话旁边都有一个 shell", body: "标签页和分屏在你切走时继续跑，重启后也还在。" },
    approve: { title: "看着 diff 批准每次编辑", body: "Agent 想改哪里，先在画布上显示出来，带着文件本身的行号，再由你决定放不放行。" },
    needsYou: { title: "谁在等你，一眼看到", body: "所有项目都在同一个侧边栏里，标出哪些对话在等你、已完成或失败了。" },
    resume: { title: "从终端停下的地方接着来", body: "继续你在终端里开的会话，完整历史一起带过来。" },
    point: { title: "指哪问哪", body: "指着 Agent 画的页面上的任何地方，就它提问，或者让它改。" },
    agents: {
      title: "你的 Agent 们，一起上",
      body: "真正的 Agent，带着你的 hooks 和 MCP server。一个 Agent 可以把又长又简单的活交给另一个，比如本地模型，再检查交回来的结果。",
    },
    jobs: {
      title: "长任务，它会等",
      body: "Agent 让 build 或测试继续跑着，哪怕是在 ssh 连的构建机上或容器里，跑完后 Mirador 会叫醒它。",
    },
    plugins: {
      title: "插件",
      body: "官方插件给画布加工具，比如 Media：在视频某一帧上标出问题，Agent 就把它剪掉并重新渲染。",
    },
    talk: { title: "跟它说话", body: "口述你的消息，听回复的要点，然后接着说，不用动手。" },
  },
  install: {
    title: "安装",
    unix: "在 Apple 芯片的 Mac 上，或在 Linux（x64 或 arm64）上，这一条命令就能下载、安装并启动：",
    windows: "在 Windows（x64，实验性）上，在 PowerShell 里运行：",
    brew: "或者在 macOS 和 Linux 上用 Homebrew：",
    notes:
      'macOS 应用已由 Apple 签名和公证。Windows 应用还没签名，所以手动运行安装程序时 SmartScreen 会弹警告。Linux 需要几个系统库，<a href="https://github.com/sodre90/mirador#get-it">README</a> 里列了，还有手动安装和从源码运行的方法。也可以直接从<a href="https://github.com/sodre90/mirador/releases/latest">最新 release</a> 下载文件。装好之后，应用会自动更新。',
  },
  faq: {
    title: "常见问题",
    cost: {
      question: "多少钱？",
      answer: "免费。Mirador 以 MIT 许可证开源，不用注册账号。你照常用 Agent 自己的订阅或 API key。",
    },
    agents: {
      question: "支持哪些编程 Agent？",
      answer: "目前通过 Agent Client Protocol（ACP）支持 Claude Code、opencode、pi、Codex 和 Copilot（后三者为实验性）。更多 Agent 在路上。",
    },
    privacy: {
      question: "我的代码会离开我的电脑吗？",
      answer:
        "Mirador 跑在你自己的电脑上。你的 Agent 照常和它的模型服务商通信，Mirador 本身只会向 GitHub 查一下有没有新版本。没有任何遥测。",
    },
    terminal: {
      question: "它会取代我的终端吗？",
      answer: "不会。它跑的是同一个 Agent，带着你的设置、hooks 和 MCP server，还能接着你在终端里开的会话继续。",
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
      "Mirador 把你的对话、设置以及你邀请的设备保存在你电脑上的一个数据库中。你用它运行的编程 Agent 会与各自的模型服务商通信，适用这些服务商的条款，与不使用 Mirador 时一样。Mirador 本身只访问 GitHub，用于查看是否有新版本，以及下载它安装的插件。",
    androidTitle: "Mirador Android 版",
    android:
      "手机应用只连接你与它配对的 Mirador 电脑：通过你选择的网络（例如 Tailscale）直接连接，或按下文所述以点对点方式连接。手机与你电脑之间的每个连接都经过加密。它显示的内容来自这些电脑，你发送的内容也发往这些电脑：",
    messages: "你写的<strong>消息和回答</strong>会发送到运行该对话的电脑。",
    photos: "你附加的<strong>照片和截图</strong>，无论来自相机、相册还是其他应用的分享，都会上传到那台电脑。",
    camera: "<strong>相机</strong>用于扫描将手机与电脑配对的二维码，以及拍摄你选择附加的照片。",
    microphone:
      "<strong>麦克风</strong>仅在你按住发送按钮进行语音输入时使用。如果手机自带语音识别，你说的话会留在手机上。否则，由 Android 的语音输入服务将其转为文字，该服务可能依据其自己的隐私政策在其服务器上处理这些内容。",
    replies: "<strong>朗读的回复</strong>在你的电脑上生成，在手机上播放。",
    phoneStorage:
      "手机在自己的存储中保存与它配对的电脑、你的设置和未发送的草稿，其中各电脑的访问令牌保存在 Android 的安全存储中。开启应用锁后，指纹或面部解锁由 Android 验证；应用本身永远看不到它。",
    notificationsTitle: "应用关闭时的通知",
    notifications:
      "除非你在电脑上的 Mirador 中设置了推送中继，否则此功能处于关闭状态。开启后，手机会把它从 Firebase Cloud Messaging（Google 的推送服务）获得的通知令牌交给你的电脑，由你的电脑保存。为了通知你，你的电脑会把令牌和通知发送到推送中继，并用只有你的手机和电脑持有的密钥加密；推送中继再将它们转交给 Google 投递。中继（无论是我们的，还是你自己运行的）不会存储或记录令牌或通知。中继和 Google 能看到令牌以及通知的发送时间，但无法读取通知的内容。Google 依据其自己的隐私政策处理该令牌。",
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
      '本政策的变更会发布在此页面上，并注明新的日期。如有疑问，请在 <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a> 提 issue。',
  },
};
