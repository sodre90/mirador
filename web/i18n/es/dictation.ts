import type { Messages } from "../en/index.ts";

export const dictation: Messages["dictation"] = {
  dictate: "Dictar",
  youSaid: (said) => `Dijiste: ${said}`,
  hideWhatYouSaid: "Ocultar lo que dijiste",
  recognitionOff: "Para dictar hace falta el reconocimiento de voz. Puedes activarlo en Configuración → Voz.",
  nothingHeard: "No se oyó nada, así que el dictado se detuvo.",
  noWords: "El reconocimiento de voz no oyó ninguna palabra.",
  nothingToRepeat: "Aún no se ha leído en voz alta ninguna respuesta aquí, así que no hay nada que repetir.",
  didNotReachMirador: (problem) => `Lo que dijiste no llegó a Mirador: ${problem}`,
  recognitionFailed: (status) => `El reconocimiento de voz falló (${status}).`,
  replyDidNotReachMirador: (problem) => `La respuesta no llegó a Mirador para leerla en voz alta: ${problem}`,
  readingAloudFailed: (status) => `No se pudo leer la respuesta en voz alta (${status}).`,
  startingMicrophone: "Iniciando el micrófono…",
  listening: {
    message: "Escuchando… Se detiene cuando haces una pausa o sueltas. Esc cancela.",
    conversation: "Escuchando… Di “stop” para terminar, “repeat that” para oírlo de nuevo o “help” para más opciones.",
    answer: "Escuchando… Di “yes”, “the others”, un número, o responde con tus propias palabras.",
  },
  loadingRecognition: "Cargando el reconocimiento de voz en este Mac…",
  loadingVoiceModel: "Cargando el modelo de voz en este Mac…",
  transcribing: "Convirtiendo la voz en texto…",
  microphone: {
    macSetting: " y en Configuración del Sistema → Privacidad y seguridad → Micrófono",
    windowsSetting: " y en Configuración de Windows → Privacidad y seguridad → Micrófono, que las aplicaciones de escritorio también necesitan",
    insecure: "Las páginas solo pueden usar el micrófono cuando se abren por https o en localhost. Abre Mirador en una de esas formas para dictar.",
    desktopAppCannot: "Esta versión de la aplicación de escritorio no puede usar el micrófono. Actualízala o vuelve a hacer el build, o dicta en un navegador.",
    browserCannot: "Este navegador no permite que las páginas usen el micrófono.",
    desktopAppNotAllowed: (systemSetting) =>
      `Mirador no tiene permiso para usar el micrófono. Permítelo cuando la aplicación de escritorio lo pida${systemSetting}. Si lo bloqueas en la aplicación, el bloqueo dura hasta que se cierre.`,
    notAllowed: "Mirador no tiene permiso para usar el micrófono. Puedes permitirlo en los ajustes del navegador para este sitio.",
    notFound: "No hay ningún micrófono con el que escuchar.",
    didNotStart: (detail) => `El micrófono no se inició: ${detail}`,
  },
  readAloud: "Leer en voz alta",
  stopReading: "Dejar de leer",
};
