import type { Messages } from "../en/index.ts";

export const problems: Messages["problems"] = {
  couldNotResume: (cause) => `No se pudo reanudar la sesión anterior del agente (${cause}); se empieza una nueva.`,
  couldNotSetOption: (option, value, cause) => `No se pudo cambiar ${option} a ${value}: ${cause}`,
  optionChangeUnanswered: (option, current, value, seconds) =>
    `${option} sigue en ${current}: el agente no respondió al cambio a ${value} en ${seconds} segundos. Cambiará cuando el agente responda.`,
  usageLimitReached: "Se alcanzó el límite de uso de Claude.",
  conversationHasNoProfile: "Esta conversación no tiene perfil, o se eliminó su perfil. Elige un perfil en la parte superior de la conversación.",
  workspaceGone: "El espacio de trabajo ya no existe.",
  conversationDeletedWhileOpening: "La conversación se eliminó mientras se abría la sesión de su agente.",
  agentCannotLoadSessions: (agent) => `${agent} no puede cargar sesiones existentes.`,
  agentCannotForkSessions: (agent) => `${agent} no puede bifurcar sesiones.`,
  opencodeNotInstalled: "opencode no está instalado: no hay un ejecutable opencode en el PATH ni en sus carpetas de instalación habituales.",
  piNotInstalled: "pi no está instalado: no hay un ejecutable pi en el PATH. Instálalo con npm install -g @earendil-works/pi-coding-agent.",
  claudeProgramMissing: (program) => `El programa de Claude Code indicado en Configuración › Agentes no existe o no se puede ejecutar: ${program}`,
  claudeNotInstalled: (installFolders, installCommand) =>
    `Claude Code no está instalado: no hay claude en el PATH ni en ${installFolders}. Instálalo con \`${installCommand}\`, o indica su ruta en Configuración › Agentes.`,
  profileEnvironmentInvalid: (profile, errors) => `El perfil “${profile}” tiene un entorno no válido: ${errors}`,
  agentNotRunning: (agent) => `El agente no está en marcha: ${agent}`,
  agentGone: (agent, gone) => `El proceso del agente ${agent} ${gone}.`,
  gone: {
    "not-running": "no está en marcha",
    stopped: "se detuvo",
    "force-stopped": "se detuvo a la fuerza",
    "restarted-for-profile": "se reinició porque cambió su perfil",
    "restarted-for-claude-program": "se reinició porque cambió el programa de Claude Code",
    noAnswer: (seconds) => `no respondió en los ${seconds} s siguientes a su inicio`,
    exited: (how) => `terminó con ${how}`,
    couldNotStart: (cause) => `no pudo iniciarse: ${cause}`,
  },
  prelaunchFailed: (agent, failure, output) => `El comando previo al inicio de ${agent} ${failure}${output ? `: ${output}` : ""}`,
  prelaunch: {
    timedOut: (seconds) => `superó el tiempo límite de ${seconds} s`,
    exited: (how) => `terminó con ${how}`,
    couldNotRun: (cause) => `no se pudo ejecutar: ${cause}`,
  },
  imageMissing: "Falta una imagen de este mensaje; pégala de nuevo.",
  notAnImageOfConversation: "Esa no es una imagen de esta conversación.",
  unknownConversation: "Conversación desconocida.",
  agentStillWorking: "El agente todavía está trabajando en el mensaje anterior.",
};
