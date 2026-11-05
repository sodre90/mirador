import type { Messages } from "../en/index.ts";

export const dictation: Messages["dictation"] = {
  dictate: "Diktálás",
  youSaid: (said) => `Ezt mondtad: ${said}`,
  hideWhatYouSaid: "Az elmondottak elrejtése",
  recognitionOff: "A diktáláshoz beszédfelismerés kell. A Beállítások → Hang részben kapcsolhatod be.",
  nothingHeard: "Semmi sem hallatszott, ezért a diktálás leállt.",
  noWords: "A beszédfelismerés nem hallott szavakat.",
  didNotReachMirador: (problem) => `Amit mondtál, nem jutott el a Miradorhoz: ${problem}`,
  recognitionFailed: (status) => `A beszédfelismerés nem sikerült (${status}).`,
  replyDidNotReachMirador: (problem) => `A válasz nem jutott el a Miradorhoz, hogy felolvassa: ${problem}`,
  readingAloudFailed: (status) => `A válasz felolvasása nem sikerült (${status}).`,
  startingMicrophone: "A mikrofon indul…",
  listening: {
    message: "Figyelek… Megáll, ha szünetet tartasz vagy elengeded. Az Esc megszakítja.",
    conversation: "Figyelek… Mondd, hogy „stop” a befejezéshez, „repeat that” az ismétléshez, vagy „help” a többihez.",
    answer: "Figyelek… Mondd, hogy „yes”, „the others”, egy számot, vagy válaszolj a saját szavaiddal.",
  },
  loadingRecognition: "A beszédfelismerés betöltése ezen a Macen…",
  loadingVoiceModel: "A hangmodell betöltése ezen a Macen…",
  transcribing: "A beszéd szöveggé alakítása…",
  microphone: {
    macSetting: ", valamint a Rendszerbeállítások → Adatvédelem és biztonság → Mikrofon részben",
    windowsSetting: ", valamint a Windows Gépház → Adatvédelem és biztonság → Mikrofon részben, amire az asztali alkalmazásoknak is szükségük van",
    insecure: "Az oldalak csak https-en vagy localhoston megnyitva használhatják a mikrofont. A diktáláshoz ezek egyikén nyisd meg a Miradort.",
    desktopAppCannot: "Az asztali alkalmazás ezen buildje nem tudja használni a mikrofont. Frissítsd vagy buildeld újra, vagy diktálj böngészőben.",
    browserCannot: "Ez a böngésző nem engedi, hogy az oldalak használják a mikrofont.",
    desktopAppNotAllowed: (systemSetting) =>
      `A Mirador nem használhatja a mikrofont. Engedélyezd, amikor az asztali alkalmazás rákérdez${systemSetting}. Ha az alkalmazásban letiltod, az az alkalmazás bezárásáig érvényes.`,
    notAllowed: "A Mirador nem használhatja a mikrofont. A böngésző beállításaiban ennél az oldalnál engedélyezheted.",
    notFound: "Nincs mikrofon, amellyel figyelni lehetne.",
    didNotStart: (detail) => `A mikrofon nem indult el: ${detail}`,
  },
  readAloud: "Felolvasás",
  stopReading: "Felolvasás leállítása",
};
