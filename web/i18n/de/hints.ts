import type { Messages } from "../en/index.ts";

export const hints: Messages["hints"] = {
  voiceRecognition:
    "Was deine Sprache in Text umwandelt. Ein eigener Server ist alles, was die Speech-to-Text-API von OpenAI spricht (POST /audio/transcriptions): OpenAI selbst oder ein Whisper-Server auf diesem oder einem anderen Rechner. Mirador schickt ihm WAV mit 16 kHz.",
  voiceModel:
    "Das Sprachmodell, das übersetzt, was du sagst, ins Englische, bevor es ins Nachrichtenfeld kommt, und Antworten zum Vorlesen zusammenfasst. Ein eigener Server spricht die Chat-API von OpenAI (POST /chat/completions); die API eines Profils ist die, die seine Umgebung nennt: ANTHROPIC_BASE_URL mit ANTHROPIC_API_KEY oder ANTHROPIC_AUTH_TOKEN, oder OPENAI_BASE_URL mit OPENAI_API_KEY. Mirador ruft sie direkt auf, ohne den Agenten des Profils zu starten.",
  voiceModelThinkingOff:
    "Für einen lokalen Server mit einem Modell, das nachdenkt, bevor es antwortet, etwa Gemma 4 oder Qwen 3: Das Nachdenken lässt eine Übersetzung viel länger dauern und kann die Antwort aufbrauchen. Mirador schickt chat_template_kwargs mit enable_thinking auf false, was Server wie mlx_lm, vLLM und llama.cpp verstehen. Lass es für die API von OpenAI aus.",
  voiceEngineVoiceModel:
    "Das Sprachmodell übersetzt, was du sagst, ins Englische und fasst später Antworten zum Vorlesen zusammen. Größere übersetzen besser und brauchen mehr Speicher: Mirador bietet die an, die geladen höchstens die Hälfte des Speichers dieses Macs belegen. Ohne eines kommt, was du sagst, in der Sprache ins Nachrichtenfeld, in der du gesprochen hast, außer unten ist ein anderes Sprachmodell eingestellt.",
  thisMacModel:
    "Miradors Modelle für diesen Dienst. Beste, gute und ausreichende Qualität zeigen, wie jedes in Miradors Vergleich auf einem Mac abgeschnitten hat; eines, das noch nicht auf diesem Mac ist, lädt der Button daneben herunter. Mirador bietet die an, die geladen höchstens die Hälfte des Speichers dieses Macs belegen.",
  voiceEngineIdle:
    "Ein geladenes Modell belegt Speicher, ein Sprachmodell bis zu 15 GB, deshalb wird jedes entladen, wenn es so lange ungenutzt bleibt. Erneutes Laden lässt das nächste Diktat warten.",
  voiceEngineLoaded: (minutes) =>
    `Geladen, antwortet also sofort. Es wird nach ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} ohne Nutzung entladen; einstellbar unter Modelle auf diesem Mac.`,
  voiceEngineUnloaded: "Belegt gerade keinen Speicher. Es wird geladen, wenn es das nächste Mal gebraucht wird, meist in 5 bis 15 Sekunden.",
  voiceEngineDownloadWaits: "Ein anderer Download läuft gerade. Dieser kann starten, sobald er fertig ist.",
  voiceEngineRemoveWaits: "Ein Download läuft gerade. Das Entfernen kann starten, sobald er fertig ist.",
  spokenVoiceKept: "Kokoro gehört zur Stimme auf diesem Mac für englische Antworten und verschwindet nur mit Alle entfernen.",
  removeVoiceEngineArmed: "Klicke erneut, um die Sprach-Engine und ihre Modelle von diesem Mac zu löschen. Beim erneuten Einrichten werden sie wieder heruntergeladen.",
  removeVoiceEngineModelArmed: "Klicke erneut, um dieses Modell von diesem Mac zu löschen. Wählst du es wieder, wird es wieder heruntergeladen.",
  voiceModelProfile: "Mirador ruft die API dieses Profils mit dessen Schlüsseln auf. Sein Agent startet nicht.",
  voiceAddress: "Die Adresse der API bis einschließlich ihrer Version, wie in https://api.openai.com/v1. Mirador hängt den Pfad jedes Aufrufs an.",
  voiceLanguage:
    "Die Sprache, die du sprichst. Sie anzugeben hilft bei kurzen Aufnahmen, bei denen das Unterscheiden von Sprachen allein am Klang oft danebengeht; die Engine dieses Macs erkennt Englisch trotzdem als Englisch. Bei „Jede Sprache“ entscheidet der Sprachserver, und das Sprachmodell übersetzt alles, was nicht Englisch ist.",
  translateToEnglish: "Was du sagst, kommt auf Englisch ins Nachrichtenfeld, mit dem, was du gesagt hast, darunter, damit du es vor dem Senden prüfen kannst.",
  translateNeedsVoiceModel: "Zum Übersetzen braucht es ein Sprachmodell. Wähle unten eines.",
  replyVoice:
    "Was Antworten vorliest, nachdem das Sprachmodell jede in wenigen Sätzen zusammengefasst hat. Die Engine dieses Macs spricht Englisch mit Kokoro und Ungarisch mit OmniVoice, einem eigenen Download, dessen Lizenz nur nicht kommerzielle Nutzung erlaubt. Ein eigener Server spricht die Text-to-Speech-API von OpenAI (POST /audio/speech) mit einer ihrer Stimmen. Nach einer Nachricht, die du diktiert hast, wird ihre Antwort vorgelesen, wenn die Runde endet, in dem Browser, in dem du diktiert hast.",
  replyLanguage: "Die Sprache, in der Antworten vorgelesen werden. Das Sprachmodell fasst sie darin zusammen, egal in welcher Sprache der Agent geschrieben hat.",
  replyVoiceName: "Eine der Stimmen des Servers, so wie alloy eine von OpenAI ist.",
  readAloud: "Liest eine kurze Zusammenfassung dieser Antwort vor.",
  stopReadingAloud: "Hört auf, diese Antwort vorzulesen.",
  copyReply: "Kopiert die Antwort dieser Runde als formatierten Text, ohne die Werkzeuge, die sie nutzte.",
  copyReplyAsMarkdown: "Kopiert die Antwort dieser Runde als Markdown, ohne die Werkzeuge, die sie nutzte.",
  keepTalking:
    "Sobald die Antwort auf das, was du diktiert hast, vorgelesen ist, öffnet sich das Mikrofon wieder, und was du als Nächstes sagst, wird sofort gesendet. „stop“ oder „thanks“ zu sagen, oder Esc, beendet es. Eine Frage, die der Agent in der Zwischenzeit stellt, wird vorgelesen, damit du per Stimme antworten kannst; sag „help“, um zu hören, was du sagen kannst.",
  sendRightAway: "Sendet, was du gesagt hast, sobald es Text ist, statt es im Nachrichtenfeld zu lassen, damit du es zuerst prüfst.",
  dictate:
    "Sprechen statt tippen. Tippe darauf, um zu starten; es stoppt, wenn du eine Pause machst oder erneut darauf tippst. Oder halte es gedrückt, während du sprichst. Was du gesagt hast, kommt an die Cursorposition.",
  dictateOff: "Zum Diktieren braucht es die Spracherkennung. Du kannst sie unter Einstellungen → Stimme einschalten.",
  yolo:
    "Alles ohne Nachfrage genehmigen.\n\nWenn der Agent um Erlaubnis bittet, ein Tool auszuführen, antwortet der Host sofort mit der eigenen „allow“-Option des Agenten, statt dir eine Karte zu zeigen. Das Einschalten genehmigt auch eine Anfrage, die schon wartet. Anfragen ohne „allow“-Option fragen dich weiterhin.\n\nDas ist unabhängig vom Modus des Agenten: Tools, die der Modus schon erlaubt, fragen gar nicht erst. Wird pro Unterhaltung gespeichert.",
  conversationSettings:
    "Profil, Agent, Modell und die übrigen Einstellungen dieser Unterhaltung.\n\nDas Profil gibt nur ihre Anfangswerte vor: Wenn du sie hier änderst, bleibt das Profil, wie es ist.",
  yoloOn: "YOLO ist an: Tool-Aufrufe des Agenten werden ohne Nachfrage genehmigt. Schalte es in den Einstellungen dieser Unterhaltung aus.",
  profile:
    "Das Profil (Umgebungsvariablen und Befehl vor dem Start), mit dem der Agent läuft.\n\nJedes Profil führt seinen eigenen Agent-Prozess aus. Ein Wechsel schließt diese Sitzung auf dem aktuellen Prozess und setzt sie auf dem neuen fort, sodass der Agent die ganze Unterhaltung behält. Das Modell geht auf den Standard des neuen Profils zurück.\n\nEin Wechsel, während der Agent arbeitet, stoppt seine Runde, verschiebt die Sitzung und bittet den Agenten, dort weiterzumachen, wo er aufgehört hat; Nachrichten in der Warteschlange gehen danach raus.\n\nProfile eines anderen Agenten lassen sich nur vor der ersten Nachricht wählen: Dieser Agent startet eine neue Sitzung. Hat die Unterhaltung schon begonnen, starte eine neue Unterhaltung, um sie zu nutzen.",
  questions:
    "Was passiert, wenn der Agent dich etwas auf dem Canvas fragt.\n\nAgent wartet: Der ask-Aufruf des Agenten bleibt offen, bis du auf Absenden drückst, und deine Antwort kommt mitten in der Runde als sein Ergebnis zurück.\n\nNächste Nachricht: Der ask-Aufruf kehrt sofort zurück, der Agent beendet seine Runde, und deine Antwort wird später als deine nächste Nachricht gesendet. Gut für Fragen, über die du nachdenken willst.",
  conversationPluginSetting:
    "Nur für diese Unterhaltung. „Vom Profil“ folgt dem, was sein Profil unter Profile einstellt; ein Profilwechsel kehrt dazu zurück.",
  configOption:
    "Der Agent bietet diese Einstellung für die Sitzung an. Eine Änderung schickt den neuen Wert an den Agenten (ACP session/set_config_option), der ihn auf diese Unterhaltung anwendet.",
  dismissNewerVersion: "Blendet das aus, bis es etwas noch Neueres gibt. Unter Einstellungen › Über bleibt es sichtbar.",
  restartHost:
    "Startet den Host an Ort und Stelle neu, damit er seinen Code so ausführt, wie er jetzt ist. Agenten, die arbeiten, stoppen und machen dann dort weiter, wo sie aufgehört haben; Nachrichten in der Warteschlange bleiben erhalten. Terminals kommen als neue Shells unter ihrer bisherigen Ausgabe zurück. Offene Seiten laden sich von selbst neu.",
  stop:
    "Bittet den Agenten, seine Runde zu stoppen, wie Esc. Hat er nach ein paar Sekunden nicht gestoppt, wird daraus Stoppen erzwingen, das stattdessen den Agent-Prozess beendet; andere Unterhaltungen mit demselben Profil machen dort weiter, wo sie aufgehört haben.",
  promptTemplates: "Nachrichten, die du oft sendest, mit den Werten, die du jedes Mal ausfüllst. In den Einstellungen kannst du sie hinzufügen, ändern und löschen.",
  deleteTemplateArmed: "Klicke erneut, um diese Vorlage zu löschen. Hier gelöschte Standardvorlagen kommen nicht zurück.",
  findAddress:
    "Fragt ab, unter welcher Adresse andere Geräte Mirador erreichen: den Namen dieses Rechners in seinem Tailnet und die Adressen, die Geräte schon genutzt haben. Jede wird geprüft, bevor sie angeboten wird – sie muss als dieses Mirador antworten, auf seinem eigenen Port und auf dem Port der Canvas-Bibliotheken. Der Host nutzt die Adresse, die du wählst, ab seinem nächsten Start.",
  exposeOnTailscale:
    "Führt tailscale serve für die beiden Ports von Mirador aus, gespiegelt, sodass das Tailnet Mirador über HTTPS unter https://<dieser Rechner im Tailnet>:<sein Port> erreicht und die Canvas-Bibliotheken unter demselben Namen auf dem Canvas-Port. Sonst wird im Tailnet nichts geändert; der Host nutzt die Adressen ab seinem nächsten Start.",
  address:
    "Wo andere Geräte Mirador öffnen: http://127.0.0.1:4600 nur auf diesem Rechner, oder eine Adresse, die ein Proxy an Mirador weiterleitet, etwa https://macbook.example.ts.net:4600. Der Port ist der von Mirador, 4600, außer der Host wurde mit einem anderen gestartet.",
  canvasAddress:
    "Woher eine Canvas-Seite D3, Mermaid und three lädt. Mirador stellt sie auf einem eigenen Port (4601) bereit, einem anderen Origin als dem der App, damit eine Seite, die ein Agent geschrieben hat, nicht an den Speicher dieses Mirador herankommt. Ein Proxy muss auch diesen Port weiterleiten: https://macbook.example.ts.net:4601.",
  reachRoute:
    "Mirador ist für andere Geräte immer nur auf einem Weg erreichbar. Eine Auswahl zeigt ihn nur an; erst ihr Button Diese verwenden oder Adresse speichern wendet ihn an und nimmt den anderen zurück, sodass hier nichts eingestellt ist, was der Host nicht nutzt. Der Host liest es ab seinem nächsten Start. Eine Adresse, unter der er erreichbar ist, muss ein Proxy bereitstellen, etwa tailscale serve, oder der Host stellt selbst HTTPS im Netzwerk bereit, mit einem Zertifikat, das er erzeugt.",
  proxyElsewhere:
    "Für einen Proxy wie Nginx Proxy Manager auf einem anderen Rechner deines Netzwerks, der die Ports dieses Rechners nicht erreichen kann. Beim Speichern der Adresse stellt Mirador dann auch HTTPS im Netzwerk bereit, und der Proxy leitet an diese Ports weiter.",
  networkReachability:
    "Mirador stellt auf diesem Port selbst HTTPS bereit, mit einer Zertifizierungsstelle, die es erzeugt, sodass Geräte im selben Netzwerk weder Proxy noch Adresse brauchen. Jeder Browser warnt einmal wegen des Zertifikats (oder vertraut ihm dauerhaft, sobald er mirador-ca.pem installiert).",
  useThisNetwork:
    "Lässt Geräte im selben Netzwerk dieses Mirador über HTTPS erreichen, wie die Auswahl unten. Der Host verwendet es ab seinem nächsten Start.",
  inviteDevice:
    "Erzeugt einen Einmalcode, mit dem ein anderer Browser oder eine App diesem Mirador innerhalb von 15 Minuten beitritt. Ein beigetretenes Gerät kann hier alles, auch Befehle in Terminals ausführen.",
  inviteRoute:
    "Peer-to-Peer erreicht diesen Mac von überall, ohne VPN, über die Mirador-App auf einem Handy; ein Browser kann nur über die Adresse beitreten. QR-Code und Link ändern sich mit der Auswahl.",
  removeMachineArmed:
    "Klicke erneut, um diesen Rechner aus der Liste zu entfernen. Er läuft weiter, und dieser Computer bleibt unter seinen Geräten, bis du ihn dort widerrufst.",
  thisComputer: "Die eigenen Arbeitsbereiche und Unterhaltungen dieses Computers",
  manageMachines: "Rechner hinzufügen oder entfernen",
  machineColor: "Gib diesem Rechner eine Farbe, um ihn in der Rechnerleiste zu unterscheiden. Wird auf diesem Computer gespeichert.",
  machineColorStyle:
    "Wo ein Rechner, dem du eine Farbe gegeben hast, sie zeigt: nur an seinem Button in der Rechnerleiste, oder auch als Streifen oben über seiner Ansicht, damit du auf einen Blick siehst, auf welchem Rechner du arbeitest. Eine Farbe gibst du einem Rechner unter Rechner….",
  machines: "Andere Computer, auf denen Mirador läuft, etwa ein Server, dessen Agenten weiterarbeiten, während dieser hier schläft.",
  plugins: "Plugins geben dem Agenten eigene Tools auf dem Canvas oder bringen Apps mit, etwa einen Video- oder Google-Docs-Editor. Installiere, aktualisiere und richte sie hier ein.",
  revokeDeviceArmed: "Klicke erneut, um dieses Gerät abzumelden. Es braucht einen neuen Einladungscode, um wieder beizutreten.",
  officialPlugin: "Eines der offiziellen Mirador-Plugins, aufgeführt im Katalog sodre90/mirador-plugins.",
  installOfficialPlugin: "Klont das Repo des Plugins und zeigt, was davon ausgeführt wird. Nichts davon läuft, bevor du zustimmst.",
  addPlugin: "Klont das Repo und zeigt, was davon ausgeführt wird: seinen Build-Befehl und Host-Code. Nichts davon läuft, bevor du zustimmst.",
  agreeToPlugin:
    "Führt den Build-Befehl aus und legt das Plugin dann in den Plugin-Ordner von Mirador. Mirador lädt es samt Host-Code ab seinem nächsten Start.",
  checkForUpdates: "Sucht jetzt nach einem neueren Mirador, statt bis zur nächsten automatischen Suche zu warten, die alle 6 Stunden kommt.",
  checkPluginUpdates:
    "Sucht nach einem neueren Release des Plugins oder, bei einem Plugin, das einem Branch folgt, nach neuen Commits des Branches. Nichts ändert sich, bis du aktualisierst.",
  pluginUpdatesWaiting:
    "Plugins aus git-Repos mit einem neueren Release oder neuen Commits. Mirador sucht beim Start und alle 6 Stunden und installiert nichts von selbst: Aktualisiere sie unter Einstellungen › Plugins.",
  updateAllPlugins: "Klont das neuere Release oder die neuen Commits jedes Plugins, zeigt, was von jedem ausgeführt wird, und fragt dann einmal für alle.",
  updatePlugin:
    "Klont das neueste Release oder den Branch, wie er jetzt ist, und zeigt, was davon ausgeführt wird. Sobald du zustimmst, baut es ihn und ersetzt erst dann das Plugin, sodass ein fehlgeschlagenes Update es lässt, wie es war.",
  removePluginArmed: "Klicke erneut, um dieses Plugin zu entfernen. Mirador lädt es ab seinem nächsten Start nicht mehr.",
  unlinkPluginArmed: "Klicke erneut, um die Verknüpfung zu entfernen. Der Ordner, auf den sie zeigt, bleibt, wie er ist.",
  copyOnSelect:
    "Text, den du in einem Terminal auswählst, durch Ziehen oder Doppel- bzw. Dreifachklick, kommt sofort in die Zwischenablage, wie in iTerm2 und Linux-Terminals.",
  terminalLink: (click) => `${click}, um den Link in deinem Browser zu öffnen.`,
  terminalPreset: "Eingebaute Farben für Terminals: Hintergrund, Vordergrund und ANSI-Palette.",
  terminalFontSize: "Schriftgröße in Terminal-Splits und -Tabs (11 bis 24 px). ⌘+ und ⌘− ändern sie schrittweise, wenn ein Terminal den Fokus hat.",
  terminalFontFamily:
    "Jede auf diesem Rechner installierte Schrift, mit Namen, z. B. JetBrains Mono. Terminals und die Statuszeile wechseln sofort zu ihr, mit den üblichen Schriften als Ersatz. Leer, oder eine Schrift, die dieser Rechner nicht hat, zeigt die übliche Schrift.",
  terminalLineHeight: "Höhe einer Terminalzeile, als Vielfaches der Schriftgröße.",
  terminalLetterSpacing: "Zusätzlicher Abstand zwischen Terminalzeichen, in Pixeln.",
  terminalCursorStyle: "Die Form des Terminal-Cursors.",
  terminalCursorBlink: "Ob der Terminal-Cursor blinkt.",
  terminalFontWeightBold: "Wie kräftig fetter Text in Terminals ist.",
  terminalScrollback: "Wie viele Zeilen ein Terminal behält, nachdem sie oben hinausgescrollt sind.",
  connectedDevicesInSidebar:
    "Solange Geräte verbunden sind, zeigt eine Zeile unten in der Seitenleiste, wie viele; klicke darauf, um zu sehen, welche. Wird in diesem Browser gespeichert.",
  connectedDevices: (names) => `Jetzt verbunden: ${names.join(", ")}. Klicke, um alle Geräte unter Einstellungen → Geräte zu sehen.`,
  pageLibrariesSetting:
    "Woher eine Seite, die du aus dem Canvas kopierst oder speicherst, D3, Mermaid und three.js lädt. Der Canvas stellt sie selbst bereit, was eine Seite außerhalb von Mirador nicht erreichen kann. three.js kommt immer vom CDN.",
  editsInCanvasSetting:
    "An: Eine Änderung, deren Erlaubnis der Agent von dir erwartet, nimmt den Canvas ein, mit einem Umschalter Vereint / Geteilt und den Zeilennummern der Datei, und der Chat behält eine kleine Karte. Aus: Die Karte im Chat zeigt den Diff, und der Canvas bleibt, wie er ist.",
  askPageBefore:
    "Der Agent hat diese Seite direkt vor der Frage gezeigt, in derselben Runde. Sie bleibt über der Frage, damit du beides lesen kannst; sie steht auch für sich im Verlauf.",
  canvasToggle: "Blendet den Canvas-Bereich aus oder ein. Zeichnungen und Fragen kommen weiter an, solange er ausgeblendet ist, und bleiben im Verlauf.",
  runCommand:
    "Führt den Befehl nach ! im Ordner dieses Arbeitsbereichs mit deiner Login-Shell aus, ohne Eingabe. Seine Ausgabe erscheint hier und geht mit deiner nächsten Nachricht an den Agenten, wie bei ! in Claude Code. Für interaktive Programme nutze das Terminal.",
  undoFiles:
    "Setzt die Dateien dieses Arbeitsbereichs auf den Stand vor Beginn dieser Runde zurück: Was die Runde geändert hat, wird wiederhergestellt, was sie erstellt hat, wird gelöscht. Mirador hat sie aufbewahrt, weil dieser Arbeitsbereich ein git-Repository ist; deine eigenen Commits, Branches und dein Verlauf bleiben unberührt.\n\nDie Unterhaltung bleibt, wie sie ist. Der Agent erfährt mit deiner nächsten Nachricht, dass die Dateien diese Runde nicht mehr enthalten.",
  undoFilesConfirm:
    "Schreibt die Dateien des Arbeitsbereichs auf den Stand zurück, den sie zu Beginn der Runde hatten. Was die Runde und alles danach an den Dateien gemacht hat, geht verloren; die Unterhaltung behält ihre Aufzeichnung davon. Dateien, die seitdem Commits geändert haben, etwa die eines Pulls, bleiben wie committet. Nutze das Terminal, wenn du die Dateien so willst, wie sie jetzt sind.",
  rewind:
    "Setzt die Unterhaltung und die Dateien dieses Arbeitsbereichs auf den Stand vor Beginn dieser Runde zurück: Diese Runde und jede danach verschwinden aus der Unterhaltung, und der Agent macht in einer Sitzung weiter, die nur enthält, was davor kam.\n\nDie entfernten Runden tauchen nirgends mehr auf, weder in der Zeitleiste noch anderswo. Die eigene Sitzungsdatei des Agenten bleibt auf der Festplatte, wo sein eigenes Fortsetzen (--resume von Claude Code, /resume von pi) sie noch erreicht. Deine Commits, Branches und dein Verlauf bleiben unberührt.",
  rewindConfirm:
    "Die Unterhaltung verliert diese Runde und jede danach und mit ihnen den eigenen Verlauf des Agenten; die Dateien gehen auf den Stand zu ihrem Beginn zurück, außer du behältst sie, wie sie sind. Dateien, die seitdem Commits geändert haben, etwa die eines Pulls, bleiben wie committet. Beides lässt sich von hier aus nicht zurückholen.",
  revertFiles:
    "Listet die Dateien hinter den Zahlen oben auf: die seitdem erstellten, die gelöscht werden; die, die auf den Stand zu Beginn dieser Runde zurückgehen; und die, die seitdem Commits geändert haben und die bleiben, wie sie sind.",
  rewindPutFilesBack:
    "An: Die Dateien gehen auf den Stand zu Beginn dieser Runde zurück, außer denen, die seitdem Commits geändert haben. Aus: Nur die Unterhaltung geht zurück, und jede Datei bleibt, wie sie jetzt ist, mit dem, was die entfernten Runden an ihr geändert haben. Der Agent erfährt nichts davon; er findet die Dateien vor, wie sie sind.",
  commandDelivery: "Befehle, die du mit ! ausführst, gehen mit deiner nächsten Nachricht an den Agenten, in den Tags, die Claude Code für seine eigenen !-Befehle nutzt.",
  commandOutputsAttached: "Diese Ausgaben von Befehlen, die du mit ! ausgeführt hast, gehen deiner nächsten Nachricht an den Agenten voraus. ✕ lässt sie weg.",
  terminalToggle:
    "Blendet die Terminals dieser Unterhaltung aus oder ein; sie laufen im Ordner ihres Arbeitsbereichs. Ihre Shells laufen weiter, während der Bereich ausgeblendet ist oder eine andere Unterhaltung angezeigt wird, und nach dem Neuladen verbindet sich die Seite wieder mit ihnen.",
  terminalHide: "Blendet die Terminals aus. Ihre Shells laufen weiter; zeige sie wieder über die Kopfzeile der Unterhaltung oder die Befehlspalette.",
  terminalNewTab:
    "Öffnet eine Shell in einem neuen Tab der Terminals dieser Unterhaltung, im Ordner ihres Arbeitsbereichs. Jedes Fenster zeigt für diese Unterhaltung dieselben Tabs.",
  terminalSplit: "Öffnet eine weitere Shell neben der fokussierten, im selben Tab (bis zu 4).",
  terminalSplitDown: "Öffnet eine weitere Shell unter der fokussierten, im selben Tab (bis zu 4).",
  terminalFindWholeWord: "Ganzes Wort: nur dort, wo der Text für sich steht, nicht innerhalb eines längeren Wortes.",
  terminalFindRegex: "Regulären Ausdruck verwenden: Der Text ist ein regulärer Ausdruck in JavaScript, etwa error|warn.",
  terminalShowAll: "Zeigt die anderen Terminals dieses Tabs wieder; dieses füllt den Tab nicht mehr aus.",
  terminalCloseBusy: (command) =>
    `In diesem Terminal läuft: ${command}. Klicke erneut oder drücke Enter oder ⌘W, um es zu beenden und das Terminal zu schließen; Esc behält es.`,
  terminalCloseTab:
    "Schließt diesen Tab und beendet seine Shells. Ein Mittelklick auf den Tab schließt ihn auch und fragt vorher nach, wenn darin ein Befehl läuft.",
  terminalCloseTabBusy: (command) =>
    `In diesem Tab läuft: ${command}. Klicke erneut, klicke erneut mit der mittleren Maustaste auf den Tab oder drücke Enter, um es zu beenden und den Tab zu schließen; Esc behält es.`,
  terminalCloseTabArmed: "Klicke erneut, um die Shells in diesem Tab zu beenden, samt allem, was darin läuft.",
  terminalCloseSplit: "Beendet diese Shell und schließt ihren Split.",
  terminalCloseSplitArmed: "Klicke erneut, um diese Shell zu beenden, samt allem, was darin läuft.",
  subagentsRunning:
    "Subagenten, die der Agent gestartet hat und die noch arbeiten, auch über dem Nachrichtenfeld aufgelistet; klicke, um den ersten zu öffnen. Einer, der im Hintergrund gestartet wurde, zählt, bis die Runde endet, die ihn gestartet hat, weil vorher nichts meldet, wann er fertig war.",
  searchAll: "Durchsucht jede Unterhaltung in jedem Arbeitsbereich. Ein geöffneter Treffer wird in seiner Unterhaltung gezeigt.",
  find: "Sucht Text überall in dieser Unterhaltung: in früheren Einträgen, die noch nicht geladen sind, und in eingeklappten Karten, die sich dort aufklappen, wo er gefunden wird.",
  fork: "Kopiert diese Unterhaltung in eine neue mit demselben Profil und lässt diese, wie sie ist. Eine Runde, die hier läuft, geht weiter; die Kopie enthält, was der Agent bisher davon gespeichert hat. Möglich, sobald der Agent hier an einer Nachricht gearbeitet hat.",
  findOlder: "Vorheriger Treffer, weiter oben (Enter)",
  findNewer: "Nächster Treffer, weiter unten (Shift+Enter)",
  findMatchCase: "Groß-/Kleinschreibung beachten: Groß- und Kleinbuchstaben gelten als verschieden.",
  runningSubagent: "Ein Subagent bei der Arbeit. Klicke, um seine Karte in der Unterhaltung zu öffnen und zu sehen, was er bisher getan hat.",
  approvalWaiting: "Der Agent oder einer seiner Subagenten wartet weiter oben in der Unterhaltung auf deine Genehmigung. Klicke, um dorthin zu gehen.",
  subagentTokens: (read, written, fresh) =>
    `Eingabe-Token: ${read} aus dem Cache gelesen, ${written} hineingeschrieben, ${fresh} neu. Gezählt aus dem Transkript des Subagenten von Claude Code.`,
  inTerminal:
    "Diese Claude-Code-Sitzung läuft auch in einem Terminal. Der Host sieht das im Sitzungsregister von Claude Code (<config dir>/sessions/<pid>.json) und zeigt, was das Terminal gerade tut.",
  launch:
    "Das Profil, mit dem neue Unterhaltungen in diesem Arbeitsbereich starten, und damit ihr Agent. Wird pro Arbeitsbereich gespeichert. Bestehende Unterhaltungen behalten ihr Profil, bis du sie verschiebst.",
  setUpProfile:
    "Jede Unterhaltung läuft mit einem Profil. Richte dein erstes im Hauptbereich ein; ohne weitere Einstellungen startet es den Agenten so, wie er auf diesem Rechner eingerichtet ist.",
  continueSession:
    "Nimm eine Sitzung von Claude Code, opencode, pi oder Codex auf, die in einem Terminal in diesem Verzeichnis gestartet wurde. Setze sie an Ort und Stelle fort, oder forke ihren Verlauf in eine neue Unterhaltung und lass das Original, wie es ist.",
  sessionSearch:
    "Finde Sitzungen in diesem Verzeichnis nach dem, was darin gesagt wurde, egal wie alt. Die Suche liest die eigenen Aufzeichnungen des Agenten zu jeder Sitzung hier und findet so auch Sitzungen, die die Liste nicht zeigt.",
  profiles:
    "Benannte Einstellungen für einen Agenten: Umgebungsvariablen und ein Befehl vor dem Start, angewendet auf den Agent-Prozess, den das Profil startet. Jede Unterhaltung läuft mit einem davon.",
  shellOutputStyle:
    "Wie jeder Shell-Befehl, den der Agent ausführt, in einer Unterhaltung erscheint, bis du ihn öffnest oder schließt: sein Befehl mit der Ausgabe einen Klick entfernt, die Ausgabe nur offen, wenn der Befehl fehlschlug, eine Zeile, bei der auch der Befehl einen Klick entfernt ist, oder alles offen. Befehle, die du mit ! ausführst, zeigen immer ihre Ausgabe.",
  shellLook:
    "Die Farben der Shell-Blöcke in einer Unterhaltung: die Befehle des Agenten, deine und Befehle, die auf deine Genehmigung warten. Dem Design folgen passt zum Rest der App; Eigene Farben nimmt die Farben für Hintergrund, Text und Prompt, die du wählst.",
  shellFont: "Jede auf diesem Rechner installierte Schrift, mit Namen, z. B. JetBrains Mono. Leer, oder eine Schrift, die dieser Rechner nicht hat, zeigt die Monospace-Schrift der App.",
  shellFontSize: "Die Textgröße in Shell-Blöcken, im Verhältnis zur Textgröße der App.",
  timestamps: "Aus: Die Uhrzeit steht neben dem Namen jedes Autors und in einer späteren Zeile, solange du darauf zeigst.\nAn: Jede Zeile zeigt ihre Uhrzeit.",
  pulses:
    "Die Punkte arbeitender Unterhaltungen und solcher, die auf einen Job warten, pulsieren. Unter Linux ändern sie sich einige Male pro Sekunde, da jede Änderung das Fenster neu zeichnen lässt.\nAus: Sie bleiben still. Sie bleiben auch still, wenn in deinem System „Bewegung reduzieren“ an ist.",
  textSize: "Textgröße in der ganzen App: 50 %, 70 %, 100 %, 140 % oder 200 %. ⌘+ und ⌘− ändern sie schrittweise, ⌘0 setzt sie zurück.",
  theme: "Hell, dunkel, oder der Systemeinstellung folgen.",
  waitingStyle:
    "Wie die Seitenleiste eine Unterhaltung markiert, deren Agent auf dich wartet: auf eine Genehmigung oder eine Antwort (Wartet auf dich), oder weil ihre Runde endete, während du woanders hingesehen hast (Fertig, oder Fehlgeschlagen nach einem Fehler).\n\nBadge und Anzahl: ein Badge in der Zeile und eine Zahl an ihrem Arbeitsbereich. Nur Punkt: ein farbiger Punkt und ein fetter Titel. Badges und eine Liste oben: listet zusätzlich jede wartende Unterhaltung über den Arbeitsbereichen auf.",
  conversationOrder: "Wähle, wie die Unterhaltungen jedes Arbeitsbereichs geordnet sind und in welche Richtung. Favoriten bleiben oben.",
  addFavourite: "Zu Favoriten hinzufügen: Sie bleibt oben in ihrem Arbeitsbereich, egal in welcher Reihenfolge.",
  removeFavourite: "Aus Favoriten entfernen: Sie kehrt an ihren Platz in der Reihenfolge zurück.",
  waitingCount: "Unterhaltungen in diesem Arbeitsbereich, die auf dich warten.",
  workspaceColor: "Gib diesem Arbeitsbereich eine Farbe, um ihn in der Seitenleiste zu unterscheiden. Jedes Fenster zeigt sie.",
  workspaceColorStyle:
    "Wie ein Arbeitsbereich, dem du eine Farbe gegeben hast, sie zeigt: auf seiner ganzen Karte, nur an seiner Überschrift oder als Streifen an seinem Rand über einer zarteren Tönung. Klicke auf die Initialen eines Arbeitsbereichs, um ihm eine Farbe zu geben.",
  newConversation: "Starte eine Unterhaltung in diesem Arbeitsbereich, mit dem Profil, das neben diesem Button gewählt ist.",
  addWorkspace: "Füge ein Projektverzeichnis hinzu. Seine Unterhaltungen laufen mit ihm als Arbeitsverzeichnis.",
  hideSidebar: "Blende die Seitenleiste aus, um Unterhaltung, Canvas und Terminal die ganze Breite zu geben. Wird in diesem Browser gespeichert.",
  showSidebar: "Zeige die Seitenleiste mit den Arbeitsbereichen und Unterhaltungen wieder.",
  addWorkspaceGroup:
    "Füge eine Gruppe hinzu: eine einklappbare Überschrift, unter der du Arbeitsbereiche sammelst, z. B. pro Projekt oder Kunde. Ziehe einen Arbeitsbereich an seiner Überschrift in eine Gruppe und Arbeitsbereiche und Gruppen in jede beliebige Reihenfolge.",
  foldWorkspace: "Klappe diesen Arbeitsbereich bis auf seine Überschrift ein. Öffnest du eine seiner Unterhaltungen, klappt er wieder auf.",
  unfoldWorkspace: "Zeige die Unterhaltungen dieses Arbeitsbereichs wieder.",
  workspaceGroupCount: "Arbeitsbereiche in dieser Gruppe.",
  waitingInGroup: "Unterhaltungen in den Arbeitsbereichen dieser Gruppe, die auf dich warten.",
  waitingAbove: "Unterhaltungen, die auf dich warten, oben aus dem Blick gescrollt. Klicke, um die nächstgelegene zu zeigen.",
  waitingBelow: "Unterhaltungen, die auf dich warten, unten aus dem Blick gescrollt. Klicke, um die nächstgelegene zu zeigen.",
  renameWorkspaceGroup: "Benenne diese Gruppe um.",
  deleteWorkspaceGroup: "Lösche diese Gruppe. Ihre Arbeitsbereiche bleiben, wo sie sind.",
  deleteWorkspaceGroupArmed: "Klicke erneut, um diese Gruppe zu löschen. Ihre Arbeitsbereiche bleiben, wo sie sind.",
  removeWorkspace: "Entferne diesen Arbeitsbereich und seine Unterhaltungen aus der App. Das Verzeichnis und seine Dateien bleiben unberührt.",
  removeWorkspaceArmed:
    "Klicke erneut, um diesen Arbeitsbereich und seine Unterhaltungen aus der App zu entfernen. Das Verzeichnis und seine Dateien bleiben unberührt.",
  deleteConversation:
    "Lösche diese Unterhaltung, ihre Zeitleiste und ihren Canvas-Verlauf aus der App. Die eigenen Sitzungsdateien des Agenten bleiben auf der Festplatte.",
  deleteConversationArmed: "Klicke erneut, um diese Unterhaltung zu löschen. Die eigenen Sitzungsdateien des Agenten bleiben auf der Festplatte.",
  deleteProfileArmed: "Klicke erneut, um dieses Profil zu löschen. Seine Unterhaltungen können mit einem anderen Profil weitergehen.",
  splitter: "Ziehen zum Ändern der Größe, Doppelklick zum Zurücksetzen.",
  composerGrip:
    "Ziehe nach oben, um das Nachrichtenfeld höher zu machen, nach unten, um es kleiner zu machen; mit längerem Text wächst es trotzdem. Jede Unterhaltung in diesem Browser nutzt dieselbe Höhe. Doppelklicke, damit es sich wieder an den Text anpasst.",
  paneGrip:
    "Ziehe es auf einen anderen Bereich, um die beiden zu tauschen, oder nutze Tauschen in der Befehlspalette. Jede Unterhaltung merkt sich ihr eigenes Layout; in den Einstellungen wählst du das, mit dem neue Unterhaltungen starten.",
  paneFullscreen: "Lass diesen Bereich den ganzen Platz einnehmen. Ein Doppelklick auf die Leiste tut dasselbe.",
  paneExitFullscreen: "Zurück zu den anderen Bereichen. Esc tut dasselbe, außer in einem Terminal, das Esc für sich behält.",
  canvasHide: "Blende den Canvas aus. Zeichnungen und Fragen kommen weiter an und bleiben im Verlauf; zeige ihn wieder über die Kopfzeile der Unterhaltung oder die Befehlspalette.",
  settings:
    "Das Design, Zeitstempel, das Layout, mit dem neue Unterhaltungen starten, Systembenachrichtigungen und unter macOS, ob deine Rechtschreibung korrigiert wird oder beim Tippen Wörter vorgeschlagen werden.",
  queue:
    "Nachrichten, die du sendest, während der Agent arbeitet, warten hier.\n\nMit Claude Code, pi und Codex wartet eine Nachricht mit der Markierung „schließt sich der Runde an“ hier nur, solange der Agent Tools ausführt: Sie kommt in die laufende Runde, sobald diese fertig sind, sodass der Agent sie vor seinem nächsten Schritt liest. Eine mit der Markierung „nach der Runde“ wartet, bis die Runde endet, und geht dann als deine nächste Nachricht raus. Enter und ⌥Enter (Alt+Enter) senden jeweils auf eine Art; in den Einstellungen wählst du, welche. opencode kann keine Nachrichten in eine laufende Runde aufnehmen, daher warten bei ihm alle.\n\nWartende Nachrichten gehen einzeln raus, jede, wenn die Runde davor endet, auch nachdem du Stoppen gedrückt hast. Ziehe eine Nachricht an ihrem ⋮⋮, um die Reihenfolge zu ändern, in der sie rausgehen. Bearbeiten holt eine Nachricht zurück ins Nachrichtenfeld; ↑ in einem leeren Feld tut dasselbe mit der letzten. Die Warteschlange liegt beim Host, sodass sie ein Neuladen der Seite und einen Neustart des Hosts übersteht.",
  usageLimit:
    "Claude Code hat an seinem Nutzungslimit gestoppt. Statt deine Nachrichten aus der Warteschlange gegen dieselbe Wand laufen zu lassen, behält der Host sie und bittet den Agenten wie Claude Code eine Minute nach dem Zurücksetzen des Limits, dort weiterzumachen, wo er aufgehört hat; deine Nachrichten aus der Warteschlange folgen. Das tut er von selbst höchstens zweimal hintereinander; danach, oder wenn die Meldung keine Zeit für das Zurücksetzen nennt, wartet er auf dich.\n\nDas Warten übersteht einen Neustart des Hosts.",
  continueAfterUsageLimit:
    "Bitte den Agenten, jetzt dort weiterzumachen, wo er aufgehört hat, z. B. nach dem Wechsel zu einem Profil, das sich bei einem anderen Konto anmeldet. Nachrichten aus der Warteschlange folgen.",
  tryAgain: "Bitte den Agenten, dort weiterzumachen, wo er aufgehört hat. Er hat die Nachricht, mit der die fehlgeschlagene Runde begann, noch.",
  stopWaitingForUsageLimit: "Hör auf, auf das Zurücksetzen zu warten: Der Agent macht nicht von selbst weiter, und Nachrichten aus der Warteschlange gehen jetzt raus.",
  jobWait:
    "Der Agent hat diesen Job laufen lassen und mirador when-done ausgeführt, damit er ihn nicht abfragen muss. Mirador sieht ab und zu nach: bei einem Prozess jede Sekunde, bei einem Container alle 5 Sekunden, bei einem Job auf einem anderen Rechner alle 20 Sekunden über ssh. Wenn er endet, geht die Nachricht als deine nächste Nachricht an den Agenten oder, wenn der Agent darum gebeten hat, nur an dich.\n\nDas Warten übersteht einen Neustart des Hosts.",
  followJob:
    "Verfolge ihn in einem Terminal-Tab dieser Unterhaltung: was er ausführt, wie lange er schon läuft, dann seine Ausgabe, sobald sie kommt, aus der Datei, in die ein Prozess schreibt, oder aus den Logs des Containers. Der Tab meldet, wann der Job endet. Ctrl+C schließt ihn; der Job läuft weiter.",
  stopWaitingForJob: "Hör auf, auf diesen Job zu warten: Wenn er endet, erfährt es niemand. Er läuft weiter.",
  asyncTask:
    "Claude Code selbst führt das im Hintergrund aus, damit der Agent nicht darauf warten muss: ein Befehl, den er mit run_in_background gestartet hat, oder ein Workflow. Claude Code sagt dem Agenten, wann er endet.\n\nDie Aufgabe lebt und stirbt mit dem Prozess des Agenten.",
  asyncTaskOutput:
    "Zeige, was die Aufgabe bisher geschrieben hat: das Ende der Datei, in der Claude Code ihre Ausgabe ablegt, aktualisiert, solange das offen bleibt. Klicke erneut, um es auszublenden.",
  stopAsyncTask: "Stoppe diese Aufgabe: Claude Code beendet sie, und der Agent erfährt davon. Die Runde, die sie gestartet hat, läuft weiter.",
  dismissAsyncTask: "Verwirf diese Aufgabe: Sie verschwindet über dem Nachrichtenfeld.",
  clearFinishedAsyncTasks: "Entferne alle fertigen Aufgaben über dem Nachrichtenfeld.",
  delegatedTask:
    "Das Tool eines Plugins, etwa delegate, hat diese Unterhaltung mit einem anderen Profil gestartet, um an einer Aufgabe für diese hier zu arbeiten. Wenn ihre erste Runde endet, kommt die letzte Nachricht ihres Agenten als deine nächste Nachricht beim Agenten dieser Unterhaltung an.\n\nDie Antwort übersteht einen Neustart des Hosts.",
  openDelegatedTask: "Öffne die Unterhaltung, die an dieser Aufgabe arbeitet, um zuzusehen oder zu beantworten, was sie fragt.",
  stopDelegatedTask: "Stoppe ihre Runde. Der Agent hier erfährt, dass die Aufgabe gestoppt wurde, mit dem, was der andere Agent bis dahin gesagt hat.",
  dismissDelegatedTask:
    "Verwirf diese Aufgabe: Sie verschwindet über dem Nachrichtenfeld und ihre Unterhaltung aus der Seitenleiste. Die Suche findet die Unterhaltung weiterhin.",
  delegatedFold: "Unterhaltungen, denen diese hier Aufgaben übergeben hat, etwa mit delegate. Klicke, um sie darunter ein- oder auszublenden.",
  claudeProgram: (installFolders) =>
    `Das claude-Programm, mit dem Mirador Claude Code ausführt, auf dem Computer des Hosts. Leer: das claude im PATH, sonst das in diesen Ordnern: ${installFolders}.\n\nEin Profil kann über CLAUDE_CODE_EXECUTABLE in seiner Umgebung ein anderes ausführen.`,
  keepAwake:
    "Verhindert, dass der Computer, auf dem Mirador läuft, im Leerlauf in den Ruhezustand geht.\n\nWährend Agenten arbeiten: bis jede laufende Runde endet, damit lange Jobs fertig werden.\n\nImmer: solange Mirador läuft, damit dein Handy und andere Geräte es jederzeit erreichen.\n\nUnter macOS und Linux.",
  canvasUse:
    "Bei Bedarf: Der Agent entscheidet anhand der eigenen Anweisungen des Canvas.\n\nOft: Die System-Prompts von Claude Code, pi, Codex und Antigravity sowie die Canvas-Anweisungen für Copilot sagen ihnen außerdem, Erklärungen, Vergleiche, Pläne und die Zusammenfassung einer größeren Arbeit auf den Canvas zu bringen und dich dort nach Entscheidungen zu fragen.\n\nSeiten kosten mehr Token als dieselbe Antwort als Text.",
  keepDeletedCanvas:
    "Wenn du eine Unterhaltung löschst, bleibt ihr Canvas so lange erhalten. Setzt du ihre Sitzung über Sitzung fortsetzen… fort, kommt der Canvas so zurück, wie er war, auch Reviews und Rundgänge. Danach kommt nur zurück, was der eigene Verlauf der Sitzung enthält: Seiten, Fragen und Checklisten.",
  terminalCommand:
    "Claude Code zeigt das nur in seinem eigenen Terminal, deshalb landet es in einem Terminal-Tab dieser Unterhaltung, ausgeführt von dem Claude Code, das das Profil dieser Unterhaltung nutzt. Der Befehl passiert dort im Terminal; die Antwort des Agenten oben ist nur seine Ablehnung.",
  logIn:
    "Öffnet die eigene Anmeldung des Agenten in einem Terminal-Tab dieser Unterhaltung, mit ihrem Profil, sodass ein Profil mit eigenem Konto genau dieses anmeldet. Sobald dort steht, dass du angemeldet bist, sende deine Nachricht erneut.",
  queuedGrip: "Ziehe, um die Reihenfolge zu ändern, in der Nachrichten aus der Warteschlange rausgehen: Sie gehen von oben weg.",
  queuedDelivery: "Wie diese Nachricht rausgeht: in die laufende Runde, sobald die Tools des Agenten fertig sind, oder nach dem Ende der Runde. Klicke zum Umschalten.",
  steerMessage:
    "Fügt die Nachricht der laufenden Runde hinzu: Claude Code liest sie sofort und unterbricht, was es gerade schreibt, oder, während es Tools ausführt, sobald diese fertig sind. pi liest sie, sobald es mit dem Schreiben oder dem Ausführen seiner Tools fertig ist.",
  afterTurnMessage: "Behält die Nachricht, bis die laufende Runde endet (oder du Stoppen drückst), und sendet sie dann als deine nächste Nachricht.",
  messageBox:
    "Formatiert beim Tippen wandelt **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, Codeblöcke mit ```, Zitate mit > und Listen mit - beim Tippen in Formatierung um, wie in Slack; ⌘B, ⌘I, ⌘⇧X und ⌘E formatieren eine Auswahl. Der Agent bekommt so oder so dasselbe Markdown.",
  formatBar: "Formatierungsbuttons über dem Nachrichtenfeld. Unter Einstellungen › Unterhaltungen kannst du sie dauerhaft anzeigen.",
  formatBarSetting:
    "Ob die Formatierungsbuttons über dem formatierten Nachrichtenfeld von Anfang an erscheinen oder erst nach einem Klick auf Aa daneben. Aa blendet sie in beiden Fällen ein und aus.",
  formatBold: "Fett, oder tippe **Text**",
  formatItalic: "Kursiv, oder tippe *Text*",
  formatStrike: "Durchgestrichen, oder tippe ~~Text~~",
  formatCode: "Code, oder tippe `Text`",
  formatLink: "Verlinke den ausgewählten Text mit einer Adresse, oder tippe [Text](Adresse)",
  formatLinkAddress: "Enter verlinkt, eine leere Adresse entfernt den Link, und Esc lässt ihn, wie er war.",
  formatBullets: "Aufzählung, oder beginne eine Zeile mit - und einem Leerzeichen. Enter fügt einen Punkt hinzu; ⌘Enter (Ctrl+Enter) sendet.",
  formatNumbers: "Nummerierte Liste, oder beginne eine Zeile mit 1. und einem Leerzeichen. Enter fügt einen Punkt hinzu; ⌘Enter (Ctrl+Enter) sendet.",
  formatQuote: "Zitat, oder beginne eine Zeile mit > und einem Leerzeichen",
  formatCodeBlock: "Codeblock, oder tippe ``` am Anfang einer Zeile. Enter fügt eine Zeile hinzu, ↓ an seinem Ende verlässt ihn, ⌘Enter (Ctrl+Enter) sendet.",
  enterWhileBusy:
    "Was Enter mit einer Nachricht macht, während der Agent arbeitet; ⌥Enter (Alt+Enter) macht das andere. Mit opencode warten Nachrichten immer auf das Ende der Runde.",
  openFile:
    "Öffnet die Datei in dem Programm, das das System des Hosts dafür nutzt, auf dem Rechner, auf dem Mirador läuft. Ein Skript öffnet sich als Text, in dem Programm, das unter Einstellungen › Unterhaltungen gewählt ist. Ein ausführbares Programm wird nicht geöffnet.",
  pushRelayAddress: "Wohin dieser Mac Pushes für deine Handys schickt; leer schickt er keine. Handys bekommen Pushes erst, wenn sie sich bei diesem Mac registriert haben.",
  pushRelayToken: "Das Token, das der Betreiber des Relays für diesen Mac erstellt hat. Mirador speichert es und zeigt es nie wieder; lass das Feld leer, um das gesetzte zu behalten.",
  machineName:
    "Wie Handys diesen Rechner nennen: Sie übernehmen den Namen beim Verbinden, und ein Handy kann ihm trotzdem einen eigenen geben. Unter diesem Namen tritt er auch anderen Rechnern als Mirador bei. Bleibt es leer, heißt er wie sein Computer.",
  scriptProgram:
    "Wo sich ein Dateilink auf ein Skript öffnet, als Text, auf dem Computer des Hosts. Das Programm für seinen Typ könnte es ausführen: Git for Windows führt .sh-Dateien aus, der Python-Launcher .py-Dateien.\n\nDer Texteditor des Systems: unter macOS der, den du für Text gewählt hast, unter Windows der Editor. Linux hat keinen eigenen, daher wählt dort xdg-open das Programm für den Typ des Skripts, und ein ausführbares Skript, das dieses Programm ausführen könnte, öffnet sich nicht.\n\nEin Programm, das du nennst: sein Name im PATH des Hosts, etwa code oder subl, oder sein vollständiger Pfad. Es bekommt den Pfad der Datei. Unter Windows nenne eine .exe, etwa Code.exe: Eine .cmd oder .bat würde über cmd.exe laufen, das einen Teil eines Dateinamens für einen Befehl halten könnte.",
  editor:
    "Der Editor, den Öffnen in … nutzt, auf dem Computer des Hosts. Mirador sucht den Kommandozeilen-Launcher jedes Editors (idea, code, cursor, zed, subl) im PATH des Hosts und dort, wo sein Installer ihn ablegt. Der erste gefundene in dieser Reihenfolge wird genommen.",
  editorCommand:
    "Ein Programm und seine Argumente, ohne Shell ausgeführt. {file} wird zum Pfad der Datei und {line} zu ihrer Zeile; ohne {file} kommt der Pfad ans Ende. Setze den Pfad eines Programms in Anführungszeichen, wenn er Leerzeichen enthält.",
  profilePicture:
    "Dein Bild, neben deinen Nachrichten gezeigt. Es wird quadratisch zugeschnitten, hier mit 128 Pixeln gezeichnet und vom Host gespeichert: Jeder Browser und jedes Gerät, das dieses Mirador öffnet, sieht es.",
  blockedImage:
    "Öffnet das Bild in deinem Browser. Mirador lädt selbst keine Bilder von anderen Seiten, damit ein Agent ihnen nicht schicken kann, was er gelesen hat; unter Einstellungen → Unterhaltungen lässt sich das ändern.",
  scriptMessage:
    "Ein Skript, das der Agent gestartet hat, hat das als deine nächste Nachricht gesendet, damit der Agent weitermacht, wenn das Skript fertig ist. Skripte senden mit mirador message.",
  miradorMessage:
    "Mirador hat das an den Agenten gesendet, als seine Runde endete: um mit einem Schritt weiterzumachen, den er angekündigt, aber nicht getan hat, oder um den Canvas zu nutzen, wenn er in den Einstellungen auf Oft steht, etwa dich mit ask statt im Chat zu fragen.",
  pluginMessage:
    "Ein Plugin hat das als deine nächste Nachricht gesendet, etwa Delegate mit der Antwort einer Aufgabe, die der Agent abgegeben hat, damit der Agent dort weitermacht.",
  gitBranch: "Der git-Branch, der im Verzeichnis des Arbeitsbereichs ausgecheckt ist.",
  model: "Das Modell, das der Agent nutzt, wie oben im Menü Modell gewählt.",
  cost: "Was die Unterhaltung bisher gekostet hat, wie der Agent es meldet.",
  credits: "KI-Credits, die diese Unterhaltung bisher verbraucht hat, wie GitHub Copilot sie zählt.",
  profileChip: "Das Profil, mit dem der Agent dieser Unterhaltung läuft.",
  quota: (limit, percent, resetsIn) =>
    `${limit}-Nutzungslimit deines Plans: ${percent} verbraucht, beginnt von vorn in ${resetsIn}.\n\nDer Agent meldet es nach jeder Antwort, für das Konto des Profils dieser Unterhaltung.`,
  statuslineCommand: (command) =>
    `Deine Statuszeile, ausgegeben von: ${command}.\n\nDer Host führt sie aus wie Claude Code: das Statuszeilen-JSON von Claude Code auf stdin (Modell, cwd, Sitzung, Transkript, Kontextfenster, Kosten) und die Profilumgebung der Unterhaltung. Wechsle hier zur eingebauten Statuszeile.`,
  statuslineBuiltIn: (command) =>
    `Die eingebaute Statuszeile.\n\nDie Einstellungen von Claude Code nennen einen Statuszeilenbefehl (${command}); wechsle hier zu ihm.`,
  canvasOlder: "Zeige das vorige Canvas-Element.",
  canvasNewer: "Zeige das nächste Canvas-Element.",
  canvasHistory: "Alles, was der Agent in dieser Unterhaltung gezeichnet oder gefragt hat, das Neueste zuerst.",
  canvasClear: "Leere den Canvas. Nichts wird gelöscht: Das Element bleibt im Verlauf.",
  canvasOpenInWindow: "Zeige dieses Element in einem eigenen Fenster, das aktuell bleibt, etwa auf einem zweiten Bildschirm. Erneutes Öffnen holt dieses Fenster nach vorn.",
  canvasMore:
    "Die übrigen Buttons der Leiste, für die ein schmaler Bereich keinen Platz hat, und die Apps, die andere Unterhaltungen dieses Arbeitsbereichs nutzen, um sie auch hier zu zeigen.",
  canvasPageExport: "Kopiere diese Seite als Bild oder als HTML, bitte den Agenten, sie als Markdown zu schreiben, oder speichere sie als eigene Datei.",
  canvasPoint:
    "Zeige auf etwas auf der Seite, um den Agenten danach zu fragen oder es ändern zu lassen: Ein Klick wählt das umrandete Element unter der Maus, statt das zu tun, was die Seite tut, und Ziehen zeichnet einen Rahmen um einen Bereich, der als Bild mitgeht. Esc beendet das. Um nach Text zu fragen, wähle ihn einfach aus.",
  canvasPageFind: "Text auf der Seite suchen, die der Agent gezeigt hat: Alle Treffer werden auf ihr markiert, der aktuelle in Sicht gerollt.",
  pageMarkChange: "Sag dem Agenten, was er dort ändern soll: Er zeigt die Seite mit der Änderung erneut.",
  canvasEditsWaiting: "Zeige die Änderung, bei der der Agent darauf wartet, dass du sie erlaubst oder ablehnst.",
  canvasChanges: "Die Dateien, die diese Runde geändert hat, oder alle nicht committeten Änderungen, mit ihren Zeilenänderungen.",
  canvasApp: "Die App, die in diesem Arbeitsbereich offen ist und die du und der Agent gemeinsam ändert. Jede Unterhaltung, die sie zeigt, arbeitet am selben Dokument.",
  canvasWorkspaceTab: "Der Tab eines Plugins für diesen Arbeitsbereich, in jeder seiner Unterhaltungen derselbe.",
  canvasChecklist:
    "Die Schritte der Arbeit des Agenten, abgehakt, sobald er sie erledigt. Du kannst auch jeden davon abhaken: Der Agent erfährt mit deiner nächsten Nachricht von deinen Haken.",
  checklistClose: "Zurück zu dem, was der Canvas gezeigt hat. Der Button Checkliste öffnet sie wieder.",
  checklistDismiss: "Nimm die Checkliste endgültig vom Canvas. Sie bleibt weg, bis der Agent eine neue veröffentlicht.",
  checklistPlan: "Die eigene To-do-Liste des Agenten, wie er sie zuletzt aktualisiert hat. Nur der Agent hakt diese ab.",
  changesScope: {
    turn: "Die Dateien, die sich von ihrem Stand zu Beginn dieser Runde unterscheiden, so wie der Agent oder irgendetwas anderes sie hinterlassen hat.",
    uncommitted: "git status: die Dateien, die sich vom letzten Commit unterscheiden, und die Dateien außerhalb des Projekts, die der Agent in dieser Unterhaltung bearbeitet hat.",
    session:
      "Jede Datei, die der Agent in dieser Unterhaltung mit seinen Bearbeitungs-Tools geändert hat, auch wo eine spätere Runde sie zurückgeändert hat, und die Dateien, die geschrieben wurden, während seine Befehle liefen, samt Build-Ausgabe und seinen Commits. Eine Datei, die ein Befehl gelöscht hat oder die ein Job, den er laufen ließ, später geschrieben hat, steht nicht in der Liste, ebenso wenig eine, die eine andere Unterhaltung in diesem Ordner geschrieben hat, erkennbar an ihren Tool-Aufrufen, die die Datei nennen, während sie lief.",
  },
  changesView: {
    list: "Jede geänderte Datei in einer eigenen Zeile, mit ihrem ganzen Pfad. Wird in diesem Browser gespeichert.",
    tree: "Die geänderten Dateien in ihren Ordnern. Klicke auf einen Ordner, um ihn einzuklappen. Wird in diesem Browser gespeichert.",
    all: "Jede Datei des Projekts in ihren Ordnern, die geänderten markiert. Nur die Ordner mit einer Änderung sind anfangs offen. Wird in diesem Browser gespeichert.",
  },
  changesFoldAll: "Klappe jeden Ordner ein, sodass nur die oberste Ebene zu sehen ist. Klicke auf einen Ordner, um ihn wieder zu öffnen.",
  changesIgnored: "Zeige oder verberge die Dateien, die git ignoriert und die die Befehle des Agenten geschrieben haben, etwa Build-Ausgabe. Wird in diesem Browser gespeichert.",
  changesEditedByAgent: "Die Dateien des Projekts, die der Agent dieser Unterhaltung in dieser Runde mit seinen Bearbeitungs-Tools geändert hat.",
  changesChangedOtherwise:
    "Die Dateien des Projekts, die sich in dieser Runde ohne die Bearbeitungs-Tools des Agenten geändert haben: durch Befehle, die der Agent ausgeführt hat, durch dich oder durch eine andere Unterhaltung oder ein anderes Tool, das in diesem Ordner arbeitet.",
  changesOthersMayHaveWritten:
    "Geschrieben, während die Befehle dieser Unterhaltung liefen, aber auch, während eine andere Unterhaltung in diesem Ordner einen Befehl oder eine Bearbeitung ausführte, und was die beiden ausgeführt haben, verrät nicht, welche sie geschrieben hat. Dateien, die nur die Tool-Aufrufe einer anderen Unterhaltung nennen, sind ausgelassen.",
  changesFromCommit: "Ein Commit seit Beginn der Runde hat diese Datei geändert, etwa der eines Pulls oder einer des Agenten selbst.",
  changesRefresh: "Lade die Liste neu. Sie lädt auch nach jedem Tool-Aufruf, den der Agent abschließt, und wenn die Runde endet.",
  changesByAgent: "Der Agent dieser Unterhaltung hat diese Datei mit seinen Bearbeitungs-Tools geändert.",
  changesOpenInEditor: "Öffne die Datei an ihrer ersten geänderten Zeile, in dem Editor, der unter Einstellungen › Unterhaltungen gewählt ist.",
  editDiffStyle:
    "Vereint zeigt die alten und neuen Zeilen in einer Spalte; Geteilt zeigt die alte Version links und die neue rechts. Wird in diesem Browser gespeichert.",
};

export const waitingHints: Messages["waitingHints"] = {
  permission: "Wartet auf dich: Der Agent wartet darauf, dass du ein Tool genehmigst.",
  question: "Wartet auf dich: Der Agent hat dir auf dem Canvas eine Frage gestellt.",
  finished: "Fertig: Die Runde endete, während du woanders hingesehen hast. Verschwindet, sobald du die Unterhaltung öffnest.",
  error: "Fehlgeschlagen: Die Runde stoppte mit einem Fehler, während du woanders hingesehen hast. Verschwindet, sobald du die Unterhaltung öffnest.",
  unread: "Ungelesen: Du hast sie markiert, um darauf zurückzukommen. Verschwindet, sobald du die Unterhaltung öffnest.",
};

export const statusHints: Messages["statusHints"] = {
  idle: "Inaktiv: wartet auf deine nächste Nachricht.",
  starting: "Startet: Der Host startet den Agent-Prozess oder setzt die Sitzung darauf fort.",
  running: "Läuft: Der Agent arbeitet an deiner Nachricht. Esc oder Stoppen bricht die Runde ab.",
  error: "Fehler: Der Agent konnte nicht starten oder fortsetzen. Die Details stehen unter der Kopfzeile.",
};
