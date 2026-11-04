/**
 * The website's text in English, which every other language follows key by key.
 * Values may hold inline HTML, except those under `attributes`, which go into attributes and must be plain text.
 */
export const en = {
  attributes: {
    title: "Mirador: a canvas for your coding agent",
    description:
      "Mirador gives your coding agent a canvas beside the conversation: it draws what it means, asks you with pictures, and walks you through its changes and reviews. Free and open source, for macOS, Linux and Windows.",
    ogDescription: "Your coding agent draws what it means, asks you with pictures, and walks you through its changes and reviews, right beside the conversation.",
    sections: "Sections",
    language: "Language",
    copy: "Copy",
    copied: "Copied",
    trailer: "Trailer",
    trailerAlt: "The trailer: no more walls of text, your agent draws now",
    trailerPlayer: "Mirador trailer",
    canvasAlt: "A conversation about a checkout flow, with the agent's sequence diagram on the canvas beside it",
    askAlt: "The agent asks which settings layout to build, with a mockup preview for each option",
    tourAlt: "The agent's tour of its fix: the steps on the left, the changed line of src/checkout.ts marked on the right",
    reviewAlt: "A code review open on its flow tour: the steps beside the current step's explanation, and the diff below them with the step's lines marked",
    changesAlt: "The Changes view: the uncommitted files of a project, with the agent's edit open under its row",
    terminalsAlt: "Two terminals side by side under the conversation",
    privacyTitle: "Privacy policy · Mirador",
    privacyDescription: "What Mirador and Mirador for Android do with your data: it stays on your own devices.",
  },
  nav: { features: "Features", install: "Install", faq: "FAQ" },
  hero: {
    eyebrow: "Free and open source · macOS, Linux and Windows",
    title: 'See what your coding agent <span class="gradient">means.</span>',
    lede: "Mirador gives your coding agent a canvas beside the conversation. It draws what it means, asks you with pictures, and walks you through its changes and reviews, so you understand them at a glance.",
    or: "or",
    windows: "Windows",
    download: "Download",
    star: "Star on GitHub",
  },
  trailerCaption: "Watch the trailer (2:33)",
  why: {
    title: "Writing code is no longer the slow part. Reading it is.",
    body: "In a few minutes an agent reads a codebase, changes ten files and explains what it did in a long stream of text, all in one font, at the speed it types. People understand pictures far faster than text: a sequence diagram explains a request path at a glance, where the same in prose takes a page. Mirador isn't another agent: it runs the ones you already use, with your own settings, and gives them a place to show you.",
  },
  show: {
    kicker: "Show",
    title: "Your agent draws what it means.",
    body: "Diagrams, mockups, charts, comparisons, even 3D scenes, on a canvas next to the chat instead of a page of prose. Mermaid, D3 and three.js are built in and work offline. When a page has a script error, the agent hears about it and fixes it.",
  },
  ask: {
    kicker: "Ask",
    title: "Decisions come with pictures.",
    body: "Instead of a numbered list in text, the agent asks on the canvas: up to eight options, each with a preview. Click one, or type your own answer and add a note. Several questions come at once, a page each, with a review before you send.",
  },
  tour: {
    kicker: "Tour",
    title: "A walk through the code, in the order it runs.",
    body: "How something works, or what the agent just changed: a short summary and steps through the code, each with its lines, and the changed ones marked. Ask about any lines, or open them in IntelliJ IDEA.",
  },
  review: {
    kicker: "Review",
    title: "A code review you can walk through.",
    body: "The verdict and summary, a guided tour of the change, every diff, and findings pinned to their lines, each marked as confirmed or only suspected. Keep the findings you agree with, reword them, and post them to the GitHub pull request as your pending review.",
  },
  more: {
    title: "And the rest of your day with an agent",
    changes: {
      title: "Every change, even outside the project",
      body: "What this turn or this conversation changed, or all uncommitted work, with each file's diff a click away.",
    },
    terminals: { title: "A shell beside every conversation", body: "Tabs and splits that keep running while you switch, and come back after a restart." },
    approve: { title: "Approve each edit with its diff", body: "A requested edit shows on the canvas, with the file's own line numbers, before you allow it." },
    needsYou: { title: "See who needs you", body: "Every project in one sidebar, marking the conversations that wait for you, are done or failed." },
    resume: { title: "Pick up where the terminal left off", body: "Continue a session you started in a terminal, with its whole history." },
    point: { title: "Point and ask", body: "Point at any part of a page the agent drew, and ask about it or have it changed." },
    agents: {
      title: "Your agents, together",
      body: "The real agents with your hooks and MCP servers. One can hand a long, easy task to another, like a local model, and check what comes back.",
    },
    jobs: {
      title: "It waits for long jobs",
      body: "The agent leaves a build or a test run going, even on a build server over ssh or in a container, and Mirador wakes it when the job ends.",
    },
    plugins: {
      title: "Plugins",
      body: "Official plugins add tools to the canvas, like Media: mark what's wrong on a video's frame, and the agent cuts it and renders it.",
    },
    talk: { title: "Talk to it", body: "Dictate your message, hear the gist of the reply, and keep talking, hands free." },
  },
  install: {
    title: "Install",
    unix: "On a Mac with Apple Silicon, or on Linux (x64 or arm64), this downloads the app, installs it and starts it:",
    windows: "On Windows (x64, experimental), in PowerShell:",
    brew: "Or with Homebrew, on macOS and Linux:",
    notes:
      'The macOS app is signed and notarized by Apple. The Windows app isn\'t signed yet, so SmartScreen warns when you run its installer by hand. Linux needs a few system libraries, and the <a href="https://github.com/sodre90/mirador#get-it">README</a> lists them, along with installing by hand and running from source. Or download the files from the <a href="https://github.com/sodre90/mirador/releases/latest">latest release</a>. After that, the app updates itself.',
  },
  faq: {
    title: "Questions",
    cost: {
      question: "What does it cost?",
      answer: "Nothing. Mirador is open source under the MIT license, with no account to create. You use your agent's own plan or API key, as you do now.",
    },
    agents: {
      question: "Which coding agents does it work with?",
      answer: "Claude Code, opencode, pi, Codex, Copilot and Antigravity (the last four experimental) today, through the Agent Client Protocol (ACP). More agents are coming.",
    },
    privacy: {
      question: "Does my code leave my computer?",
      answer:
        "Mirador runs on your computer. Your agent talks to its model provider as it always does, and Mirador itself only asks GitHub whether a newer release is out. There is no telemetry.",
    },
    terminal: {
      question: "Does it replace my terminal?",
      answer: "No. It runs the same agent with your settings, hooks and MCP servers, and it can continue a session you started in a terminal.",
    },
    phones: { question: "What about phones?", answer: "Android and iOS apps are coming." },
  },
  footer: { madeBy: "Mirador · MIT license · Made by Péter Erdős", releases: "Releases", trailer: "Trailer", privacy: "Privacy" },
  privacy: {
    title: "Privacy policy",
    updated: "Last updated 1 November 2026",
    englishPrevails: 'This is a translation. If it differs from the <a href="../privacy.html">English privacy policy</a>, the English one applies.',
    intro:
      "This policy covers Mirador, the app you run on your computer, and Mirador for Android, the phone app that connects to it. Both are made by Péter Erdős. In short: your data stays on your own devices. Neither app has accounts, analytics, advertising or crash reporting. The only things that pass through servers we run are the optional notification and peer-to-peer services below, and they can't read what you send.",
    computerTitle: "Mirador on your computer",
    computer:
      "Mirador keeps your conversations, settings and the devices you invited in a database on your computer. The coding agents you run with it talk to their own model providers, under those providers' terms, as they do without Mirador. Mirador itself only reaches GitHub, to see whether a newer release is out and to download the plugins it installs.",
    androidTitle: "Mirador for Android",
    android:
      "The phone app connects only to the Mirador computers you pair it with, directly, through a network you choose, such as Tailscale, or peer to peer as described below. Every connection is encrypted between the phone and your computer. What it shows comes from them, and what you send goes to them:",
    messages: "<strong>Messages and answers</strong> you write go to the computer the conversation runs on.",
    photos: "<strong>Photos and screenshots</strong> you attach, from the camera, your gallery or another app's share, are uploaded to that computer.",
    camera: "<strong>The camera</strong> scans the QR code that pairs the phone with a computer, and takes photos you choose to attach.",
    microphone:
      "<strong>The microphone</strong> is used only while you hold the send button to dictate. Where the phone has its own speech recognition, what you say stays on the phone. Otherwise Android's voice typing service turns it into text, and that service may process it on its servers under its own privacy policy.",
    replies: "<strong>Replies read aloud</strong> are made on your computer and played on the phone.",
    phoneStorage:
      "The phone keeps the computers it is paired with, your settings and unsent drafts in its own storage, with the computers' access tokens in Android's secure storage. Fingerprint or face unlock, when you turn the app lock on, is checked by Android; the app never sees it.",
    notificationsTitle: "Notifications while the app is closed",
    notifications:
      "This is off unless you set a push relay in Mirador on your computer. When it is on, the phone gives your computer its notification token from Firebase Cloud Messaging, Google's push service, and your computer keeps it. To notify you, your computer sends the token and the notification, sealed with a key only your phone and your computer hold, to the push relay, which passes them on to Google to deliver. The relay, ours or one you run yourself, doesn't store or log tokens or notifications. The relay and Google see the token and when a notification was sent, but can't read what it says. Google handles the token under its own privacy policy.",
    peerToPeerTitle: "Peer to peer",
    peerToPeer:
      "This is off unless Mirador on your computer is set up to use it. Then the phone and the computer find each other through a broker, which sees their public keys and network addresses while they are connected. When they can't reach each other directly, their traffic passes through the broker, encrypted so that it can't read it.",
    deletingTitle: "Deleting your data",
    deleting:
      "Uninstalling the app deletes everything it stored. To stop a phone reaching a computer, remove it in Mirador's <strong>Settings → Devices</strong>; that also deletes the phone's notification token from that computer.",
    sharingTitle: "Sharing and selling",
    sharing:
      "We don't sell your data or share it with anyone, and we don't use it for anything but delivering notifications and connections. Google Play may collect data about installs and app crashes under Google's own privacy policy.",
    childrenTitle: "Children",
    children: "Mirador is a tool for software developers and isn't meant for children.",
    changesTitle: "Changes and questions",
    changes:
      'Changes to this policy are published on this page with a new date. For questions, open an issue at <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a>.',
  },
};

export type SiteWords = typeof en;
