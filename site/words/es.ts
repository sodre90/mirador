import type { SiteWords } from "./en.ts";

export const es: SiteWords = {
  attributes: {
    title: "Mirador: un lienzo para tu agente de código",
    description:
      "Mirador le da a tu agente de código un lienzo junto a la conversación: dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y revisiones. Gratis y de código abierto, para macOS, Linux y Windows.",
    ogDescription: "Tu agente de código dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y revisiones, justo al lado de la conversación.",
    sections: "Secciones",
    language: "Idioma",
    copy: "Copiar",
    copied: "Copiado",
    trailer: "Tráiler",
    trailerAlt: "El tráiler: se acabaron los muros de texto, ahora tu agente dibuja",
    trailerPlayer: "Tráiler de Mirador",
    canvasAlt: "Una conversación sobre un flujo de pago, con el diagrama de secuencia del agente en el lienzo de al lado",
    askAlt: "El agente pregunta qué diseño de configuración construir, con una maqueta de cada opción",
    tourAlt: "El recorrido del agente por su corrección: los pasos a la izquierda y la línea cambiada de src/checkout.ts marcada a la derecha",
    reviewAlt: "Una revisión de código abierta en su recorrido del flujo: los pasos junto a la explicación del paso actual, y debajo el diff con las líneas del paso marcadas",
    changesAlt: "La vista Cambios: los archivos sin confirmar de un proyecto, con la edición del agente abierta bajo su fila",
    terminalsAlt: "Dos terminales lado a lado bajo la conversación",
    privacyTitle: "Política de privacidad · Mirador",
    privacyDescription: "Qué hacen Mirador y Mirador para Android con tus datos: se quedan en tus propios dispositivos.",
  },
  nav: { features: "Funciones", install: "Instalar", faq: "Preguntas" },
  hero: {
    eyebrow: "Gratis y de código abierto · macOS, Linux y Windows",
    title: 'Mira lo que tu agente de código <span class="gradient">quiere decir.</span>',
    lede: "Mirador le da a tu agente de código un lienzo junto a la conversación. Dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y revisiones, para que los entiendas de un vistazo.",
    or: "o",
    windows: "Windows",
    download: "Descargar",
    star: "Dale una estrella en GitHub",
  },
  trailerCaption: "Mira el tráiler (2:33)",
  why: {
    title: "Escribir código ya no es lo lento. Leerlo, sí.",
    body: "En pocos minutos, un agente lee una base de código, cambia diez archivos y explica lo que hizo en un largo chorro de texto, todo en la misma fuente y a la velocidad a la que escribe. Las personas entienden las imágenes mucho más rápido que el texto: un diagrama de secuencia explica el recorrido de una petición de un vistazo, mientras que en prosa ocupa una página. Mirador no es otro agente: ejecuta los que ya usas, con tu propia configuración, y les da un lugar donde mostrártelo.",
  },
  show: {
    kicker: "Mostrar",
    title: "Tu agente dibuja lo que quiere decir.",
    body: "Diagramas, maquetas, gráficos, comparaciones, incluso escenas 3D, en un lienzo junto al chat en lugar de una página de prosa. Mermaid, D3 y three.js vienen incluidos y funcionan sin conexión. Si una página tiene un error de script, el agente se entera y lo corrige.",
  },
  ask: {
    kicker: "Preguntar",
    title: "Decisiones con imágenes.",
    body: "En lugar de una lista numerada en texto, el agente pregunta en el lienzo: hasta ocho opciones, cada una con su vista previa. Haz clic en una, o escribe tu propia respuesta y agrega una nota. Varias preguntas llegan juntas, una por página, con un repaso antes de enviar.",
  },
  tour: {
    kicker: "Recorrido",
    title: "Un paseo por el código, en el orden en que se ejecuta.",
    body: "Cómo funciona algo, o qué acaba de cambiar el agente: un breve resumen y pasos por el código, cada uno con sus líneas y las cambiadas marcadas. Pregunta por cualquier línea, o ábrela en IntelliJ IDEA.",
  },
  review: {
    kicker: "Revisión",
    title: "Una revisión de código que puedes recorrer.",
    body: "El veredicto y el resumen, un recorrido guiado por el cambio, cada diff y los hallazgos fijados a sus líneas, cada uno marcado como confirmado o solo sospechado. Quédate con los hallazgos que compartes, cámbiales la redacción y publícalos en el pull request de GitHub como tu revisión pendiente.",
  },
  more: {
    title: "Y el resto de tu día con un agente",
    changes: {
      title: "Cada cambio, incluso fuera del proyecto",
      body: "Lo que cambió este turno o esta conversación, o todo el trabajo sin confirmar, con el diff de cada archivo a un clic.",
    },
    terminals: { title: "Una shell junto a cada conversación", body: "Pestañas y divisiones que siguen ejecutándose mientras cambias de una a otra, y vuelven tras un reinicio." },
    approve: { title: "Aprueba cada edición con su diff", body: "Una edición solicitada aparece en el lienzo, con los números de línea del propio archivo, antes de que la permitas." },
    needsYou: { title: "Mira quién te necesita", body: "Todos los proyectos en una barra lateral, marcando las conversaciones que te esperan, terminaron o fallaron." },
    resume: { title: "Retoma lo que empezaste en la terminal", body: "Continúa una sesión que iniciaste en una terminal, con todo su historial." },
    point: { title: "Señala y pregunta", body: "Señala cualquier parte de una página que dibujó el agente y pregunta por ella o pide que la cambie." },
    agents: {
      title: "Tus agentes, juntos",
      body: "Los agentes de verdad, con tus hooks y servidores MCP. Uno puede pasarle a otro, como un modelo local, una tarea larga y sencilla, y revisar lo que devuelve.",
    },
    jobs: {
      title: "Espera los trabajos largos",
      body: "El agente deja en marcha una compilación o una ejecución de pruebas, incluso en un servidor de compilación por ssh o en un contenedor, y Mirador lo despierta cuando el trabajo termina.",
    },
    plugins: {
      title: "Complementos",
      body: "Los complementos oficiales agregan herramientas al lienzo, como Media: marca lo que está mal en un fotograma de un video, y el agente lo corta y lo renderiza.",
    },
    talk: { title: "Háblale", body: "Dicta tu mensaje, escucha lo esencial de la respuesta y sigue hablando, con las manos libres." },
  },
  install: {
    title: "Instalar",
    unix: "En un Mac con Apple Silicon, o en Linux (x64 o arm64), esto descarga la aplicación, la instala y la inicia:",
    windows: "En Windows (x64, experimental), en PowerShell:",
    brew: "O con Homebrew, en macOS y Linux:",
    notes:
      'La aplicación de macOS está firmada y notarizada por Apple. La de Windows aún no está firmada, así que SmartScreen avisa cuando ejecutas su instalador a mano. Linux necesita algunas bibliotecas del sistema, y el <a href="https://github.com/sodre90/mirador#get-it">README</a> las enumera, junto con cómo instalar a mano y ejecutar desde el código fuente. O descarga los archivos de la <a href="https://github.com/sodre90/mirador/releases/latest">última versión</a>. Después, la aplicación se actualiza sola.',
  },
  faq: {
    title: "Preguntas",
    cost: {
      question: "¿Cuánto cuesta?",
      answer: "Nada. Mirador es de código abierto bajo la licencia MIT, sin cuenta que crear. Usas el plan o la clave de API de tu agente, como ahora.",
    },
    agents: {
      question: "¿Con qué agentes de código funciona?",
      answer: "Hoy con Claude Code, opencode, pi y Codex (estos dos, experimentales), mediante el Agent Client Protocol (ACP). Vienen más agentes.",
    },
    privacy: {
      question: "¿Mi código sale de mi equipo?",
      answer:
        "Mirador se ejecuta en tu equipo. Tu agente habla con su proveedor de modelos como siempre, y Mirador en sí solo le pregunta a GitHub si hay una versión más nueva. No hay telemetría.",
    },
    terminal: {
      question: "¿Reemplaza a mi terminal?",
      answer: "No. Ejecuta el mismo agente con tu configuración, tus hooks y tus servidores MCP, y puede continuar una sesión que iniciaste en una terminal.",
    },
    phones: { question: "¿Y en el teléfono?", answer: "Las aplicaciones para Android e iOS están en camino." },
  },
  footer: { madeBy: "Mirador · Licencia MIT · Hecho por Péter Erdős", releases: "Versiones", trailer: "Tráiler", privacy: "Privacidad" },
  privacy: {
    title: "Política de privacidad",
    updated: "Última actualización: 1 de noviembre de 2026",
    englishPrevails: 'Esto es una traducción. Si difiere de la <a href="../privacy.html">política de privacidad en inglés</a>, se aplica la versión en inglés.',
    intro:
      "Esta política cubre Mirador, la aplicación que ejecutas en tu equipo, y Mirador para Android, la aplicación de teléfono que se conecta a ella. Ambas las hace Péter Erdős. En resumen: tus datos se quedan en tus propios dispositivos. Ninguna de las dos aplicaciones tiene cuentas, analíticas, publicidad ni informes de fallos. Lo único que pasa por servidores que nosotros gestionamos son los servicios opcionales de notificaciones y de igual a igual que se describen más abajo, y no pueden leer lo que envías.",
    computerTitle: "Mirador en tu equipo",
    computer:
      "Mirador guarda tus conversaciones, tu configuración y los dispositivos que invitaste en una base de datos en tu equipo. Los agentes de código que ejecutas con él hablan con sus propios proveedores de modelos, bajo las condiciones de esos proveedores, igual que sin Mirador. Mirador en sí solo se conecta a GitHub, para ver si hay una versión más nueva y para descargar los complementos que instala.",
    androidTitle: "Mirador para Android",
    android:
      "La aplicación de teléfono se conecta solo a los equipos con Mirador con los que la emparejas, directamente, a través de una red que eliges, como Tailscale, o de igual a igual, como se describe más abajo. Cada conexión está cifrada entre el teléfono y tu equipo. Lo que muestra viene de ellos, y lo que envías va a ellos:",
    messages: "<strong>Los mensajes y respuestas</strong> que escribes van al equipo en el que se ejecuta la conversación.",
    photos: "<strong>Las fotos y capturas de pantalla</strong> que adjuntas, desde la cámara, tu galería o la opción de compartir de otra aplicación, se suben a ese equipo.",
    camera: "<strong>La cámara</strong> escanea el código QR que empareja el teléfono con un equipo, y toma las fotos que decides adjuntar.",
    microphone:
      "<strong>El micrófono</strong> se usa solo mientras mantienes pulsado el botón de enviar para dictar. Si el teléfono tiene su propio reconocimiento de voz, lo que dices se queda en el teléfono. Si no, el servicio de dictado por voz de Android lo convierte en texto, y ese servicio puede procesarlo en sus servidores bajo su propia política de privacidad.",
    replies: "<strong>Las respuestas leídas en voz alta</strong> se generan en tu equipo y se reproducen en el teléfono.",
    phoneStorage:
      "El teléfono guarda los equipos con los que está emparejado, tu configuración y los borradores sin enviar en su propio almacenamiento, con los tokens de acceso de los equipos en el almacenamiento seguro de Android. El desbloqueo con huella o con el rostro, cuando activas el bloqueo de la aplicación, lo comprueba Android; la aplicación nunca lo ve.",
    notificationsTitle: "Notificaciones con la aplicación cerrada",
    notifications:
      "Esto está desactivado a menos que configures un relé push en Mirador en tu equipo. Cuando está activado, el teléfono le da a tu equipo su token de notificaciones de Firebase Cloud Messaging, el servicio push de Google, y tu equipo lo guarda. Para notificarte, tu equipo envía el token y la notificación, sellada con una clave que solo tienen tu teléfono y tu equipo, al relé push, que los pasa a Google para que los entregue. El relé, el nuestro o uno que ejecutes tú mismo, no guarda ni registra tokens ni notificaciones. El relé y Google ven el token y cuándo se envió una notificación, pero no pueden leer lo que dice. Google trata el token bajo su propia política de privacidad.",
    peerToPeerTitle: "De igual a igual",
    peerToPeer:
      "Esto está desactivado a menos que Mirador en tu equipo esté configurado para usarlo. En ese caso, el teléfono y el equipo se encuentran a través de un intermediario, que ve sus claves públicas y direcciones de red mientras están conectados. Cuando no pueden comunicarse directamente, su tráfico pasa por el intermediario, cifrado de forma que este no puede leerlo.",
    deletingTitle: "Eliminar tus datos",
    deleting:
      "Desinstalar la aplicación elimina todo lo que guardó. Para que un teléfono deje de llegar a un equipo, quítalo en <strong>Configuración → Dispositivos</strong> de Mirador; eso también elimina el token de notificaciones del teléfono de ese equipo.",
    sharingTitle: "Compartir y vender",
    sharing:
      "No vendemos tus datos ni los compartimos con nadie, y no los usamos para nada más que entregar notificaciones y conexiones. Google Play puede recopilar datos sobre instalaciones y fallos de la aplicación bajo la propia política de privacidad de Google.",
    childrenTitle: "Niños",
    children: "Mirador es una herramienta para desarrolladores de software y no está pensada para niños.",
    changesTitle: "Cambios y preguntas",
    changes:
      'Los cambios en esta política se publican en esta página con una nueva fecha. Si tienes preguntas, abre un issue en <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a>.',
  },
};
