import type { Messages } from "../en/index.ts";

export const dictation: Messages["dictation"] = {
  dictate: "听写",
  youSaid: (said) => `你说的是：${said}`,
  hideWhatYouSaid: "隐藏你说的内容",
  recognitionOff: "听写需要语音识别。可以在设置 → 语音中打开。",
  nothingHeard: "没有听到任何声音，听写已停止。",
  noWords: "语音识别没有听到任何词。",
  nothingToRepeat: "这里还没有朗读过任何回复，所以没有可重复的内容。",
  didNotReachMirador: (problem) => `你说的话没有传到 Mirador：${problem}`,
  recognitionFailed: (status) => `语音识别失败（${status}）。`,
  replyDidNotReachMirador: (problem) => `回复没有传到 Mirador，无法朗读：${problem}`,
  readingAloudFailed: (status) => `朗读回复失败（${status}）。`,
  startingMicrophone: "正在启动麦克风…",
  listening: {
    message: "正在聆听…你停顿或松开后会自动停止。按 Esc 取消。",
    conversation: "正在聆听…说“stop”结束，说“repeat that”再听一遍，说“help”查看更多。",
    answer: "正在聆听…说“yes”、“the others”、一个数字，或用你自己的话回答。",
  },
  loadingRecognition: "正在这台 Mac 上加载语音识别…",
  loadingVoiceModel: "正在这台 Mac 上加载语音模型…",
  transcribing: "正在把语音转成文字…",
  microphone: {
    macSetting: "，以及在“系统设置 → 隐私与安全性 → 麦克风”中",
    windowsSetting: "，以及在 Windows 设置 → 隐私和安全性 → 麦克风中（桌面应用也需要）",
    insecure: "页面只有通过 https 或在 localhost 上打开时才能使用麦克风。请用其中一种方式打开 Mirador 来听写。",
    desktopAppCannot: "这个版本的桌面应用无法使用麦克风。请更新或重新构建，或者在浏览器中听写。",
    browserCannot: "这个浏览器不允许页面使用麦克风。",
    desktopAppNotAllowed: (systemSetting) =>
      `Mirador 无权使用麦克风。桌面应用询问时请允许${systemSetting}。在应用中拒绝后，会一直保持到应用退出。`,
    notAllowed: "Mirador 无权使用麦克风。可以在浏览器针对此网站的设置中允许。",
    notFound: "没有可用的麦克风。",
    didNotStart: (detail) => `麦克风没有启动：${detail}`,
  },
  readAloud: "朗读",
  stopReading: "停止朗读",
};
