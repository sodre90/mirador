import type { SiteWords } from "./en.ts";

export const hu: SiteWords = {
  attributes: {
    title: "Mirador: vászon a kódoló ágensednek",
    description:
      "A Mirador vásznat ad a kódoló ágensednek a beszélgetés mellé: lerajzolja, amit gondol, képekkel kérdez, és végigvezet a változtatásain és az átnézésein. Ingyenes és nyílt forráskódú, macOS-re, Linuxra és Windowsra.",
    ogDescription: "A kódoló ágensed lerajzolja, amit gondol, képekkel kérdez, és végigvezet a változtatásain és az átnézésein, közvetlenül a beszélgetés mellett.",
    sections: "Szakaszok",
    language: "Nyelv",
    copy: "Másolás",
    copied: "Kimásolva",
    trailer: "Előzetes",
    trailerAlt: "Az előzetes: vége a szövegfalaknak, az ágensed mostantól rajzol",
    trailerPlayer: "A Mirador előzetese",
    canvasAlt: "Beszélgetés egy fizetési folyamatról, mellette a vásznon az ágens szekvenciadiagramja",
    askAlt: "Az ágens megkérdezi, milyen elrendezésű beállításokat készítsen, minden lehetőségnél egy látványterv-előnézettel",
    tourAlt: "Az ágens bejárása a javításáról: balra a lépések, jobbra az src/checkout.ts megváltozott sora megjelölve",
    reviewAlt: "Egy kódátnézés a folyamat bejárásánál megnyitva: a lépések az aktuális lépés magyarázata mellett, alattuk a diff a lépés sorait megjelölve",
    changesAlt: "A Változások nézet: egy projekt nem commitolt fájljai, a sora alatt kinyitva az ágens szerkesztésével",
    terminalsAlt: "Két terminál egymás mellett a beszélgetés alatt",
    privacyTitle: "Adatvédelmi irányelvek · Mirador",
    privacyDescription: "Mit kezd a Mirador és az Androidos Mirador az adataiddal: a saját készülékeiden maradnak.",
  },
  nav: { features: "Funkciók", install: "Telepítés", faq: "GYIK" },
  hero: {
    eyebrow: "Ingyenes és nyílt forráskódú · macOS, Linux és Windows",
    title: 'Lásd, amit a kódoló ágensed <span class="gradient">mondani akar.</span>',
    lede: "A Mirador vásznat ad a kódoló ágensednek a beszélgetés mellé. Lerajzolja, amit gondol, képekkel kérdez, és végigvezet a változtatásain és az átnézésein, így egy pillantással megérted őket.",
    or: "vagy",
    windows: "Windows",
    download: "Letöltés",
    star: "Csillag a GitHubon",
  },
  trailerCaption: "Nézd meg az előzetest (2:33)",
  why: {
    title: "Már nem a kódírás a lassú rész, hanem az olvasása.",
    body: "Egy ágens pár perc alatt átolvas egy kódbázist, tíz fájlt módosít, majd hosszú szövegfolyamban magyarázza el, mit tett: egyetlen betűtípussal, olyan gyorsan, ahogy gépel. Az ember a képet sokkal gyorsabban érti meg, mint a szöveget: egy szekvenciadiagram egy pillantással megmutatja egy kérés útját, ugyanez prózában egy oldal. A Mirador nem egy újabb ágens: azokat futtatja, amelyeket már most is használsz, a saját beállításaiddal, és helyet ad nekik, ahol megmutathatják.",
  },
  show: {
    kicker: "Mutat",
    title: "Az ágensed lerajzolja, amit gondol.",
    body: "Diagramok, látványtervek, grafikonok, összehasonlítások, sőt 3D-s jelenetek a vásznon, a csevegés mellett, egy oldalnyi próza helyett. A Mermaid, a D3 és a three.js beépített, és offline is működik. Ha egy oldalon szkripthiba van, az ágens értesül róla, és kijavítja.",
  },
  ask: {
    kicker: "Kérdez",
    title: "A döntésekhez képek járnak.",
    body: "Számozott szöveges lista helyett az ágens a vásznon kérdez: legfeljebb nyolc lehetőséggel, mindegyikhez előnézettel. Kattints egyre, vagy írd be a saját válaszodat, és fűzz hozzá megjegyzést. Több kérdés egyszerre érkezik, mindegyik külön oldalon, és küldés előtt átnézheted őket.",
  },
  tour: {
    kicker: "Bejárás",
    title: "Séta a kódban, a futás sorrendjében.",
    body: "Hogyan működik valami, vagy mit változtatott épp az ágens: rövid összefoglaló és lépések a kódon át, mindegyik a saját soraival, a megváltozottakat megjelölve. Kérdezz bármelyik sorról, vagy nyisd meg IntelliJ IDEA-ban.",
  },
  review: {
    kicker: "Átnézés",
    title: "Kódátnézés, amelyen végigsétálhatsz.",
    body: "Ítélet és összefoglaló, a változtatás vezetett bejárása, minden diff, és a soraikhoz tűzött észrevételek, mindegyik megjelölve, hogy biztos vagy csak gyanítható. Tartsd meg, amivel egyetértesz, fogalmazd át, és küldd el a GitHub pull requestre függőben lévő átnézésként.",
  },
  more: {
    title: "És a nap többi része az ágenseddel",
    changes: {
      title: "Minden változás, a projekten kívül is",
      body: "Mit változtatott ez a kör vagy ez a beszélgetés, vagy az összes nem commitolt munka, minden fájl diffje egy kattintásra.",
    },
    terminals: { title: "Shell minden beszélgetés mellé", body: "Fülek és osztott nézetek, amelyek tovább futnak, amíg máshol jársz, és újraindítás után is visszajönnek." },
    approve: { title: "Hagyd jóvá a szerkesztéseket diffel", body: "A kért szerkesztés a fájl saját sorszámaival jelenik meg a vásznon, mielőtt engedélyezed." },
    needsYou: { title: "Lásd, ki vár rád", body: "Minden projekt egy oldalsávon, megjelölve a beszélgetéseket, amelyek rád várnak, készek vagy sikertelenek." },
    resume: { title: "Folytasd, ahol a terminál abbahagyta", body: "Folytass egy terminálban indított munkamenetet a teljes előzményével." },
    point: { title: "Mutass és kérdezz", body: "Mutass rá az ágens által rajzolt oldal bármely részére, és kérdezz róla, vagy kérd, hogy változtassa meg." },
    agents: {
      title: "Az ágenseid, együtt",
      body: "A valódi ágensek, a hookjaiddal és MCP-szervereiddel. Egyikük átadhat egy hosszú, könnyű feladatot egy másiknak, például egy helyi modellnek, és ellenőrzi, mit kap vissza.",
    },
    jobs: {
      title: "Kivárja a hosszú feladatokat",
      body: "Az ágens elindít egy buildet vagy egy tesztfuttatást, akár egy build szerveren ssh-n át vagy egy konténerben, és a Mirador felébreszti, amikor a feladat véget ér.",
    },
    plugins: {
      title: "Bővítmények",
      body: "A hivatalos bővítmények eszközöket adnak a vászonhoz, például a Media: jelöld meg, mi a hiba egy videó képkockáján, és az ágens kivágja és rendereli.",
    },
    talk: { title: "Beszélj hozzá", body: "Diktáld az üzenetedet, hallgasd meg a válasz lényegét, és beszélj tovább, kéz nélkül." },
  },
  install: {
    title: "Telepítés",
    unix: "Apple Silicon processzoros Macen vagy Linuxon (x64 vagy arm64) ez letölti, telepíti és elindítja az alkalmazást:",
    windows: "Windowson (x64, kísérleti) PowerShellben:",
    brew: "Vagy Homebrew-val, macOS-en és Linuxon:",
    notes:
      'A macOS-es alkalmazást az Apple aláírta és hitelesítette. A Windowsos alkalmazás még nincs aláírva, ezért a SmartScreen figyelmeztet, ha kézzel futtatod a telepítőjét. Linuxon kell néhány rendszerkönyvtár; ezeket a <a href="https://github.com/sodre90/mirador#get-it">README</a> sorolja fel, a kézi telepítéssel és a forrásból futtatással együtt. Vagy töltsd le a fájlokat a <a href="https://github.com/sodre90/mirador/releases/latest">legújabb kiadásból</a>. Ezután az alkalmazás magától frissül.',
  },
  faq: {
    title: "Kérdések",
    cost: {
      question: "Mennyibe kerül?",
      answer: "Semmibe. A Mirador nyílt forráskódú, MIT-licenccel, és fiókot sem kell létrehoznod. Az ágensed saját előfizetését vagy API-kulcsát használod, ahogy eddig is.",
    },
    agents: {
      question: "Mely kódoló ágensekkel működik?",
      answer: "Ma a Claude Code, az opencode, a pi és a Codex (az utóbbi kettő kísérleti) az Agent Client Protocolon (ACP) keresztül. Továbbiak is jönnek.",
    },
    privacy: {
      question: "Kikerül a kódom a számítógépemről?",
      answer:
        "A Mirador a számítógépeden fut. Az ágensed úgy beszél a modellszolgáltatójával, ahogy mindig, a Mirador pedig csak azt kérdezi meg a GitHubtól, hogy van-e újabb kiadás. Telemetria nincs.",
    },
    terminal: {
      question: "Leváltja a terminálomat?",
      answer: "Nem. Ugyanazt az ágenst futtatja a beállításaiddal, hookjaiddal és MCP-szervereiddel, és folytathat egy terminálban indított munkamenetet.",
    },
    phones: { question: "És a telefonok?", answer: "Androidos és iOS-es alkalmazások is jönnek." },
  },
  footer: { madeBy: "Mirador · MIT-licenc · Készítette: Erdős Péter", releases: "Kiadások", trailer: "Előzetes", privacy: "Adatvédelem" },
  privacy: {
    title: "Adatvédelmi irányelvek",
    updated: "Utolsó frissítés: 2026. november 1.",
    englishPrevails: 'Ez egy fordítás. Ha eltér az <a href="../privacy.html">angol nyelvű adatvédelmi irányelvektől</a>, az angol változat az irányadó.',
    intro:
      "Ezek az irányelvek a Miradorra, a számítógépeden futtatott alkalmazásra, és az Androidos Miradorra, a hozzá csatlakozó telefonos alkalmazásra vonatkoznak. Mindkettőt Erdős Péter készíti. Röviden: az adataid a saját készülékeiden maradnak. Egyik alkalmazásban sincs fiók, analitika, hirdetés vagy hibajelentés-küldés. Az általunk üzemeltetett szervereken csak az alább leírt, opcionális értesítési és peer-to-peer szolgáltatások forgalma halad át, és ezek nem tudják elolvasni, amit küldesz.",
    computerTitle: "A Mirador a számítógépeden",
    computer:
      "A Mirador a beszélgetéseidet, a beállításaidat és a meghívott készülékeidet egy adatbázisban tárolja a számítógépeden. A vele futtatott kódoló ágensek a saját modellszolgáltatóikkal kommunikálnak, azok feltételei szerint, ugyanúgy, mint Mirador nélkül. Maga a Mirador csak a GitHubot éri el: hogy megnézze, van-e újabb kiadás, és hogy letöltse az általa telepített bővítményeket.",
    androidTitle: "Androidos Mirador",
    android:
      "A telefonos alkalmazás csak azokhoz a Mirador-számítógépekhez csatlakozik, amelyekkel párosítod: közvetlenül, egy általad választott hálózaton, például Tailscale-en át, vagy peer-to-peer módon, ahogy alább leírjuk. Minden kapcsolat titkosított a telefon és a számítógéped között. Amit mutat, azoktól érkezik, és amit küldesz, hozzájuk kerül:",
    messages: "<strong>Az általad írt üzenetek és válaszok</strong> ahhoz a számítógéphez kerülnek, amelyen a beszélgetés fut.",
    photos: "<strong>A csatolt fényképek és képernyőképek</strong> – a kamerából, a galériádból vagy egy másik alkalmazás megosztásából – erre a számítógépre töltődnek fel.",
    camera: "<strong>A kamera</strong> beolvassa a QR-kódot, amely a telefont egy számítógéppel párosítja, és elkészíti a fényképeket, amelyeket csatolni szeretnél.",
    microphone:
      "<strong>A mikrofont</strong> az alkalmazás csak akkor használja, amíg diktáláshoz nyomva tartod a küldés gombot. Ha a telefonnak saját beszédfelismerése van, amit mondasz, a telefonon marad. Ha nincs, az Android hangalapú gépelési szolgáltatása alakítja szöveggé, és ez a szolgáltatás a saját adatvédelmi irányelvei szerint a szerverein is feldolgozhatja.",
    replies: "<strong>A felolvasott válaszok</strong> a számítógépeden készülnek, és a telefonon szólalnak meg.",
    phoneStorage:
      "A telefon a saját tárhelyén tárolja a párosított számítógépeket, a beállításaidat és az el nem küldött piszkozatokat, a számítógépek hozzáférési tokenjeit pedig az Android biztonságos tárolójában. Az ujjlenyomatos vagy arcfelismerős feloldást, ha bekapcsolod az alkalmazászárat, az Android ellenőrzi; az alkalmazás soha nem látja.",
    notificationsTitle: "Értesítések, amíg az alkalmazás be van zárva",
    notifications:
      "Ez ki van kapcsolva, hacsak be nem állítasz egy push-továbbítót a számítógépeden futó Miradorban. Ha be van kapcsolva, a telefon átadja a számítógépednek a Firebase Cloud Messagingtől, a Google push-szolgáltatásától kapott értesítési tokenjét, és a számítógéped megőrzi azt. Az értesítéshez a számítógéped a tokent és az értesítést – egy olyan kulccsal lezárva, amely csak a telefonodnál és a számítógépednél van meg – elküldi a push-továbbítónak, amely továbbadja őket a Google-nek kézbesítésre. A továbbító, akár a miénk, akár egy általad üzemeltetett, nem tárolja és nem naplózza a tokeneket és az értesítéseket. A továbbító és a Google látja a tokent és azt, hogy mikor ment ki egy értesítés, de azt nem tudja elolvasni, mi áll benne. A Google a tokent a saját adatvédelmi irányelvei szerint kezeli.",
    peerToPeerTitle: "Peer-to-peer",
    peerToPeer:
      "Ez ki van kapcsolva, hacsak a számítógépeden futó Mirador nincs beállítva a használatára. Ilyenkor a telefon és a számítógép egy közvetítőn keresztül találja meg egymást, amely látja a nyilvános kulcsaikat és a hálózati címeiket, amíg kapcsolódnak. Ha nem érik el egymást közvetlenül, a forgalmuk a közvetítőn halad át, úgy titkosítva, hogy az ne tudja elolvasni.",
    deletingTitle: "Az adataid törlése",
    deleting:
      "Az alkalmazás eltávolítása mindent töröl, amit tárolt. Ha nem szeretnéd, hogy egy telefon elérjen egy számítógépet, távolítsd el a Mirador <strong>Beállítások → Készülékek</strong> részében; ez a telefon értesítési tokenjét is törli arról a számítógépről.",
    sharingTitle: "Megosztás és értékesítés",
    sharing:
      "Nem adjuk el és senkivel nem osztjuk meg az adataidat, és semmi másra nem használjuk őket, csak az értesítések és a kapcsolatok kézbesítésére. A Google Play a Google saját adatvédelmi irányelvei szerint gyűjthet adatokat a telepítésekről és az alkalmazás összeomlásairól.",
    childrenTitle: "Gyermekek",
    children: "A Mirador szoftverfejlesztőknek készült eszköz, és nem gyermekeknek szól.",
    changesTitle: "Változások és kérdések",
    changes:
      'Az irányelvek változásait ezen az oldalon tesszük közzé, új dátummal. Kérdés esetén nyiss egy issue-t itt: <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a>.',
  },
};
