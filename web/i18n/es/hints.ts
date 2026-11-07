import type { Messages } from "../en/index.ts";

export const hints: Messages["hints"] = {
  voiceRecognition:
    "Lo que convierte tu voz en texto. Un servidor propio es cualquiera que hable la API de voz a texto de OpenAI (POST /audio/transcriptions): el propio OpenAI, o un servidor Whisper en esta máquina o en otra. Mirador le envía WAV de 16 kHz.",
  voiceModel:
    "El modelo de lenguaje que traduce al inglés lo que dices antes de que entre en el cuadro de mensaje, y resume las respuestas que se leen en voz alta. Un servidor propio habla la API de chat de OpenAI (POST /chat/completions); la API de un perfil es la que nombra su entorno: ANTHROPIC_BASE_URL con ANTHROPIC_API_KEY o ANTHROPIC_AUTH_TOKEN, u OPENAI_BASE_URL con OPENAI_API_KEY. Mirador la llama directamente, sin iniciar el agente del perfil.",
  voiceModelThinkingOff:
    "Para un servidor local que ejecuta un modelo que piensa antes de responder, como Gemma 4 o Qwen 3: pensar hace que una traducción tarde mucho más y puede agotar la respuesta. Mirador envía chat_template_kwargs con enable_thinking en false, que servidores como mlx_lm, vLLM y llama.cpp entienden. Déjalo desactivado para la API de OpenAI.",
  voiceEngineVoiceModel:
    "El modelo de voz traduce al inglés lo que dices y, más adelante, resume las respuestas que se leen en voz alta. Los más grandes traducen mejor y necesitan más memoria: Mirador ofrece los que, una vez cargados, ocupan como máximo la mitad de la memoria de este Mac. Sin uno, lo que dices entra en el cuadro de mensaje en el idioma en que lo dijiste, salvo que abajo se haya definido otro modelo de voz.",
  thisMacModel:
    "Los modelos de Mirador para este servicio. Mejor, bueno y aceptable indican cómo le fue a cada uno en la comparación de Mirador en un Mac; el que aún no está en este Mac se descarga con el botón que tiene al lado. Mirador ofrece los que, una vez cargados, ocupan como máximo la mitad de la memoria de este Mac.",
  voiceEngineIdle:
    "Un modelo cargado ocupa memoria, un modelo de voz hasta 15 GB, así que cada uno se libera de la memoria si no se usa durante este tiempo. Volver a cargarlo hace que el siguiente dictado tenga que esperar.",
  voiceEngineLoaded: (minutes) =>
    `Cargado, así que responde al instante. Se libera de la memoria tras ${minutes} ${minutes === 1 ? "minuto" : "minutos"} sin usarse; se ajusta en Modelos en este Mac.`,
  voiceEngineUnloaded: "Ahora no ocupa memoria. Se carga la próxima vez que haga falta, normalmente en 5 a 15 segundos.",
  voiceEngineDownloadWaits: "Hay otra descarga en curso. Esta podrá empezar cuando termine.",
  voiceEngineRemoveWaits: "Hay una descarga en curso. Quitar podrá empezar cuando termine.",
  spokenVoiceKept: "Kokoro viene con la voz de este Mac para las respuestas en inglés, y solo se va con Quitar todo.",
  removeVoiceEngineArmed: "Haz clic de nuevo para eliminar de este Mac el motor de voz y sus modelos. Al configurarlo otra vez, se descargan de nuevo.",
  removeVoiceEngineModelArmed: "Haz clic de nuevo para eliminar este modelo de este Mac. Si lo eliges otra vez, se descarga de nuevo.",
  voiceModelProfile: "Mirador llama a la API de este perfil con sus claves. Su agente no se inicia.",
  voiceAddress: "La dirección de la API hasta su versión incluida, como en https://api.openai.com/v1. Mirador agrega la ruta de cada llamada.",
  voiceLanguage:
    "El idioma en que hablas. Indicarlo ayuda en grabaciones cortas, donde distinguir idiomas solo por el sonido suele fallar; el motor de este Mac sigue oyendo el inglés como inglés. Con cualquier idioma, decide el servidor de voz, y el modelo de voz traduce todo lo que no esté en inglés.",
  translateToEnglish: "Lo que dices entra en el cuadro de mensaje en inglés, con lo que dijiste debajo, para que lo compruebes antes de enviar.",
  translateNeedsVoiceModel: "Traducir necesita un modelo de voz. Elige uno abajo.",
  replyVoice:
    "Lo que lee las respuestas en voz alta, una vez que el modelo de voz resume cada una en unas pocas frases. El motor de este Mac habla en inglés con Kokoro, y en húngaro con OmniVoice, una descarga aparte cuya licencia solo permite uso no comercial. Un servidor propio habla la API de texto a voz de OpenAI (POST /audio/speech) con una de sus voces. Tras un mensaje que dictaste, su respuesta se lee al terminar el turno, en el navegador en el que dictaste.",
  replyLanguage: "El idioma en que se leen las respuestas. El modelo de voz las resume en él, sea cual sea el idioma en que escribió el agente.",
  replyVoiceName: "Una de las voces del servidor, como alloy es una de las de OpenAI.",
  readAloud: "Lee en voz alta un breve resumen de esta respuesta.",
  stopReadingAloud: "Deja de leer en voz alta esta respuesta.",
  copyReply: "Copia la respuesta de este turno como texto con formato, sin las herramientas que usó.",
  copyReplyAsMarkdown: "Copia la respuesta de este turno como Markdown, sin las herramientas que usó.",
  keepTalking:
    "Cuando la respuesta a lo que dictaste se ha leído en voz alta, el micrófono se abre de nuevo y lo que digas a continuación se envía de inmediato. Decir “stop” o “thanks”, o pulsar Esc, lo termina. Una pregunta que el agente haga mientras tanto se lee en voz alta para que respondas con la voz; di “help” para oír lo que puedes decir.",
  sendRightAway: "Envía lo que dijiste en cuanto es texto, en lugar de dejarlo en el cuadro de mensaje para que lo compruebes antes.",
  dictate:
    "Habla en lugar de escribir. Toca para empezar y se detiene cuando haces una pausa o tocas de nuevo; o mantenlo pulsado mientras hablas. Lo que dijiste entra donde está el cursor.",
  dictateOff: "Para dictar hace falta el reconocimiento de voz. Puedes activarlo en Configuración → Voz.",
  yolo:
    "Aprueba todo sin preguntar.\n\nCuando el agente pide permiso para ejecutar una herramienta, el host responde de inmediato con la opción “allow” del propio agente en lugar de mostrarte una tarjeta. Al activarlo también se aprueba una solicitud que ya estaba esperando. Las solicitudes que no ofrecen una opción de permitir siguen preguntándote.\n\nEsto es independiente del Modo del agente: las herramientas que el Modo ya permite nunca preguntan. Se guarda por conversación.",
  conversationSettings:
    "Perfil, agente, modelo y el resto de la configuración de esta conversación.\n\nEl perfil solo les da sus valores iniciales: cambiarlos aquí no modifica el perfil.",
  yoloOn: "YOLO está activado: las llamadas a herramientas del agente se aprueban sin preguntar. Desactívalo en la configuración de esta conversación.",
  profile:
    "El perfil (variables de entorno y comando previo al inicio) con el que se ejecuta el agente.\n\nCada perfil ejecuta su propio proceso de agente. Cambiar cierra esta sesión en el proceso actual y la reanuda en el nuevo, así que el agente conserva toda la conversación. El modelo vuelve al predeterminado del nuevo perfil.\n\nSi cambias mientras el agente trabaja, se detiene su turno, se mueve la sesión y se le pide al agente que continúe donde se quedó; los mensajes que pusiste en cola salen después.\n\nLos perfiles de otro agente solo se pueden elegir antes del primer mensaje: ese agente inicia una sesión nueva. Una vez empezada la conversación, inicia una conversación nueva para usarlos.",
  questions:
    "Qué pasa cuando el agente te pregunta algo en el lienzo.\n\nEl agente espera: la llamada ask del agente queda abierta hasta que pulses Enviar, y tu respuesta vuelve como su resultado, en mitad del turno.\n\nMi respuesta se envía como el siguiente mensaje: la llamada ask termina de inmediato, el agente acaba su turno y tu respuesta se envía después como tu siguiente mensaje. Útil para preguntas en las que quieres pensar.",
  conversationPluginSetting:
    "Solo para esta conversación. El del perfil sigue lo que su perfil define en Perfiles; al cambiar de perfil, vuelve a él.",
  configOption:
    "El agente ofrece este ajuste para la sesión. Cambiarlo envía el nuevo valor al agente (ACP session/set_config_option), que lo aplica a esta conversación.",
  dismissNewerVersion: "Lo oculta hasta que haya algo aún más nuevo. Configuración › Acerca de lo sigue mostrando.",
  restartHost:
    "Reinicia el host ahí mismo, para que ejecute su código tal como está ahora. Los agentes que trabajan se detienen y luego continúan donde se quedaron; los mensajes en cola se conservan. Las terminales vuelven como shells nuevos bajo la salida que tenían. Las páginas abiertas se recargan solas.",
  stop:
    "Pide al agente que detenga su turno, como hace Esc. Si no se ha detenido pasados unos segundos, este botón pasa a ser Forzar detención, que termina el proceso del agente; las demás conversaciones del mismo perfil continúan donde se quedaron.",
  promptTemplates: "Mensajes que envías a menudo, con los valores que rellenas cada vez. En Configuración se agregan, cambian y eliminan.",
  deleteTemplateArmed: "Haz clic de nuevo para eliminar esta plantilla. Las predeterminadas eliminadas aquí no vuelven.",
  findAddress:
    "Pregunta en qué dirección llegan otros dispositivos a Mirador: el nombre de esta máquina en su tailnet y las direcciones que los dispositivos ya han usado. Cada una se comprueba antes de ofrecerla: tiene que responder como este Mirador, en su propio puerto y en el puerto de las bibliotecas del lienzo. El host usa la dirección que elijas desde su próximo inicio.",
  exposeOnTailscale:
    "Ejecuta tailscale serve para los dos puertos de Mirador, reflejados, de modo que la tailnet llegue a Mirador por HTTPS en https://<esta máquina en la tailnet>:<su puerto> y a las bibliotecas del lienzo en el mismo nombre con el puerto del lienzo. No se cambia nada más en la tailnet; el host usa las direcciones desde su próximo inicio.",
  address:
    "Dónde abren Mirador otros dispositivos: http://127.0.0.1:4600 solo en esta máquina, o una dirección a la que un proxy lo reenvía, como https://macbook.example.ts.net:4600. El puerto es el propio de Mirador, 4600 salvo que el host se haya iniciado con otro.",
  canvasAddress:
    "De dónde carga una página del lienzo D3, Mermaid y three. Mirador las sirve en un puerto propio (4601), un origen distinto del de la aplicación, para que una página escrita por un agente no pueda llegar al almacenamiento de este Mirador. Un proxy también tiene que reenviar ese puerto: https://macbook.example.ts.net:4601.",
  reachRoute:
    "Mirador llega a otros dispositivos de una sola manera a la vez. Elegir una opción solo la muestra; su botón Usar esta o Guardar dirección la aplica y retira la otra, así que aquí no queda definido nada que el host no use. El host lo lee desde su próximo inicio. Una dirección en la que se pueda llegar a él tiene que darla un proxy, como tailscale serve, o el host sirve HTTPS en la red él mismo con un certificado que genera.",
  proxyElsewhere:
    "Para un proxy como Nginx Proxy Manager en otra máquina de tu red, que no puede llegar a los puertos de esta máquina. Al guardar la dirección, Mirador también sirve HTTPS en la red, y el proxy reenvía a esos puertos.",
  networkReachability:
    "Mirador sirve HTTPS él mismo en este puerto, con una autoridad de certificación que genera, así que los dispositivos de la misma red no necesitan proxy ni dirección. Cada navegador avisa una vez del certificado (o confía en él para siempre cuando instala mirador-ca.pem).",
  useThisNetwork:
    "Permite que los dispositivos de la misma red lleguen a este Mirador por HTTPS, como la opción de abajo. El host lo usa desde su próximo inicio.",
  inviteDevice:
    "Genera un código de un solo uso con el que otro navegador o aplicación se une a este Mirador, durante 15 minutos. Un dispositivo unido puede hacer de todo aquí, incluso ejecutar comandos en las terminales.",
  inviteRoute:
    "De igual a igual llega a este Mac desde cualquier lugar, sin VPN, mediante la aplicación Mirador en un teléfono; un navegador solo puede unirse en la dirección. El código QR y el enlace cambian con la elección.",
  removeMachineArmed:
    "Haz clic de nuevo para quitar esta máquina de la lista. Sigue funcionando, y este equipo permanece entre sus dispositivos hasta que lo revoques allí.",
  thisComputer: "Los espacios de trabajo y conversaciones de este equipo",
  manageMachines: "Agregar o quitar máquinas",
  machineColor: "Dale un color a esta máquina para distinguirla en la barra de máquinas. Se guarda en este equipo.",
  machineColorStyle:
    "Dónde muestra su color una máquina a la que se lo diste: solo en su botón de la barra, o también como una franja en la parte superior de su vista, para ver de un vistazo en qué máquina trabajas. Dale un color a una máquina en Máquinas….",
  machines: "Otros equipos que ejecutan Mirador, como un servidor cuyos agentes siguen trabajando mientras este equipo duerme.",
  plugins: "Los plugins dan al agente herramientas propias en el lienzo, o traen aplicaciones como un editor de video o de Google Docs. Instálalos, actualízalos y configúralos aquí.",
  revokeDeviceArmed: "Haz clic de nuevo para cerrar la sesión de este dispositivo. Necesita un código de invitación nuevo para unirse otra vez.",
  officialPlugin: "Uno de los plugins oficiales de Mirador, incluido en el catálogo sodre90/mirador-plugins.",
  installOfficialPlugin: "Clona el repositorio del plugin y muestra qué parte de él se ejecuta. Nada se ejecuta hasta que aceptes.",
  addPlugin: "Clona el repositorio y muestra qué parte de él se ejecuta: su comando de build y el código del host. Nada se ejecuta hasta que aceptes.",
  agreeToPlugin:
    "Ejecuta el comando de build y luego coloca el plugin en la carpeta de plugins de Mirador. Mirador lo carga, con su código del host, desde su próximo inicio.",
  checkForUpdates: "Busca ahora una versión más nueva de Mirador, en lugar de esperar a la próxima búsqueda automática, que llega cada 6 horas.",
  checkPluginUpdates:
    "Busca una versión más nueva del plugin o, si sigue una rama, los commits nuevos de la rama. Nada cambia hasta que actualices.",
  pluginUpdatesWaiting:
    "Plugins de repositorios git con una versión más reciente o commits nuevos. Mirador revisa al iniciarse y cada 6 horas. Solo instala algo por sí solo si Actualizaciones de plugins lo indica; si no, actualízalos en Configuración › Plugins.",
  pluginUpdateMode:
    "Preguntarme: cada actualización espera tu aprobación. Con las actualizaciones de Mirador: los plugins que se actualizan solos reciben sus versiones nuevas cuando se actualiza Mirador. En cada reinicio: las reciben cada vez que Mirador se inicia. Mirador descarga las actualizaciones y hace su build por adelantado. Si una actualización cambia el comando de build o los módulos del host, o no viene del repositorio oficial, sigue esperando tu aprobación.",
  pluginUpdatesByItself:
    "Instala las versiones nuevas de este plugin sin preguntar, en el momento que indique Actualizaciones de plugins. Activado de forma predeterminada en los plugins oficiales.",
  undoPluginUpdate:
    "Restaura la versión que esta actualización reemplazó a partir del próximo reinicio. Después, esta versión ya no se instala sola, pero puedes seguir actualizando a ella manualmente.",
  updateAllPlugins: "Clona la versión más nueva o los commits nuevos de cada plugin y muestra qué parte de cada uno se ejecuta, y luego pregunta una sola vez por todos.",
  updatePlugin:
    "Clona la versión más reciente, o la rama tal como está ahora, y muestra qué parte se ejecuta. Cuando aceptas, hace el build y solo entonces reemplaza el plugin, así que una actualización fallida lo deja como estaba.",
  removePluginArmed: "Haz clic de nuevo para quitar este plugin. Mirador deja de cargarlo desde su próximo inicio.",
  unlinkPluginArmed: "Haz clic de nuevo para quitar el enlace. La carpeta a la que apunta se queda como está.",
  copyOnSelect:
    "El texto que seleccionas en una terminal, arrastrando o con doble o triple clic, va al portapapeles de inmediato, como en iTerm2 y en las terminales de Linux.",
  terminalLink: (click) => `${click} para abrir el enlace en tu navegador.`,
  terminalPreset: "Colores integrados para las terminales: fondo, primer plano y paleta ANSI.",
  terminalFontSize: "Tamaño de fuente en las divisiones y pestañas de terminal (de 11 a 24 px). ⌘+ y ⌘− lo cambian paso a paso cuando una terminal tiene el foco.",
  terminalFontFamily:
    "Cualquier fuente instalada en esta máquina, por su nombre, p. ej. JetBrains Mono. Las terminales y la línea de estado cambian a ella de inmediato, con las fuentes habituales como respaldo. Vacío, o con una fuente que esta máquina no tiene, se muestra la fuente habitual.",
  terminalLineHeight: "Altura de una línea de terminal, como múltiplo del tamaño de fuente.",
  terminalLetterSpacing: "Espacio adicional entre los caracteres de la terminal, en píxeles.",
  terminalCursorStyle: "La forma del cursor de la terminal.",
  terminalCursorBlink: "Si el cursor de la terminal parpadea.",
  terminalFontWeightBold: "Qué tan gruesa es la negrita en las terminales.",
  terminalScrollback: "Cuántas líneas conserva una terminal después de salir por la parte superior.",
  connectedDevicesInSidebar:
    "Mientras hay dispositivos conectados, una línea al final de la barra lateral indica cuántos; haz clic para ver cuáles. Se recuerda en este navegador.",
  connectedDevices: (names) => `Conectados ahora: ${names.join(", ")}. Haz clic para ver todos los dispositivos en Configuración → Dispositivos.`,
  pageLibrariesSetting:
    "De dónde carga D3, Mermaid y three.js una página que copias o guardas desde el lienzo. El lienzo las sirve él mismo, pero una página fuera de Mirador no puede llegar a ellas. three.js siempre viene de la CDN.",
  editsInCanvasSetting:
    "Activado, una edición que el agente espera que permitas ocupa el lienzo, con un selector Unificada / Dividida y los números de línea del archivo, y el chat conserva una tarjeta pequeña. Desactivado, la tarjeta del chat muestra el diff y el lienzo se queda como está.",
  askPageBefore:
    "El agente mostró esta página justo antes de preguntar, en el mismo turno. Se queda sobre la pregunta para que puedas leer ambas; también está en el Historial por sí sola.",
  canvasToggle: "Oculta o muestra el panel del lienzo. Los dibujos y las preguntas siguen llegando mientras está oculto y se quedan en el Historial.",
  runCommand:
    "Ejecuta el comando que sigue a ! en la carpeta de este espacio de trabajo, con tu shell de inicio de sesión, sin entrada. Su salida se muestra aquí y va al agente con tu siguiente mensaje, como con ! en Claude Code. Para programas interactivos, usa la terminal.",
  undoFiles:
    "Devuelve los archivos de este espacio de trabajo a como estaban antes de que empezara este turno: lo que el turno cambió se restaura, lo que creó se elimina. Mirador los guardó porque este espacio de trabajo es un repositorio git; tus propios commits, ramas e historial no se tocan.\n\nLa conversación se queda como está. Al agente se le avisa con tu siguiente mensaje de que los archivos ya no reflejan ese turno.",
  undoFilesConfirm:
    "Escribe los archivos del espacio de trabajo de vuelta a como estaban cuando empezó el turno. Lo que el turno y todo lo posterior hicieron a los archivos se pierde; la conversación conserva su registro. Los archivos que cambiaron commits desde entonces, como los de un pull, se quedan como en el commit. Usa la terminal si quieres los archivos como están ahora.",
  rewind:
    "Devuelve la conversación y los archivos de este espacio de trabajo a como estaban antes de que empezara este turno: el turno y todos los posteriores salen de la conversación, y el agente sigue en una sesión que solo contiene lo anterior a ellos.\n\nLos turnos que salen no se vuelven a ofrecer, ni en la línea de tiempo ni en ningún otro sitio. El archivo de sesión del propio agente se queda en el disco, donde su propia función de reanudar (--resume de Claude Code, /resume de pi) todavía puede alcanzarlo. Tus commits, ramas e historial no se tocan.",
  rewindConfirm:
    "La conversación pierde este turno y todos los posteriores, y con ellos el historial propio del agente; los archivos vuelven a como estaban cuando empezó, salvo que los conserves como están. Los archivos que cambiaron commits desde entonces, como los de un pull, se quedan como en el commit. Ninguna de las dos cosas se recupera desde aquí.",
  revertFiles:
    "Enumera los archivos detrás de las cifras de arriba: los creados desde entonces, que se eliminan; los que vuelven a como estaban cuando empezó este turno; y los que cambiaron commits desde entonces, que se quedan como están.",
  rewindPutFilesBack:
    "Activado: los archivos vuelven a como estaban cuando empezó este turno, salvo los que cambiaron commits desde entonces. Desactivado: solo vuelve la conversación, y cada archivo se queda como está ahora, con lo que le hicieron los turnos que salen. Al agente no se le avisa; encuentra los archivos como están.",
  commandDelivery: "Los comandos que ejecutas con ! van al agente con tu siguiente mensaje, en las etiquetas que Claude Code usa para sus propios comandos !.",
  commandOutputsAttached: "Estas salidas de comandos que ejecutaste con ! van delante de tu siguiente mensaje al agente. ✕ las deja fuera.",
  terminalToggle:
    "Oculta o muestra las terminales de esta conversación, que se ejecutan en la carpeta de su espacio de trabajo. Sus shells siguen funcionando mientras el panel está oculto o se muestra otra conversación, y al recargar la página se vuelve a conectar a ellos.",
  terminalHide: "Oculta las terminales. Sus shells siguen funcionando; vuelve a mostrarlas desde el encabezado de la conversación o la paleta.",
  terminalNewTab:
    "Abre un shell en una pestaña nueva de las terminales de esta conversación, en la carpeta de su espacio de trabajo. Todas las ventanas muestran las mismas pestañas para esta conversación.",
  terminalSplit: "Abre otro shell junto al que tiene el foco, en la misma pestaña (hasta 4).",
  terminalSplitDown: "Abre otro shell debajo del que tiene el foco, en la misma pestaña (hasta 4).",
  terminalFindWholeWord: "Palabra completa: solo donde el texto aparece por sí solo, no dentro de una palabra más larga.",
  terminalFindRegex: "Usar expresión regular: el texto es una expresión regular de JavaScript, como error|warn.",
  terminalShowAll: "Vuelve a mostrar las otras terminales de esta pestaña; esta dejó de llenar la pestaña.",
  terminalCloseBusy: (command) =>
    `En esta terminal se ejecuta: ${command}. Haz clic de nuevo, o pulsa Enter o ⌘W, para terminarlo y cerrar la terminal; Esc lo conserva.`,
  terminalCloseTab:
    "Cierra esta pestaña y termina sus shells. Un clic con el botón central en la pestaña también la cierra, preguntando antes si se ejecuta un comando en ella.",
  terminalCloseTabBusy: (command) =>
    `En esta pestaña se ejecuta: ${command}. Haz clic de nuevo, haz clic de nuevo con el botón central en la pestaña, o pulsa Enter, para terminarlo y cerrar la pestaña; Esc lo conserva.`,
  terminalCloseTabArmed: "Haz clic de nuevo para terminar los shells de esta pestaña y lo que estén ejecutando.",
  terminalCloseSplit: "Termina este shell y cierra su división.",
  terminalCloseSplitArmed: "Haz clic de nuevo para terminar este shell y lo que esté ejecutando.",
  subagentsRunning:
    "Subagentes que el agente inició y que siguen trabajando, también enumerados sobre el cuadro de mensaje; haz clic para abrir el primero. Uno iniciado en segundo plano cuenta hasta que termina el turno que lo inició, ya que nada avisa de cuándo acabó antes.",
  searchAll: "Busca en todas las conversaciones de todos los espacios de trabajo. Abrir una coincidencia la muestra en su conversación.",
  find: "Busca texto en cualquier parte de esta conversación: en entradas anteriores que aún no se han cargado y en tarjetas contraídas, que se expanden donde se encuentra.",
  fork: "Copia esta conversación en una nueva con el mismo perfil y deja esta como está. Un turno en curso aquí sigue; la copia tiene lo que el agente ha guardado de él hasta ahora. Disponible cuando el agente ya ha trabajado en un mensaje aquí.",
  findOlder: "Coincidencia anterior, más arriba (Enter)",
  findNewer: "Coincidencia siguiente, más abajo (Shift+Enter)",
  findMatchCase: "Distinguir mayúsculas y minúsculas: las letras mayúsculas y minúsculas cuentan como distintas.",
  runningSubagent: "Un subagente trabajando. Haz clic para abrir su tarjeta en la conversación y ver lo que ha hecho hasta ahora.",
  approvalWaiting: "El agente, o uno de sus subagentes, espera tu aprobación más arriba en la conversación. Haz clic para ir allí.",
  subagentTokens: (read, written, fresh) =>
    `Tokens de entrada: ${read} leídos de la caché, ${written} escritos en ella, ${fresh} nuevos. Contados a partir de la transcripción del subagente de Claude Code.`,
  inTerminal:
    "Esta sesión de Claude Code también se ejecuta en una terminal. El host lo ve en el registro de sesiones de Claude Code (<config dir>/sessions/<pid>.json) y muestra lo que hace la terminal.",
  launch:
    "El perfil con el que empiezan las conversaciones nuevas de este espacio de trabajo, y con él su agente. Se recuerda por espacio de trabajo. Las conversaciones existentes conservan el perfil con el que se ejecutan hasta que las muevas.",
  setUpProfile:
    "Toda conversación se ejecuta con un perfil. Configura el primero en el panel principal; sin nada más definido, ejecuta el agente tal como está configurado en esta máquina.",
  continueSession:
    "Retoma una sesión de Claude Code, opencode, pi o Codex que se inició en una terminal en este directorio. Continúala en su sitio, o haz un fork de su historial en una conversación nueva y deja la original como está.",
  sessionSearch:
    "Busca sesiones de este directorio por lo que se dijo en ellas, por antiguas que sean. La búsqueda lee los registros propios del agente de cada sesión de aquí, así que encuentra sesiones que la lista no muestra.",
  profiles:
    "Configuraciones con nombre para un agente: variables de entorno y un comando previo al inicio, aplicados al proceso del agente que inicia el perfil. Toda conversación se ejecuta con uno.",
  shellOutputStyle:
    "Cómo se muestra en una conversación cada comando de shell que ejecuta el agente hasta que lo abres o lo cierras: su comando con la salida a un clic, la salida abierta solo si el comando falló, una línea con el comando también a un clic, o todo abierto. Los comandos que ejecutas con ! siempre muestran su salida.",
  shellLook:
    "Los colores de los bloques de shell en una conversación: los comandos del agente, los tuyos y los comandos que esperan tu aprobación. Seguir el tema coincide con el resto de la aplicación; Personalizado usa los colores de fondo, texto y prompt que elijas.",
  shellFont: "Cualquier fuente instalada en esta máquina, por su nombre, p. ej. JetBrains Mono. Vacío, o con una fuente que esta máquina no tiene, se muestra la fuente monoespaciada de la aplicación.",
  shellFontSize: "El tamaño del texto de los bloques de shell, respecto al tamaño del texto de la aplicación.",
  timestamps: "Desactivado: la hora se muestra junto al nombre de cada autor, y en una línea posterior mientras la señalas.\nActivado: cada línea muestra su hora.",
  pulses:
    "Los puntos de las conversaciones que trabajan, y de las que esperan un trabajo, pulsan. En Linux cambian varias veces por segundo, ya que cada cambio hace que la ventana se vuelva a dibujar.\nDesactivado: se quedan quietos. También se quedan quietos cuando tu sistema pide menos movimiento.",
  textSize: "Tamaño del texto en toda la aplicación: 50 %, 70 %, 100 %, 140 % o 200 %. ⌘+ y ⌘− lo cambian paso a paso, ⌘0 lo restablece.",
  theme: "Claro, oscuro, o igual que el ajuste del sistema.",
  waitingStyle:
    "Cómo marca la barra lateral una conversación cuyo agente te espera: por una aprobación o una respuesta (Esperándote), o porque su turno terminó mientras mirabas otra cosa (Listo, o Falló tras un error).\n\nEtiqueta y número: una etiqueta en la fila y un número en su espacio de trabajo. Solo punto: un punto de color y un título en negrita. Etiquetas y lista arriba: además enumera todas las conversaciones en espera sobre los espacios de trabajo.",
  waitingCount: "Conversaciones de este espacio de trabajo que te esperan.",
  workspaceColor: "Dale un color a este espacio de trabajo para distinguirlo en la barra lateral. Todas las ventanas lo muestran.",
  workspaceColorStyle:
    "Cómo muestra su color un espacio de trabajo al que se lo diste: en toda su tarjeta, solo en su encabezado, o como una franja en su borde sobre un tono más suave. Haz clic en las iniciales de un espacio de trabajo para darle un color.",
  newConversation: "Inicia una conversación en este espacio de trabajo, con el perfil elegido junto a este botón.",
  addWorkspace: "Agrega un directorio de proyecto. Sus conversaciones se ejecutan con él como directorio de trabajo.",
  hideSidebar: "Oculta la barra lateral para dar todo el ancho a la conversación, el lienzo y la terminal. Este navegador lo recuerda.",
  showSidebar: "Vuelve a mostrar la barra lateral con los espacios de trabajo y las conversaciones.",
  addWorkspaceGroup:
    "Agrega un grupo: un encabezado que se contrae, para reunir espacios de trabajo, p. ej. por proyecto o cliente. Arrastra un espacio de trabajo por su encabezado a un grupo, y ordena espacios de trabajo y grupos como quieras.",
  foldWorkspace: "Contrae este espacio de trabajo hasta su encabezado. Abrir una de sus conversaciones lo expande.",
  unfoldWorkspace: "Vuelve a mostrar las conversaciones de este espacio de trabajo.",
  workspaceGroupCount: "Espacios de trabajo de este grupo.",
  waitingInGroup: "Conversaciones de los espacios de trabajo de este grupo que te esperan.",
  waitingAbove: "Conversaciones que te esperan, fuera de la vista arriba. Haz clic para mostrar la más cercana.",
  waitingBelow: "Conversaciones que te esperan, fuera de la vista abajo. Haz clic para mostrar la más cercana.",
  renameWorkspaceGroup: "Renombra este grupo.",
  deleteWorkspaceGroup: "Elimina este grupo. Sus espacios de trabajo se quedan donde está.",
  deleteWorkspaceGroupArmed: "Haz clic de nuevo para eliminar este grupo. Sus espacios de trabajo se quedan donde está.",
  removeWorkspace: "Quita este espacio de trabajo y sus conversaciones de la aplicación. El directorio y sus archivos no se tocan.",
  removeWorkspaceArmed: "Haz clic de nuevo para quitar este espacio de trabajo y sus conversaciones de la aplicación. El directorio y sus archivos no se tocan.",
  deleteConversation:
    "Elimina de la aplicación esta conversación, su línea de tiempo y su historial del lienzo. Los archivos de sesión del propio agente se quedan en el disco.",
  deleteConversationArmed: "Haz clic de nuevo para eliminar esta conversación. Los archivos de sesión del propio agente se quedan en el disco.",
  deleteProfileArmed: "Haz clic de nuevo para eliminar este perfil. Sus conversaciones pueden continuar con otro perfil.",
  splitter: "Arrastra para cambiar el tamaño, haz doble clic para restablecerlo.",
  composerGrip:
    "Arrastra hacia arriba para hacer más alto el cuadro de mensaje, hacia abajo para hacerlo más pequeño; aun así crece con textos más largos. Todas las conversaciones de este navegador usan la misma altura. Haz doble clic para que vuelva a ajustarse al texto.",
  paneGrip:
    "Arrastra sobre otro panel para intercambiar los dos, o usa Intercambiar en la paleta. Cada conversación recuerda su propio diseño; Configuración elige con cuál empiezan las conversaciones nuevas.",
  paneFullscreen: "Hace que este panel llene el espacio de trabajo. Hacer doble clic en la barra hace lo mismo.",
  paneExitFullscreen: "Vuelve a los otros paneles. Esc hace lo mismo, salvo en una terminal, que se queda con Esc para sí misma.",
  canvasHide: "Oculta el lienzo. Los dibujos y las preguntas siguen llegando y se quedan en el Historial; vuelve a mostrarlo desde el encabezado de la conversación o la paleta.",
  settings:
    "El tema, las marcas de tiempo, el diseño con el que empiezan las conversaciones nuevas, las notificaciones del sistema y, en macOS, si corrige tu ortografía o predice palabras mientras escribes.",
  queue:
    "Los mensajes que envías mientras trabaja el agente esperan aquí.\n\nCon Claude Code, pi y Codex, un mensaje con la etiqueta “se une al turno” espera aquí solo mientras el agente ejecuta herramientas: entra en el turno en curso en cuanto terminan, así que el agente lo lee antes de su siguiente paso. Uno con la etiqueta “después del turno” espera hasta que el turno termina y luego sale como tu siguiente mensaje. Enter y ⌥Enter (Alt+Enter) envían de una manera cada uno; Configuración elige cuál. opencode no puede aceptar mensajes en un turno en curso, así que con él todos esperan.\n\nLos mensajes que esperan salen de uno en uno, cada uno cuando termina el turno anterior, también después de pulsar Detener. Arrastra un mensaje por su ⋮⋮ para cambiar el orden en que salen. Editar devuelve un mensaje al cuadro de mensaje; ↑ en un cuadro vacío hace lo mismo con el último. El host guarda la cola, así que sobrevive a una recarga de la página y a un reinicio del host.",
  usageLimit:
    "Claude Code se detuvo en su límite de uso. En lugar de enviar tus mensajes en cola contra el mismo muro, el host los guarda y, como Claude Code, un minuto después de que el límite se restablezca le pide al agente que continúe donde se quedó; tus mensajes en cola salen a continuación. Lo hace por sí solo como máximo dos veces seguidas; después de eso, o cuando el mensaje no indica una hora de restablecimiento, te espera a ti.\n\nLa espera sobrevive a un reinicio del host.",
  continueAfterUsageLimit:
    "Pide al agente que continúe ahora donde se quedó, p. ej. tras cambiar a un perfil que inicia sesión en otra cuenta. Los mensajes en cola salen a continuación.",
  tryAgain: "Pide al agente que continúe donde se quedó. Todavía tiene el mensaje con el que empezó el turno fallido.",
  stopWaitingForUsageLimit: "Deja de esperar el restablecimiento: el agente no continúa por sí solo, y los mensajes que pusiste en cola salen ahora.",
  jobWait:
    "El agente dejó este trabajo en ejecución y ejecutó mirador when-done, así que no necesita consultarlo. Mirador lo comprueba de vez en cuando: un proceso cada segundo, un contenedor cada 5 segundos, un trabajo en otra máquina cada 20 segundos por ssh. Cuando termina, el mensaje va al agente como tu siguiente mensaje o, si el agente lo pidió así, solo a ti.\n\nLa espera sobrevive a un reinicio del host.",
  followJob:
    "Síguelo en una pestaña de terminal de esta conversación: lo que ejecuta, cuánto lleva ejecutándose y luego su salida a medida que llega, desde el archivo en el que escribe un proceso o desde los registros del contenedor. La pestaña indica cuándo termina el trabajo. Ctrl+C la cierra; el trabajo sigue en ejecución.",
  stopWaitingForJob: "Deja de esperar este trabajo: cuando termine, no se avisa a nadie. Sigue en ejecución.",
  asyncTask:
    "Claude Code mismo ejecuta esto en segundo plano, así que el agente no necesita esperarlo: un comando que inició con run_in_background, o un workflow. Claude Code avisa al agente cuando termina.\n\nLa tarea vive y muere con el proceso del agente.",
  asyncTaskOutput: "Muestra lo que la tarea ha escrito hasta ahora: el final del archivo en el que Claude Code guarda su salida, actualizado mientras esto sigue abierto. Haz clic de nuevo para ocultarlo.",
  stopAsyncTask: "Detiene esta tarea: Claude Code la termina y el agente se entera. El turno que la inició sigue en ejecución.",
  dismissAsyncTask: "Descarta esta tarea: la quita de encima del cuadro de mensaje.",
  clearFinishedAsyncTasks: "Quita todas las tareas terminadas de encima del cuadro de mensaje.",
  delegatedTask:
    "Una herramienta de un plugin, como delegate, inició esta conversación con otro perfil para trabajar en una tarea de esta. Cuando termina su primer turno, el último mensaje de su agente llega al agente de esta conversación como tu siguiente mensaje.\n\nLa respuesta sobrevive a un reinicio del host.",
  openDelegatedTask: "Abre la conversación que trabaja en esta tarea, para verla o responder a lo que pregunta.",
  stopDelegatedTask: "Detiene su turno. El agente de aquí se entera de que la tarea se detuvo, con lo que el otro agente haya dicho hasta ahora.",
  dismissDelegatedTask: "Descarta esta tarea: la quita de encima del cuadro de mensaje, y su conversación de la barra lateral. La búsqueda sigue encontrando la conversación.",
  delegatedFold: "Conversaciones a las que esta delegó tareas, por ejemplo con delegate. Haz clic para mostrarlas u ocultarlas debajo de ella.",
  claudeProgram: (installFolders) =>
    `El programa claude con el que Mirador ejecuta Claude Code, en el equipo del host. Vacío: el claude del PATH o, si no, el de estas carpetas: ${installFolders}.\n\nUn perfil puede ejecutar otro mediante CLAUDE_CODE_EXECUTABLE en su entorno.`,
  keepAwake:
    "Evita que el equipo en el que se ejecuta Mirador se suspenda mientras está inactivo.\n\nMientras trabajan los agentes: hasta que termina cada turno en curso, para que los trabajos largos acaben.\n\nSiempre: mientras Mirador se ejecuta, para que tu teléfono y otros dispositivos puedan llegar a él en cualquier momento.\n\nEn macOS y Linux.",
  canvasUse:
    "Si hace falta: el agente decide según las propias instrucciones del lienzo.\n\nA menudo: los prompts de sistema de Claude Code, pi, Codex y Antigravity, y las instrucciones del lienzo para Copilot, también les indican que pongan en el lienzo las explicaciones, comparaciones, planes y el resumen de un trabajo más grande, y que te pregunten allí las opciones.\n\nLas páginas cuestan más tokens que la misma respuesta como texto.",
  keepDeletedCanvas:
    "Cuando eliminas una conversación, su lienzo se conserva este tiempo. Si continúas su sesión desde Continuar una sesión…, el lienzo vuelve tal como estaba, también las revisiones y los recorridos. Después, solo vuelve lo que guarda el historial de la propia sesión: páginas, preguntas y checklists.",
  terminalCommand:
    "Claude Code muestra este comando solo en su propia terminal, así que esto lo abre allí: una pestaña de terminal de esta conversación, ejecutada por el Claude Code que usa el perfil de esta conversación. El panel es donde ocurre el comando; la respuesta del agente de arriba es solo su negativa.",
  logIn:
    "Abre el inicio de sesión propio del agente en una pestaña de terminal de esta conversación, con su perfil, de modo que un perfil con cuenta propia inicie sesión con esa. Cuando diga que has iniciado sesión, envía tu mensaje de nuevo.",
  queuedGrip: "Arrastra para cambiar el orden en que salen los mensajes en cola: salen desde arriba.",
  queuedDelivery: "Cómo sale este mensaje: al turno en curso cuando terminan las herramientas del agente, o después de que termine el turno. Haz clic para cambiar.",
  steerMessage:
    "Agrega el mensaje al turno en curso: Claude Code lo lee de inmediato, interrumpiendo lo que está escribiendo o, mientras ejecuta herramientas, en cuanto terminan. pi lo lee cuando termina de escribir o de ejecutar sus herramientas.",
  afterTurnMessage: "Guarda el mensaje hasta que termine el turno en curso (o pulses Detener) y luego lo envía como tu siguiente mensaje.",
  messageBox:
    "Se formatea al escribir convierte **negrita**, *cursiva*, ~~tachado~~, `código`, bloques de código con ```, citas con > y listas con - en formato mientras los escribes, como en Slack; ⌘B, ⌘I, ⌘⇧X y ⌘E dan formato a una selección. El agente recibe el mismo markdown en ambos casos.",
  formatBar: "Botones de formato sobre el cuadro de mensaje. Configuración › Conversaciones puede mantenerlos visibles.",
  formatBarSetting:
    "Si los botones de formato se muestran sobre el cuadro de mensaje con formato desde el principio, o solo después de hacer clic en Aa a su lado. Aa los muestra y los oculta en ambos casos.",
  formatBold: "Negrita, o escribe **texto**",
  formatItalic: "Cursiva, o escribe *texto*",
  formatStrike: "Tachado, o escribe ~~texto~~",
  formatCode: "Código, o escribe `texto`",
  formatLink: "Enlaza el texto seleccionado a una dirección, o escribe [texto](dirección)",
  formatLinkAddress: "Enter enlaza, una dirección vacía quita el enlace y Esc lo deja como estaba.",
  formatBullets: "Lista con viñetas, o empieza una línea con - y un espacio. Enter agrega un elemento; ⌘Enter (Ctrl+Enter) envía.",
  formatNumbers: "Lista numerada, o empieza una línea con 1. y un espacio. Enter agrega un elemento; ⌘Enter (Ctrl+Enter) envía.",
  formatQuote: "Cita, o empieza una línea con > y un espacio",
  formatCodeBlock: "Bloque de código, o escribe ``` al principio de una línea. Enter agrega una línea, ↓ al final sale del bloque, ⌘Enter (Ctrl+Enter) envía.",
  enterWhileBusy:
    "Qué hace Enter con un mensaje mientras el agente trabaja; ⌥Enter (Alt+Enter) hace lo otro. Con opencode, los mensajes siempre esperan a que termine el turno.",
  openFile:
    "Abre el archivo en el programa que el sistema del host usa para él, en la máquina en la que se ejecuta Mirador. Un script se abre como texto, en el programa que elige Configuración › Conversaciones. Un programa no se abre.",
  pushRelayAddress: "A dónde envía este Mac las notificaciones push para tus teléfonos; vacío, no envía ninguna. Los teléfonos reciben notificaciones push solo cuando se registran en este Mac.",
  pushRelayToken: "El token que el dueño del relé creó para este Mac. Mirador lo guarda y no lo vuelve a mostrar; déjalo vacío para conservar el que está definido.",
  machineName:
    "Cómo llaman los teléfonos a esta máquina: lo toman al conectarse, y un teléfono puede darle un nombre propio. También se une a otras máquinas como Mirador con este nombre. Vacío, usa el nombre de su equipo.",
  scriptProgram:
    "Dónde se abre, como texto, un enlace a un archivo de script en el equipo del host. El programa de su tipo podría ejecutarlo: Git for Windows ejecuta los archivos .sh, el lanzador de Python los .py.\n\nEl editor de texto del sistema: en macOS el que elegiste para texto, en Windows el Bloc de notas. Linux no tiene uno propio, así que allí xdg-open elige el programa según el tipo del script, y un script ejecutable, que ese programa podría ejecutar, no se abre.\n\nUn programa que indiques: su nombre en el PATH del host, como code o subl, o su ruta completa. Recibe la ruta del archivo. En Windows indica un .exe, como Code.exe: un .cmd o .bat se ejecutaría mediante cmd.exe, que podría tomar parte del nombre de un archivo por un comando.",
  editor:
    "El editor que usa Abrir en …, en el equipo del host. Mirador busca el lanzador de línea de comandos de cada uno (idea, code, cursor, zed, subl) en el PATH del host y donde lo deja su instalador. El primero que se encuentre sigue este orden.",
  editorCommand:
    "Un programa y sus argumentos, ejecutados sin shell. {file} se cambia por la ruta del archivo y {line} por su línea; sin {file}, la ruta va al final. Pon entre comillas la ruta de un programa que tenga espacios.",
  profilePicture:
    "Tu foto, que se muestra junto a tus mensajes. Se recorta en cuadrado y aquí se dibuja a 128 píxeles; el host la guarda: todos los navegadores y dispositivos que abren este Mirador la ven.",
  blockedImage:
    "Abre la imagen en tu navegador. Mirador no carga por sí mismo imágenes de otros sitios, para que un agente no pueda enviarles lo que leyó; Configuración → Conversaciones puede cambiarlo.",
  scriptMessage:
    "Un script que el agente inició envió esto como tu siguiente mensaje, para que el agente retome cuando el script termine. Los scripts envían con mirador message.",
  miradorMessage:
    "Mirador envió esto al agente cuando terminó su turno: para seguir con un paso que anunció pero no dio, o para usar el lienzo cuando Configuración lo pide a menudo, como preguntarte con ask en lugar de en el chat.",
  pluginMessage:
    "Un plugin envió esto como tu siguiente mensaje, como Delegate con la respuesta de una tarea que el agente delegó, para que el agente retome desde ahí.",
  gitBranch: "La rama de git activa en el directorio del espacio de trabajo.",
  model: "El modelo que usa el agente, tal como se eligió en el menú Modelo de arriba.",
  cost: "Lo que ha costado la conversación hasta ahora, según lo informa el agente.",
  credits: "Créditos de IA que ha usado esta conversación, según los cuenta GitHub Copilot.",
  profileChip: "El perfil con el que se ejecuta el agente de esta conversación.",
  quota: (limit, percent, resetsIn) =>
    `Límite de uso ${limit} de tu plan: ${percent} usado, se reinicia en ${resetsIn}.\n\nEl agente lo informa después de cada respuesta, para la cuenta del perfil de esta conversación.`,
  statuslineCommand: (command) =>
    `Tu línea de estado, impresa por: ${command}.\n\nEl host la ejecuta como lo hace Claude Code: el JSON de línea de estado de Claude Code por stdin (modelo, cwd, sesión, transcripción, ventana de contexto, costo) y el entorno del perfil de la conversación. Cambia aquí a la línea de estado integrada.`,
  statuslineBuiltIn: (command) =>
    `La línea de estado integrada.\n\nLa configuración de Claude Code define un comando de línea de estado (${command}); cambia a él aquí.`,
  canvasOlder: "Muestra el elemento anterior del lienzo.",
  canvasNewer: "Muestra el elemento siguiente del lienzo.",
  canvasHistory: "Todo lo que el agente dibujó o preguntó en esta conversación, lo más reciente primero.",
  canvasClear: "Vacía el lienzo. No se elimina nada: el elemento se queda en el Historial.",
  canvasOpenInWindow: "Muestra este elemento en una ventana propia que se mantiene al día, por ejemplo en una segunda pantalla. Abrirlo de nuevo trae esa ventana al frente.",
  canvasMore:
    "Los otros botones de la barra, para los que un panel estrecho no tiene espacio, y las aplicaciones que usan otras conversaciones de este espacio de trabajo, para mostrarlas también aquí.",
  canvasPageExport: "Copia esta página como imagen o como HTML, pide al agente que la escriba como Markdown, o guárdala como un archivo aparte.",
  canvasPoint:
    "Señala algo de la página para preguntarle al agente sobre ello o pedirle que lo cambie: un clic elige el elemento resaltado bajo el ratón, en lugar de hacer lo que hace la página, y arrastrar dibuja un recuadro alrededor de un área, que se envía como imagen. Esc lo detiene. Para preguntar sobre un texto, solo selecciónalo.",
  canvasPageFind: "Buscar texto en la página que mostró el agente: cada coincidencia queda marcada en ella, y la actual se trae a la vista.",
  pageMarkChange: "Dile al agente qué cambiar ahí: vuelve a mostrar la página con el cambio hecho.",
  canvasEditsWaiting: "Muestra la edición que el agente espera que permitas o rechaces.",
  canvasChanges: "Los archivos que cambió este turno, o todos los cambios sin commit, con sus cambios de línea.",
  canvasApp: "La aplicación abierta en este espacio de trabajo, que tú y el agente cambian juntos. Todas las conversaciones que la muestran trabajan sobre el mismo documento.",
  canvasWorkspaceTab: "La pestaña de un plugin para este espacio de trabajo, la misma en cada una de sus conversaciones.",
  canvasChecklist:
    "Los pasos del trabajo del agente, marcados a medida que los termina. Tú también puedes marcar cualquiera: el agente se entera de tus marcas con tu siguiente mensaje.",
  checklistClose: "Vuelve a lo que mostraba el lienzo. El botón Checklist lo abre de nuevo.",
  checklistDismiss: "Quita la checklist del lienzo para siempre. No vuelve hasta que el agente publique una nueva.",
  checklistPlan: "La propia lista de tareas del agente, tal como la actualizó por última vez. Solo el agente las marca.",
  changesScope: {
    turn: "Los archivos que difieren de como estaban cuando empezó este turno, tal como los dejó el agente o cualquier otra cosa.",
    uncommitted: "git status: los archivos que difieren del último commit, y los archivos fuera del proyecto que el agente editó en esta conversación.",
    session:
      "Todos los archivos que el agente cambió con sus herramientas de edición en esta conversación, incluso donde un turno posterior lo revirtió, y los archivos escritos mientras se ejecutaban sus comandos, incluidos la salida del build y sus commits. Un archivo que eliminó un comando, o que escribió más tarde un trabajo que dejó en ejecución, no figura en la lista, ni tampoco uno que escribió otra conversación de esta carpeta, según lo indican las llamadas a herramientas que nombran el archivo mientras se ejecutaba.",
  },
  changesView: {
    list: "Cada archivo cambiado en su propia fila, con su ruta completa. Se recuerda en este navegador.",
    tree: "Los archivos cambiados en sus carpetas. Haz clic en una carpeta para contraerla. Se recuerda en este navegador.",
    all: "Todos los archivos del proyecto en sus carpetas, con los cambiados marcados. Solo las carpetas que contienen un cambio empiezan abiertas. Se recuerda en este navegador.",
  },
  changesFoldAll: "Contrae todas las carpetas, para que solo se vea el nivel superior. Haz clic en una carpeta para abrirla de nuevo.",
  changesIgnored: "Muestra u oculta los archivos que git ignora y que escribieron los comandos del agente, como la salida del build. Se recuerda en este navegador.",
  changesEditedByAgent: "Los archivos del proyecto que el agente de esta conversación cambió con sus herramientas de edición en este turno.",
  changesChangedOtherwise:
    "Los archivos del proyecto que cambiaron en este turno sin las herramientas de edición del agente: por comandos que ejecutó el agente, por ti, o por otra conversación o herramienta que trabaja en esta carpeta.",
  changesOthersMayHaveWritten:
    "Escritos mientras se ejecutaban los comandos de esta conversación, pero también mientras otra conversación de esta carpeta ejecutaba un comando o una edición, y lo que ejecutaron las dos no indica cuál lo escribió. Los archivos que solo nombran las llamadas a herramientas de otra conversación se omiten.",
  changesFromCommit: "Un commit desde que empezó el turno cambió este archivo, como el de un pull o uno del propio agente.",
  changesRefresh: "Carga la lista de nuevo. También se carga después de cada llamada a una herramienta que termina el agente y cuando termina el turno.",
  changesByAgent: "El agente de esta conversación cambió este archivo con sus herramientas de edición.",
  changesOpenInEditor: "Abre el archivo en su primera línea cambiada, en el editor que elijas en Configuración › Conversaciones.",
  editDiffStyle:
    "Unificada muestra las líneas antiguas y nuevas en una sola columna; Dividida muestra la versión antigua a la izquierda y la nueva a la derecha. Se recuerda en este navegador.",
};

export const waitingHints: Messages["waitingHints"] = {
  permission: "Esperándote: el agente espera a que apruebes una herramienta.",
  question: "Esperándote: el agente te hizo una pregunta en el lienzo.",
  finished: "Listo: el turno terminó mientras mirabas otra cosa. Abrir la conversación lo borra.",
  error: "Falló: el turno se detuvo con un error mientras mirabas otra cosa. Abrir la conversación lo borra.",
  unread: "No leída: la marcaste para volver a ella. Abrir la conversación lo borra.",
};

export const statusHints: Messages["statusHints"] = {
  idle: "Inactivo: espera tu siguiente mensaje.",
  starting: "Iniciando: el host está iniciando el proceso del agente o reanudando la sesión en él.",
  running: "En ejecución: el agente está trabajando en tu mensaje. Esc o Detener cancela el turno.",
  error: "Error: el agente no pudo iniciarse ni reanudarse. Los detalles están bajo el encabezado.",
};
