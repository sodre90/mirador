import type { SiteWords } from "./en.ts";

export const de: SiteWords = {
  attributes: {
    title: "Mirador: ein Canvas für deinen Coding-Agenten",
    description:
      "Mirador stellt deinem Coding-Agenten einen Canvas neben den Chat: Er zeichnet, was er meint, fragt mit Bildern statt mit Text und führt dich durch seine Änderungen und Reviews. Kostenlos und Open Source, für macOS, Linux und Windows.",
    ogDescription: "Dein Coding-Agent zeichnet, was er meint, fragt mit Bildern statt mit Text und führt dich durch seine Änderungen und Reviews, direkt neben dem Chat.",
    sections: "Abschnitte",
    language: "Sprache",
    copy: "Kopieren",
    copied: "Kopiert",
    trailer: "Trailer",
    trailerAlt: "Der Trailer: Schluss mit Textwüsten, dein Agent zeichnet jetzt",
    trailerPlayer: "Mirador-Trailer",
    canvasAlt: "Eine Unterhaltung über einen Checkout-Flow, daneben das Sequenzdiagramm des Agenten auf dem Canvas",
    askAlt: "Der Agent fragt, welches Layout die Einstellungen bekommen sollen, mit einem Mockup zu jeder Option",
    tourAlt: "Die Tour des Agenten durch seinen Fix: links die Schritte, rechts die geänderte Zeile in src/checkout.ts markiert",
    reviewAlt: "Ein Code-Review, geöffnet auf der Tour durch den Flow: die Schritte neben der Erklärung zum aktuellen Schritt, darunter der Diff mit den Zeilen des Schritts markiert",
    changesAlt: "Die Ansicht Änderungen: die nicht committeten Dateien eines Projekts, darunter aufgeklappt die Bearbeitung des Agenten",
    terminalsAlt: "Zwei Terminals nebeneinander unter der Unterhaltung",
    privacyTitle: "Datenschutzerklärung · Mirador",
    privacyDescription: "Was Mirador und Mirador für Android mit deinen Daten machen: Sie bleiben auf deinen eigenen Geräten.",
  },
  nav: { features: "Features", install: "Installieren", faq: "FAQ" },
  hero: {
    eyebrow: "Kostenlos und Open Source · macOS, Linux und Windows",
    title: 'Sieh,<br><span class="gradient">was dein Coding-Agent meint.</span>',
    lede: "Mirador stellt deinem Coding-Agenten einen Canvas neben den Chat. Er zeichnet, was er meint, fragt mit Bildern statt mit Text und führt dich durch seine Änderungen und Reviews, sodass du sie auf einen Blick verstehst.",
    or: "oder",
    windows: "Windows",
    download: "Download",
    star: "Star auf GitHub",
  },
  trailerCaption: "Trailer ansehen (2:33)",
  why: {
    title: "Code schreiben ist nicht mehr der Flaschenhals. Code lesen schon.",
    body: "In ein paar Minuten liest ein Agent eine Codebase, ändert zehn Dateien und erklärt dir das Ganze in einem endlosen Textblock, alles in derselben Schrift, so schnell er tippen kann. Bilder begreifen wir viel schneller als Text: Ein Sequenzdiagramm zeigt den Weg eines Requests auf einen Blick, in Prosa braucht dasselbe eine ganze Seite. Mirador ist kein weiterer Agent: Es startet die, die du schon benutzt, mit deinen eigenen Einstellungen, und gibt ihnen einen Ort, an dem sie dir etwas zeigen können.",
  },
  show: {
    kicker: "Zeigen",
    title: "Dein Agent zeichnet, was er meint.",
    body: "Diagramme, Mockups, Charts, Vergleiche, sogar 3D-Szenen, auf einem Canvas neben dem Chat statt einer Seite Prosa. Mermaid, D3 und three.js sind eingebaut und laufen offline. Wirft eine Seite einen Script-Fehler, bekommt der Agent ihn zu sehen und fixt ihn.",
  },
  ask: {
    kicker: "Fragen",
    title: "Entscheiden mit Bildern.",
    body: "Statt einer nummerierten Liste im Text fragt der Agent auf dem Canvas: bis zu acht Optionen, jede mit Vorschau. Klick eine an oder schreib deine eigene Antwort, mit einer Anmerkung dazu. Mehrere Fragen kommen auf einmal, jede auf ihrer eigenen Seite, mit einer Übersicht, bevor du abschickst.",
  },
  tour: {
    kicker: "Tour",
    title: "Durch den Code, in der Reihenfolge, in der er läuft.",
    body: "Wie etwas funktioniert oder was der Agent gerade geändert hat: eine kurze Zusammenfassung und Schritte durch den Code, jeder mit seinen Zeilen, die geänderten markiert. Frag zu beliebigen Zeilen nach oder öffne sie in IntelliJ IDEA.",
  },
  review: {
    kicker: "Review",
    title: "Ein Code-Review zum Durchgehen.",
    body: "Urteil und Zusammenfassung, eine geführte Tour durch die Änderung, jeder Diff und die Befunde direkt an ihren Zeilen, jeder als bestätigt oder nur vermutet markiert. Behalte die Befunde, die du teilst, formuliere sie um und poste sie als dein ausstehendes Review in den Pull Request auf GitHub.",
  },
  more: {
    title: "Und der Rest deines Tages mit einem Agenten",
    changes: {
      title: "Jede Änderung, auch außerhalb des Projekts",
      body: "Was dieser Turn oder diese Unterhaltung geändert hat, oder alles, was noch nicht committet ist, mit dem Diff jeder Datei einen Klick entfernt.",
    },
    terminals: { title: "Eine Shell neben jeder Unterhaltung", body: "Tabs und Splits, die weiterlaufen, während du wechselst, und nach einem Neustart wieder da sind." },
    approve: { title: "Jede Bearbeitung mit ihrem Diff freigeben", body: "Eine angefragte Bearbeitung erscheint auf dem Canvas, mit den echten Zeilennummern der Datei, bevor du sie erlaubst." },
    needsYou: { title: "Sieh, wer dich braucht", body: "Alle Projekte in einer Sidebar, mit Markierung, welche Unterhaltungen auf dich warten, fertig sind oder fehlgeschlagen." },
    resume: { title: "Weitermachen, wo das Terminal aufgehört hat", body: "Setz eine Session fort, die du im Terminal angefangen hast, mit ihrem kompletten Verlauf." },
    point: { title: "Draufzeigen und fragen", body: "Zeig auf eine beliebige Stelle einer Seite, die der Agent gezeichnet hat, und frag dazu nach oder lass sie ändern." },
    agents: {
      title: "Deine Agenten, gemeinsam",
      body: "Die echten Agenten, mit deinen Hooks und MCP-Servern. Einer kann eine lange, einfache Aufgabe an einen anderen abgeben, etwa ein lokales Modell, und prüfen, was zurückkommt.",
    },
    jobs: {
      title: "Wartet auf lange Jobs",
      body: "Der Agent lässt einen Build oder Testlauf laufen, auch auf einem Build-Server über ssh oder in einem Container, und Mirador weckt ihn, wenn der Job fertig ist.",
    },
    plugins: {
      title: "Plugins",
      body: "Offizielle Plugins bringen Tools auf den Canvas, etwa Media: Markiere in einem Videoframe, was nicht stimmt, und der Agent schneidet und rendert es.",
    },
    talk: { title: "Sprich mit ihm", body: "Diktiere deine Nachricht, hör dir das Wichtigste der Antwort an und red einfach weiter, freihändig." },
  },
  install: {
    title: "Installieren",
    unix: "Auf einem Mac mit Apple Silicon oder unter Linux (x64 oder arm64) lädt dieser Befehl die App herunter, installiert sie und startet sie:",
    windows: "Unter Windows (x64, experimentell), in PowerShell:",
    brew: "Oder mit Homebrew, unter macOS und Linux:",
    notes:
      'Die macOS-App ist von Apple signiert und notarisiert. Die Windows-App ist noch nicht signiert, SmartScreen warnt also, wenn du den Installer von Hand startest. Linux braucht ein paar Systembibliotheken; die <a href="https://github.com/sodre90/mirador#get-it">README</a> listet sie auf, zusammen mit der manuellen Installation und dem Start aus dem Quellcode. Oder lade die Dateien aus dem <a href="https://github.com/sodre90/mirador/releases/latest">neuesten Release</a> herunter. Danach aktualisiert sich die App von selbst.',
  },
  faq: {
    title: "Fragen",
    cost: {
      question: "Was kostet es?",
      answer: "Nichts. Mirador ist Open Source unter MIT-Lizenz, ohne Account. Du nutzt den Plan oder API-Key deines Agenten, wie bisher.",
    },
    agents: {
      question: "Mit welchen Coding-Agenten funktioniert es?",
      answer: "Heute mit Claude Code, opencode, pi und Codex (die letzten beiden experimentell), über das Agent Client Protocol (ACP). Weitere Agenten kommen.",
    },
    privacy: {
      question: "Verlässt mein Code meinen Rechner?",
      answer:
        "Mirador läuft auf deinem Rechner. Dein Agent redet wie immer mit seinem Modellanbieter, und Mirador selbst fragt nur bei GitHub nach, ob es ein neueres Release gibt. Telemetrie gibt es keine.",
    },
    terminal: {
      question: "Ersetzt es mein Terminal?",
      answer: "Nein. Es startet denselben Agenten mit deinen Einstellungen, Hooks und MCP-Servern und kann eine Session fortsetzen, die du im Terminal angefangen hast.",
    },
    phones: { question: "Und auf dem Handy?", answer: "Apps für Android und iOS sind in Arbeit." },
  },
  footer: { madeBy: "Mirador · MIT-Lizenz · Von Péter Erdős", releases: "Releases", trailer: "Trailer", privacy: "Datenschutz" },
  privacy: {
    title: "Datenschutzerklärung",
    updated: "Zuletzt aktualisiert am 1. November 2026",
    englishPrevails: 'Dies ist eine Übersetzung. Weicht sie von der <a href="../privacy.html">englischen Datenschutzerklärung</a> ab, gilt die englische.',
    intro:
      "Diese Erklärung gilt für Mirador, die App, die du auf deinem Computer ausführst, und Mirador für Android, die Handy-App, die sich mit ihr verbindet. Beide stammen von Péter Erdős. Kurz gesagt: Deine Daten bleiben auf deinen eigenen Geräten. Keine der beiden Apps hat Konten, Analytics, Werbung oder Absturzberichte. Über Server, die wir betreiben, laufen nur die optionalen Benachrichtigungs- und Peer-to-Peer-Dienste unten, und diese können nicht lesen, was du sendest.",
    computerTitle: "Mirador auf deinem Computer",
    computer:
      "Mirador speichert deine Unterhaltungen, Einstellungen und die Geräte, die du eingeladen hast, in einer Datenbank auf deinem Computer. Die Coding-Agenten, die du damit ausführst, sprechen mit ihren eigenen Modellanbietern, zu deren Bedingungen, so wie ohne Mirador. Mirador selbst verbindet sich nur mit GitHub, um nachzusehen, ob es ein neueres Release gibt, und um die Plugins herunterzuladen, die es installiert.",
    androidTitle: "Mirador für Android",
    android:
      "Die Handy-App verbindet sich nur mit den Mirador-Computern, mit denen du sie koppelst, und zwar direkt, über ein Netzwerk deiner Wahl, etwa Tailscale, oder Peer-to-Peer wie unten beschrieben. Jede Verbindung ist zwischen Handy und Computer verschlüsselt. Was die App anzeigt, kommt von ihnen, und was du sendest, geht an sie:",
    messages: "<strong>Nachrichten und Antworten</strong>, die du schreibst, gehen an den Computer, auf dem die Unterhaltung läuft.",
    photos: "<strong>Fotos und Screenshots</strong>, die du anhängst, aus der Kamera, deiner Galerie oder über die Teilen-Funktion einer anderen App, werden auf diesen Computer hochgeladen.",
    camera: "<strong>Die Kamera</strong> scannt den QR-Code, der das Handy mit einem Computer koppelt, und nimmt Fotos auf, die du anhängen möchtest.",
    microphone:
      "<strong>Das Mikrofon</strong> wird nur benutzt, während du zum Diktieren die Senden-Taste gedrückt hältst. Hat das Handy eine eigene Spracherkennung, bleibt, was du sagst, auf dem Handy. Andernfalls wandelt der Spracheingabedienst von Android es in Text um, und dieser Dienst kann es auf seinen Servern verarbeiten, nach seiner eigenen Datenschutzerklärung.",
    replies: "<strong>Vorgelesene Antworten</strong> werden auf deinem Computer erzeugt und auf dem Handy abgespielt.",
    phoneStorage:
      "Das Handy speichert die Computer, mit denen es gekoppelt ist, deine Einstellungen und nicht gesendete Entwürfe in seinem eigenen Speicher, die Zugriffstokens der Computer im sicheren Speicher von Android. Die Entsperrung per Fingerabdruck oder Gesicht, wenn du die App-Sperre einschaltest, prüft Android; die App sieht sie nie.",
    notificationsTitle: "Benachrichtigungen bei geschlossener App",
    notifications:
      "Das ist aus, solange du in Mirador auf deinem Computer kein Push-Relay einstellst. Ist es an, gibt das Handy deinem Computer sein Benachrichtigungstoken von Firebase Cloud Messaging, dem Push-Dienst von Google, und dein Computer speichert es. Um dich zu benachrichtigen, sendet dein Computer das Token und die Benachrichtigung, versiegelt mit einem Schlüssel, den nur dein Handy und dein Computer haben, an das Push-Relay, das sie an Google zur Zustellung weitergibt. Das Relay, unseres oder eines, das du selbst betreibst, speichert und protokolliert weder Tokens noch Benachrichtigungen. Das Relay und Google sehen das Token und wann eine Benachrichtigung gesendet wurde, können aber nicht lesen, was darin steht. Google verarbeitet das Token nach seiner eigenen Datenschutzerklärung.",
    peerToPeerTitle: "Peer-to-Peer",
    peerToPeer:
      "Das ist aus, solange Mirador auf deinem Computer nicht dafür eingerichtet ist. Dann finden Handy und Computer einander über einen Broker, der ihre öffentlichen Schlüssel und Netzwerkadressen sieht, solange sie verbunden sind. Erreichen sie einander nicht direkt, läuft ihr Datenverkehr über den Broker, so verschlüsselt, dass er ihn nicht lesen kann.",
    deletingTitle: "Deine Daten löschen",
    deleting:
      "Wenn du die App deinstallierst, wird alles gelöscht, was sie gespeichert hat. Damit ein Handy einen Computer nicht mehr erreicht, entferne es in Mirador unter <strong>Einstellungen → Geräte</strong>; damit wird auch das Benachrichtigungstoken des Handys von diesem Computer gelöscht.",
    sharingTitle: "Weitergabe und Verkauf",
    sharing:
      "Wir verkaufen deine Daten nicht, geben sie an niemanden weiter und nutzen sie für nichts anderes als die Zustellung von Benachrichtigungen und Verbindungen. Google Play kann Daten über Installationen und App-Abstürze erheben, nach der eigenen Datenschutzerklärung von Google.",
    childrenTitle: "Kinder",
    children: "Mirador ist ein Werkzeug für Softwareentwickler und nicht für Kinder gedacht.",
    changesTitle: "Änderungen und Fragen",
    changes:
      'Änderungen an dieser Erklärung werden auf dieser Seite mit neuem Datum veröffentlicht. Bei Fragen eröffne ein Issue unter <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a>.',
  },
};
