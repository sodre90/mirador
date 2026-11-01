import type { Messages } from "../en/index.ts";

export const problems: Messages["problems"] = {
  couldNotResume: (cause) => `Az ágens előző munkamenetét nem sikerült folytatni (${cause}), ezért új indul.`,
  couldNotSetOption: (option, value, cause) => `Nem sikerült átállítani (${option} → ${value}): ${cause}`,
  optionChangeUnanswered: (option, current, value, seconds) =>
    `${option}: még mindig ez az érték: ${current}. Az ágens ${seconds} másodperce nem válaszolt a változtatásra (${value}). Akkor változik, amikor az ágens válaszol.`,
  usageLimitReached: "Elérted Claude használati korlátját.",
  conversationHasNoProfile: "Ennek a beszélgetésnek nincs profilja, vagy a profilját törölték. Válassz profilt a beszélgetés tetején.",
  workspaceGone: "A munkaterület már nem létezik.",
  conversationDeletedWhileOpening: "A beszélgetést törölték, miközben az ágens munkamenete megnyílt.",
  agentCannotLoadSessions: (agent) => `Ez az ágens nem tud meglévő munkamenetet betölteni: ${agent}.`,
  agentCannotForkSessions: (agent) => `Ez az ágens nem tud munkamenetet elágaztatni: ${agent}.`,
  opencodeNotInstalled: "Az opencode nincs telepítve: nincs opencode program a PATH-on vagy a szokásos telepítési mappákban.",
  piNotInstalled: "A pi nincs telepítve: nincs pi program a PATH-on. Telepítsd így: npm install -g @earendil-works/pi-coding-agent.",
  claudeProgramMissing: (program) => `A Beállítások › Ágensek alatt megadott Claude Code program nem létezik, vagy nem indítható: ${program}`,
  claudeNotInstalled: (installFolders, installCommand) =>
    `A Claude Code nincs telepítve: nincs claude a PATH-on, sem itt: ${installFolders}. Telepítsd így: \`${installCommand}\`, vagy add meg az útvonalát a Beállítások › Ágensek alatt.`,
  profileEnvironmentInvalid: (profile, errors) => `Hibás a profil környezete („${profile}”): ${errors}`,
  agentNotRunning: (agent) => `Az ágens nem fut: ${agent}`,
  agentGone: (agent, gone) => `Az ágens folyamata (${agent}) ${gone}.`,
  gone: {
    "not-running": "nem fut",
    stopped: "leállt",
    "force-stopped": "kényszerített leállítással leállt",
    "restarted-for-profile": "újraindult, mert megváltozott a profilja",
    "restarted-for-claude-program": "újraindult, mert megváltozott a Claude Code program",
    noAnswer: (seconds) => `nem válaszolt az indulás utáni ${seconds} másodpercben`,
    exited: (how) => `kilépett (${how})`,
    couldNotStart: (cause) => `nem tudott elindulni: ${cause}`,
  },
  prelaunchFailed: (agent, failure, output) => `Az indítás előtti parancs (${agent}) ${failure}${output ? `: ${output}` : ""}`,
  prelaunch: {
    timedOut: (seconds) => `${seconds} másodperc után túllépte az időkorlátot`,
    exited: (how) => `kilépett (${how})`,
    couldNotRun: (cause) => `nem futott le: ${cause}`,
  },
  imageMissing: "Az üzenet egyik képe hiányzik, illeszd be újra.",
  notAnImageOfConversation: "Ez nem ennek a beszélgetésnek a képe.",
  unknownConversation: "Ismeretlen beszélgetés.",
  agentStillWorking: "Az ágens még az előző üzeneten dolgozik.",
};
