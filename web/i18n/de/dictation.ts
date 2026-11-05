import type { Messages } from "../en/index.ts";

export const dictation: Messages["dictation"] = {
  dictate: "Diktieren",
  youSaid: (said) => `Du hast gesagt: ${said}`,
  hideWhatYouSaid: "Ausblenden, was du gesagt hast",
  recognitionOff: "Zum Diktieren braucht es die Spracherkennung. Du kannst sie unter Einstellungen → Stimme einschalten.",
  nothingHeard: "Es war nichts zu hören, deshalb wurde das Diktat beendet.",
  noWords: "Die Spracherkennung hat keine Wörter gehört.",
  didNotReachMirador: (problem) => `Was du gesagt hast, ist nicht bei Mirador angekommen: ${problem}`,
  recognitionFailed: (status) => `Die Spracherkennung ist fehlgeschlagen (${status}).`,
  replyDidNotReachMirador: (problem) => `Die Antwort ist zum Vorlesen nicht bei Mirador angekommen: ${problem}`,
  readingAloudFailed: (status) => `Das Vorlesen der Antwort ist fehlgeschlagen (${status}).`,
  startingMicrophone: "Mikrofon wird gestartet…",
  listening: {
    message: "Hört zu… Es stoppt, wenn du eine Pause machst oder loslässt. Esc bricht ab.",
    conversation: "Hört zu… Sag „stop“ zum Beenden, „repeat that“, um es noch einmal zu hören, oder „help“ für mehr.",
    answer: "Hört zu… Sag „yes“, „the others“, eine Zahl, oder antworte in deinen eigenen Worten.",
  },
  loadingRecognition: "Spracherkennung wird auf diesem Mac geladen…",
  loadingVoiceModel: "Sprachmodell wird auf diesem Mac geladen…",
  transcribing: "Sprache wird in Text umgewandelt…",
  microphone: {
    macSetting: " und in den Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon",
    windowsSetting: " und in den Windows-Einstellungen → Datenschutz und Sicherheit → Mikrofon, was auch Desktop-Apps brauchen",
    insecure: "Seiten dürfen das Mikrofon nur nutzen, wenn sie über https oder unter localhost geöffnet sind. Öffne Mirador auf eine dieser Arten, um zu diktieren.",
    desktopAppCannot: "Dieser Build der Desktop-App kann das Mikrofon nicht nutzen. Aktualisiere oder baue sie neu, oder diktiere in einem Browser.",
    browserCannot: "Dieser Browser lässt Seiten das Mikrofon nicht nutzen.",
    desktopAppNotAllowed: (systemSetting) =>
      `Mirador darf das Mikrofon nicht nutzen. Erlaube es, wenn die Desktop-App fragt${systemSetting}. Eine Sperre in der App gilt, bis die App beendet wird.`,
    notAllowed: "Mirador darf das Mikrofon nicht nutzen. Die Einstellungen des Browsers für diese Seite können es erlauben.",
    notFound: "Es wurde kein Mikrofon gefunden.",
    didNotStart: (detail) => `Das Mikrofon ist nicht gestartet: ${detail}`,
  },
  readAloud: "Vorlesen",
  stopReading: "Vorlesen stoppen",
};
