import type { SiteWords } from "./en.ts";

export const es: SiteWords = {
  attributes: {
    title: "Mirador: un canvas para tu agente de programación",
    description:
      "Mirador pone un canvas junto al chat con tu agente de programación: ahí dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y sus code reviews. Gratis y open source, para macOS, Linux y Windows.",
    ogDescription: "Tu agente de programación dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y sus code reviews, justo al lado del chat.",
    sections: "Secciones",
    language: "Idioma",
    copy: "Copiar",
    copied: "Copiado",
    trailer: "Tráiler",
    trailerAlt: "El tráiler: basta de muros de texto, ahora tu agente dibuja",
    trailerPlayer: "Tráiler de Mirador",
    canvasAlt: "Un chat sobre un flujo de checkout, con el diagrama de secuencia del agente en el canvas de al lado",
    askAlt: "El agente pregunta qué layout de ajustes construir, con un mockup de cada opción",
    tourAlt: "El tour del agente por su fix: los pasos a la izquierda y la línea cambiada de src/checkout.ts marcada a la derecha",
    reviewAlt: "Un code review abierto en su tour del flujo: los pasos junto a la explicación del paso actual, y debajo el diff con las líneas del paso marcadas",
    changesAlt: "La vista Cambios: los archivos sin commit de un proyecto, con la edición del agente abierta bajo su fila",
    terminalsAlt: "Dos terminales lado a lado debajo del chat",
    privacyTitle: "Política de privacidad · Mirador",
    privacyDescription: "Qué hacen Mirador y Mirador para Android con tus datos: se quedan en tus propios dispositivos.",
  },
  nav: { features: "Funciones", install: "Instalar", faq: "Preguntas" },
  hero: {
    eyebrow: "Gratis y open source · macOS, Linux y Windows",
    title: 'Mira<br><span class="gradient">lo que piensa tu agente.</span>',
    lede: "Mirador pone un canvas junto al chat con tu agente de programación. Ahí dibuja lo que quiere decir, te pregunta con imágenes y te guía por sus cambios y sus code reviews, para que los entiendas de un vistazo.",
    or: "o",
    windows: "Windows",
    download: "Descargar",
    star: "Dale una estrella en GitHub",
  },
  trailerCaption: "Ver el tráiler (2:33)",
  why: {
    title: "Escribir código ya no es lo lento. Leerlo, sí.",
    body: "En unos minutos un agente se lee un repo, toca diez archivos y te cuenta qué hizo en un chorro de texto interminable, todo en la misma fuente y al ritmo al que teclea. Una imagen se entiende mucho más rápido que un texto: un diagrama de secuencia explica el camino de un request de un vistazo; en prosa, eso es una página entera. Mirador no es otro agente más: ejecuta los que ya usas, con tu propia configuración, y les da un sitio donde enseñarte las cosas.",
  },
  show: {
    kicker: "Dibuja",
    title: "Tu agente dibuja lo que quiere decir.",
    body: "Diagramas, mockups, gráficas, comparativas, hasta escenas 3D, en un canvas junto al chat en vez de una página de prosa. Mermaid, D3 y three.js vienen incluidos y funcionan offline. Si una página tiene un error de script, el agente se entera y lo arregla.",
  },
  ask: {
    kicker: "Pregunta",
    title: "Decisiones con imágenes.",
    body: "En vez de una lista numerada en texto, el agente pregunta en el canvas: hasta ocho opciones, cada una con su preview. Haz clic en una, o escribe tu propia respuesta y añade una nota. Si tiene varias preguntas, llegan juntas, una por página, y las repasas antes de enviar.",
  },
  tour: {
    kicker: "Te guía",
    title: "Un tour por el código, en el orden en que se ejecuta.",
    body: "Cómo funciona algo, o qué acaba de cambiar el agente: un resumen corto y luego el código paso a paso, cada paso con sus líneas y los cambios marcados. Pregunta por cualquier línea, o ábrela en IntelliJ IDEA.",
  },
  review: {
    kicker: "Revisa",
    title: "Un code review que puedes recorrer.",
    body: "El veredicto y el resumen, un tour guiado por el cambio, cada diff y las observaciones ancladas a sus líneas, cada una marcada como confirmada o solo sospecha. Quédate con las que compartas, reescríbelas y publícalas en el pull request de GitHub como tu review pendiente.",
  },
  more: {
    title: "Y el resto de tu día con un agente",
    changes: {
      title: "Cada cambio, incluso fuera del proyecto",
      body: "Lo que cambió este turno o esta conversación, o todo lo que está sin commit, con el diff de cada archivo a un clic.",
    },
    terminals: { title: "Una shell junto a cada conversación", body: "Pestañas y splits que siguen corriendo mientras cambias de conversación, y vuelven después de un reinicio." },
    approve: { title: "Aprueba cada edición con su diff", body: "Antes de permitir una edición, la ves en el canvas con los números de línea del propio archivo." },
    needsYou: { title: "Mira quién te necesita", body: "Todos tus proyectos en una barra lateral, que marca las conversaciones que te esperan, terminaron o fallaron." },
    resume: { title: "Retoma lo que empezaste en la terminal", body: "Continúa una sesión que iniciaste en una terminal, con todo su historial." },
    point: { title: "Señala y pregunta", body: "Señala cualquier parte de una página que dibujó el agente y pregunta por ella, o pide que la cambie." },
    agents: {
      title: "Tus agentes, juntos",
      body: "Los agentes de verdad, con tus hooks y tus servidores MCP. Uno puede pasarle a otro, por ejemplo a un modelo local, una tarea larga y fácil, y revisar lo que devuelve.",
    },
    jobs: {
      title: "Espera los trabajos largos",
      body: "El agente deja corriendo un build o los tests, incluso en un servidor de builds por ssh o en un contenedor, y Mirador lo despierta cuando terminan.",
    },
    plugins: {
      title: "Plugins",
      body: "Los plugins oficiales añaden herramientas al canvas, como Media: marca qué está mal en un frame de un video, y el agente lo corta y lo renderiza.",
    },
    talk: { title: "Háblale", body: "Dicta tu mensaje, escucha lo esencial de la respuesta y sigue hablando, sin tocar el teclado." },
  },
  install: {
    title: "Instalar",
    unix: "En un Mac con Apple Silicon, o en Linux (x64 o arm64), esto descarga la app, la instala y la arranca:",
    windows: "En Windows (x64, experimental), en PowerShell:",
    brew: "O con Homebrew, en macOS y Linux:",
    notes:
      'La app de macOS está firmada y notarizada por Apple. La de Windows aún no está firmada, así que SmartScreen avisa si ejecutas el instalador a mano. Linux necesita algunas librerías del sistema; el <a href="https://github.com/sodre90/mirador#get-it">README</a> las lista, y explica cómo instalar a mano y cómo correr desde el código fuente. También puedes bajar los archivos de la <a href="https://github.com/sodre90/mirador/releases/latest">última release</a>. A partir de ahí, la app se actualiza sola.',
  },
  faq: {
    title: "Preguntas",
    cost: {
      question: "¿Cuánto cuesta?",
      answer: "Nada. Mirador es open source con licencia MIT y no hay que crear ninguna cuenta. Usas el plan o la API key de tu agente, como hasta ahora.",
    },
    agents: {
      question: "¿Con qué agentes funciona?",
      answer: "Hoy con Claude Code, opencode, pi, Codex, Copilot y Antigravity (estos cuatro últimos, experimentales), a través del Agent Client Protocol (ACP). Vienen más.",
    },
    privacy: {
      question: "¿Mi código sale de mi máquina?",
      answer:
        "Mirador corre en tu máquina. Tu agente habla con su proveedor de modelos como siempre, y Mirador en sí solo consulta a GitHub si hay una release más nueva. No hay telemetría.",
    },
    terminal: {
      question: "¿Reemplaza a mi terminal?",
      answer: "No. Ejecuta el mismo agente con tu configuración, tus hooks y tus servidores MCP, y puede continuar una sesión que empezaste en una terminal.",
    },
    phones: { question: "¿Y en el teléfono?", answer: "Las apps para Android e iOS están en camino." },
  },
  footer: { madeBy: "Mirador · Licencia MIT · Hecho por Péter Erdős", releases: "Releases", trailer: "Tráiler", privacy: "Privacidad" },
  privacy: {
    title: "Política de privacidad",
    updated: "Última actualización: 1 de noviembre de 2026",
    englishPrevails: 'Esto es una traducción. Si difiere de la <a href="../privacy.html">política de privacidad en inglés</a>, prevalece la versión en inglés.',
    intro:
      "Esta política cubre Mirador, la aplicación que ejecutas en tu equipo, y Mirador para Android, la aplicación de teléfono que se conecta a ella. Ambas las hace Péter Erdős. En resumen: tus datos se quedan en tus propios dispositivos. Ninguna de las dos aplicaciones tiene cuentas, analíticas, publicidad ni informes de fallos. Lo único que pasa por servidores que nosotros operamos son los servicios opcionales de notificaciones y de conexión peer-to-peer que se describen más abajo, y no pueden leer lo que envías.",
    computerTitle: "Mirador en tu equipo",
    computer:
      "Mirador guarda tus conversaciones, tu configuración y los dispositivos que invitaste en una base de datos en tu equipo. Los agentes de programación que ejecutas con él hablan con sus propios proveedores de modelos, bajo las condiciones de esos proveedores, igual que sin Mirador. Mirador en sí solo se conecta a GitHub, para ver si hay una versión más nueva y para descargar los plugins que instala.",
    androidTitle: "Mirador para Android",
    android:
      "La aplicación de teléfono se conecta solo a los equipos con Mirador con los que la emparejas, directamente, a través de una red que eliges, como Tailscale, o peer-to-peer, como se describe más abajo. Cada conexión está cifrada entre el teléfono y tu equipo. Lo que muestra viene de ellos, y lo que envías va a ellos:",
    messages: "<strong>Los mensajes y respuestas</strong> que escribes van al equipo en el que se ejecuta la conversación.",
    photos: "<strong>Las fotos y capturas de pantalla</strong> que adjuntas, desde la cámara, tu galería o la opción de compartir de otra aplicación, se suben a ese equipo.",
    camera: "<strong>La cámara</strong> escanea el código QR que empareja el teléfono con un equipo, y toma las fotos que decides adjuntar.",
    microphone:
      "<strong>El micrófono</strong> se usa solo mientras mantienes pulsado el botón de enviar para dictar. Si el teléfono tiene su propio reconocimiento de voz, lo que dices se queda en el teléfono. Si no, el servicio de escritura por voz de Android lo convierte en texto, y ese servicio puede procesarlo en sus servidores bajo su propia política de privacidad.",
    replies: "<strong>Las respuestas leídas en voz alta</strong> se generan en tu equipo y se reproducen en el teléfono.",
    phoneStorage:
      "El teléfono guarda los equipos con los que está emparejado, tu configuración y los borradores sin enviar en su propio almacenamiento, con los tokens de acceso de los equipos en el almacenamiento seguro de Android. El desbloqueo con huella o con el rostro, cuando activas el bloqueo de la aplicación, lo comprueba Android; la aplicación nunca lo ve.",
    notificationsTitle: "Notificaciones con la aplicación cerrada",
    notifications:
      "Esto está desactivado a menos que configures un relé push en Mirador en tu equipo. Cuando está activado, el teléfono le da a tu equipo su token de notificaciones de Firebase Cloud Messaging, el servicio push de Google, y tu equipo lo guarda. Para notificarte, tu equipo envía el token y la notificación, sellada con una clave que solo tienen tu teléfono y tu equipo, al relé push, que los pasa a Google para que los entregue. El relé, el nuestro o uno que ejecutes tú mismo, no guarda ni registra tokens ni notificaciones. El relé y Google ven el token y cuándo se envió una notificación, pero no pueden leer lo que dice. Google trata el token bajo su propia política de privacidad.",
    peerToPeerTitle: "Peer-to-peer",
    peerToPeer:
      "Esto está desactivado a menos que Mirador en tu equipo esté configurado para usarlo. En ese caso, el teléfono y el equipo se encuentran a través de un intermediario, que ve sus claves públicas y sus direcciones de red mientras están conectados. Cuando no pueden comunicarse directamente, su tráfico pasa por el intermediario, cifrado de forma que este no puede leerlo.",
    deletingTitle: "Eliminar tus datos",
    deleting:
      "Desinstalar la aplicación elimina todo lo que guardó. Para que un teléfono deje de tener acceso a un equipo, quítalo en <strong>Configuración → Dispositivos</strong> de Mirador; eso también elimina el token de notificaciones del teléfono de ese equipo.",
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
