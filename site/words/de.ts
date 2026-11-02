import type { SiteWords } from "./en.ts";

export const de: SiteWords = {
  attributes: {
    title: "Mirador: ein Canvas für deinen Coding-Agenten",
    description:
      "Mirador gibt deinem Coding-Agenten einen Canvas neben der Unterhaltung: Er zeichnet, was er meint, fragt dich mit Bildern und führt dich durch seine Änderungen und Reviews. Kostenlos und Open Source, für macOS, Linux und Windows.",
    ogDescription: "Dein Coding-Agent zeichnet, was er meint, fragt dich mit Bildern und führt dich durch seine Änderungen und Reviews, direkt neben der Unterhaltung.",
    sections: "Abschnitte",
    language: "Sprache",
    copy: "Kopieren",
    copied: "Kopiert",
    trailer: "Trailer",
    trailerAlt: "Der Trailer: Schluss mit Textwüsten, dein Agent zeichnet jetzt",
    trailerPlayer: "Mirador-Trailer",
    canvasAlt: "Eine Unterhaltung über einen Checkout-Ablauf, daneben das Sequenzdiagramm des Agenten auf dem Canvas",
    askAlt: "Der Agent fragt, welches Layout für die Einstellungen er bauen soll, mit einer Mockup-Vorschau für jede Option",
    tourAlt: "Der Rundgang des Agenten durch seinen Fix: links die Schritte, rechts die geänderte Zeile von src/checkout.ts markiert",
    reviewAlt: "Ein Code-Review, geöffnet auf seinem Rundgang durch den Ablauf: die Schritte neben der Erklärung des aktuellen Schritts, darunter der Diff mit den Zeilen des Schritts markiert",
    changesAlt: "Die Ansicht Änderungen: die nicht committeten Dateien eines Projekts, mit der Bearbeitung des Agenten unter ihrer Zeile geöffnet",
    terminalsAlt: "Zwei Terminals nebeneinander unter der Unterhaltung",
    privacyTitle: "Datenschutzerklärung · Mirador",
    privacyDescription: "Was Mirador und Mirador für Android mit deinen Daten machen: Sie bleiben auf deinen eigenen Geräten.",
  },
  nav: { features: "Funktionen", install: "Installieren", faq: "FAQ" },
  hero: {
    eyebrow: "Kostenlos und Open Source · macOS, Linux und Windows",
    title: 'Sieh, was dein Coding-Agent <span class="gradient">meint.</span>',
    lede: "Mirador gibt deinem Coding-Agenten einen Canvas neben der Unterhaltung. Er zeichnet, was er meint, fragt dich mit Bildern und führt dich durch seine Änderungen und Reviews, sodass du sie auf einen Blick verstehst.",
    or: "oder",
    windows: "Windows",
    download: "Herunterladen",
    star: "Auf GitHub einen Stern geben",
  },
  trailerCaption: "Sieh dir den Trailer an (2:33)",
  why: {
    title: "Code schreiben bremst nicht mehr. Code lesen schon.",
    body: "In wenigen Minuten liest ein Agent eine Codebasis, ändert zehn Dateien und erklärt, was er getan hat, in einem langen Textstrom, alles in einer Schrift, so schnell er tippt. Bilder verstehen wir viel schneller als Text: Ein Sequenzdiagramm erklärt den Weg einer Anfrage auf einen Blick, wo dasselbe in Prosa eine ganze Seite füllt. Mirador ist kein weiterer Agent: Es führt die aus, die du schon nutzt, mit deinen eigenen Einstellungen, und gibt ihnen einen Ort, an dem sie dir etwas zeigen können.",
  },
  show: {
    kicker: "Zeigen",
    title: "Dein Agent zeichnet, was er meint.",
    body: "Diagramme, Mockups, Charts, Vergleiche, sogar 3D-Szenen, auf einem Canvas neben dem Chat statt einer Seite Prosa. Mermaid, D3 und three.js sind eingebaut und funktionieren offline. Hat eine Seite einen Skriptfehler, erfährt der Agent davon und behebt ihn.",
  },
  ask: {
    kicker: "Fragen",
    title: "Entscheidungen mit Bildern.",
    body: "Statt einer nummerierten Liste im Text fragt der Agent auf dem Canvas: bis zu acht Optionen, jede mit Vorschau. Klicke eine an oder schreib deine eigene Antwort und füge eine Notiz hinzu. Mehrere Fragen kommen auf einmal, jede auf ihrer Seite, mit einer Übersicht, bevor du sendest.",
  },
  tour: {
    kicker: "Rundgang",
    title: "Durch den Code, in der Reihenfolge, in der er läuft.",
    body: "Wie etwas funktioniert oder was der Agent gerade geändert hat: eine kurze Zusammenfassung und Schritte durch den Code, jeder mit seinen Zeilen, die geänderten markiert. Frag nach beliebigen Zeilen oder öffne sie in IntelliJ IDEA.",
  },
  review: {
    kicker: "Review",
    title: "Ein Code-Review, durch das du gehen kannst.",
    body: "Urteil und Zusammenfassung, ein geführter Rundgang durch die Änderung, jeder Diff und Befunde an ihren Zeilen, jeder als bestätigt oder nur vermutet markiert. Behalte die Befunde, denen du zustimmst, formuliere sie um und poste sie als dein ausstehendes Review in den GitHub-Pull-Request.",
  },
  more: {
    title: "Und der Rest deines Tages mit einem Agenten",
    changes: {
      title: "Jede Änderung, auch außerhalb des Projekts",
      body: "Was diese Runde oder diese Unterhaltung geändert hat, oder alles nicht Committete, mit dem Diff jeder Datei einen Klick entfernt.",
    },
    terminals: { title: "Eine Shell neben jeder Unterhaltung", body: "Tabs und geteilte Ansichten, die weiterlaufen, während du wechselst, und nach einem Neustart wiederkommen." },
    approve: { title: "Jede Bearbeitung mit ihrem Diff genehmigen", body: "Eine angefragte Bearbeitung erscheint auf dem Canvas, mit den Zeilennummern der Datei, bevor du sie erlaubst." },
    needsYou: { title: "Sieh, wer dich braucht", body: "Alle Projekte in einer Seitenleiste, mit Markierung für Unterhaltungen, die auf dich warten, fertig oder fehlgeschlagen sind." },
    resume: { title: "Weitermachen, wo das Terminal aufhörte", body: "Setze eine Sitzung fort, die du in einem Terminal begonnen hast, mit ihrem ganzen Verlauf." },
    point: { title: "Zeigen und fragen", body: "Zeig auf einen beliebigen Teil einer Seite, die der Agent gezeichnet hat, und frag danach oder lass ihn ändern." },
    agents: {
      title: "Deine Agenten, gemeinsam",
      body: "Die echten Agenten, mit deinen Hooks und MCP-Servern. Einer kann eine lange, einfache Aufgabe an einen anderen abgeben, etwa ein lokales Modell, und prüfen, was zurückkommt.",
    },
    jobs: {
      title: "Mirador wartet auf lange Jobs",
      body: "Der Agent lässt einen Build oder Testlauf laufen, sogar auf einem Build-Server über ssh oder in einem Container, und Mirador weckt ihn, wenn der Job endet.",
    },
    plugins: {
      title: "Plugins",
      body: "Offizielle Plugins bringen Tools auf den Canvas, etwa Media: Markiere, was in einem Videoframe nicht stimmt, und der Agent schneidet und rendert es.",
    },
    talk: { title: "Sprich mit ihm", body: "Diktiere deine Nachricht, hör das Wichtigste der Antwort und sprich weiter, ganz ohne Hände." },
  },
  install: {
    title: "Installieren",
    unix: "Auf einem Mac mit Apple Silicon oder unter Linux (x64 oder arm64) lädt dieser Befehl die App herunter, installiert und startet sie:",
    windows: "Unter Windows (x64, experimentell), in PowerShell:",
    brew: "Oder mit Homebrew, unter macOS und Linux:",
    notes:
      'Die macOS-App ist von Apple signiert und notarisiert. Die Windows-App ist noch nicht signiert, daher warnt SmartScreen, wenn du ihr Installationsprogramm von Hand startest. Linux braucht ein paar Systembibliotheken; die <a href="https://github.com/sodre90/mirador#get-it">README</a> listet sie auf, dazu die Installation von Hand und das Ausführen aus dem Quellcode. Oder lade die Dateien aus dem <a href="https://github.com/sodre90/mirador/releases/latest">neuesten Release</a> herunter. Danach aktualisiert sich die App selbst.',
  },
  faq: {
    title: "Fragen",
    cost: {
      question: "Was kostet es?",
      answer: "Nichts. Mirador ist Open Source unter der MIT-Lizenz, ohne Konto. Du nutzt den Tarif oder API-Schlüssel deines Agenten, wie bisher.",
    },
    agents: {
      question: "Mit welchen Coding-Agenten funktioniert es?",
      answer: "Heute mit Claude Code, opencode, pi und Codex (die letzten beiden experimentell), über das Agent Client Protocol (ACP). Weitere Agenten folgen.",
    },
    privacy: {
      question: "Verlässt mein Code meinen Computer?",
      answer:
        "Mirador läuft auf deinem Computer. Dein Agent spricht mit seinem Modellanbieter wie immer, und Mirador selbst fragt nur bei GitHub nach, ob es ein neueres Release gibt. Es gibt keine Telemetrie.",
    },
    terminal: {
      question: "Ersetzt es mein Terminal?",
      answer: "Nein. Es führt denselben Agenten mit deinen Einstellungen, Hooks und MCP-Servern aus und kann eine Sitzung fortsetzen, die du in einem Terminal begonnen hast.",
    },
    phones: { question: "Und auf dem Handy?", answer: "Apps für Android und iOS sind unterwegs." },
  },
  footer: { madeBy: "Mirador · MIT-Lizenz · Von Péter Erdős", releases: "Releases", trailer: "Trailer", privacy: "Datenschutz" },
  privacy: {
    title: "Datenschutzerklärung",
    updated: "Zuletzt aktualisiert am 1. November 2026",
    englishPrevails: 'Dies ist eine Übersetzung. Weicht sie von der <a href="../privacy.html">englischen Datenschutzerklärung</a> ab, gilt die englische.',
    intro:
      "Diese Erklärung gilt für Mirador, die App, die du auf deinem Computer ausführst, und Mirador für Android, die Handy-App, die sich mit ihr verbindet. Beide stammen von Péter Erdős. Kurz gesagt: Deine Daten bleiben auf deinen eigenen Geräten. Keine der beiden Apps hat Konten, Analysen, Werbung oder Absturzberichte. Über Server, die wir betreiben, laufen nur die optionalen Benachrichtigungs- und Peer-to-Peer-Dienste unten, und diese können nicht lesen, was du sendest.",
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
      "Das Handy speichert die Computer, mit denen es gekoppelt ist, deine Einstellungen und nicht gesendete Entwürfe in seinem eigenen Speicher, die Zugriffstokens der Computer im sicheren Speicher von Android. Fingerabdruck- oder Gesichtsentsperrung, wenn du die App-Sperre einschaltest, prüft Android; die App sieht sie nie.",
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
