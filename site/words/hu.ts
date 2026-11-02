import type { SiteWords } from "./en.ts";

export const hu: SiteWords = {
  attributes: {
    title: "Mirador: vászon a coding agented mellé",
    description:
      "A Mirador egy vásznat ad a coding agented mellé: rajzban mutatja meg, mire gondol, képekkel kérdez, és végigvezet a változtatásokon. Ingyenes, nyílt forráskódú, macOS-re, Linuxra és Windowsra.",
    ogDescription: "A coding agented rajzban mutatja meg, mire gondol, képekkel kérdez, és végigvezet a változtatásokon, közvetlenül a chat mellett.",
    sections: "Szakaszok",
    language: "Nyelv",
    copy: "Másolás",
    copied: "Kimásolva",
    trailer: "Előzetes",
    trailerAlt: "Az előzetes: elég a szövegfalakból, az agented mostantól rajzol",
    trailerPlayer: "A Mirador előzetese",
    canvasAlt: "Chat egy checkout folyamatról, mellette a vásznon az agent szekvenciadiagramja",
    askAlt: "Az agent megkérdezi, melyik beállításoldal-elrendezést építse meg, mindegyik opcióhoz egy mockuppal",
    tourAlt: "Az agent végigvezet a javításán: balra a lépések, jobbra az src/checkout.ts megváltozott sora kiemelve",
    reviewAlt: "Egy code review végigvezetés nézetben: a lépések az aktuális lépés magyarázata mellett, alattuk a diff, a lépés sorai kiemelve",
    changesAlt: "A Changes nézet: egy projekt nem commitolt fájljai, az agent módosítása a sora alatt kinyitva",
    terminalsAlt: "Két terminál egymás mellett a beszélgetés alatt",
    privacyTitle: "Adatvédelmi irányelvek · Mirador",
    privacyDescription: "Mit kezd a Mirador és az androidos Mirador az adataiddal: a saját készülékeiden maradnak.",
  },
  nav: { features: "Funkciók", install: "Telepítés", faq: "GYIK" },
  hero: {
    eyebrow: "Ingyenes és nyílt forráskódú · macOS, Linux és Windows",
    title: 'Lásd, <span class="gradient">mire gondol az agent.</span>',
    lede: "A Mirador egy vásznat ad a coding agented mellé. Rajzban mutatja meg, mire gondol, képekkel kérdez, és végigvezet a változtatásokon, így egy pillanat alatt átlátod őket.",
    or: "vagy",
    windows: "Windows",
    download: "Letöltés",
    star: "Csillagozd meg a GitHubon",
  },
  trailerCaption: "Nézd meg az előzetest (2:33)",
  why: {
    title: "Ma már nem a kódírás a lassú, hanem a kódolvasás.",
    body: "Egy agent pár perc alatt átnéz egy kódbázist, átír tíz fájlt, aztán egy hosszú szövegfolyamban elmagyarázza, mit csinált: egyetlen betűtípussal, abban a tempóban, ahogy gépel. A képet sokkal gyorsabban értjük meg, mint a szöveget: egy szekvenciadiagramról első ránézésre látszik egy kérés útja, ami szövegben egy teljes oldal. A Mirador nem egy újabb agent: azokat futtatja, amelyeket most is használsz, a saját beállításaiddal, és ad nekik egy helyet, ahol meg is mutathatják neked.",
  },
  show: {
    kicker: "Rajzol",
    title: "Az agented lerajzolja, mire gondol.",
    body: "Diagramok, mockupok, grafikonok, összehasonlítások, akár 3D-s jelenetek egy vásznon a chat mellett, egy oldalnyi szöveg helyett. A Mermaid, a D3 és a three.js beépített, és offline is megy. Ha egy oldal szkriptje hibára fut, az agent értesül róla, és kijavítja.",
  },
  ask: {
    kicker: "Kérdez",
    title: "Döntések képekkel.",
    body: "Számozott lista helyett az agent a vásznon kérdez: legfeljebb nyolc opció, mindegyik előnézettel. Kattints egyre, vagy írd meg a saját válaszodat, és fűzz hozzá megjegyzést. Ha több kérdése van, egyszerre jönnek, mindegyik külön oldalon, és küldés előtt még egyszer átnézheted őket.",
  },
  tour: {
    kicker: "Végigvezet",
    title: "Végigvezet a kódon, abban a sorrendben, ahogy fut.",
    body: "Hogyan működik valami, vagy mit változtatott épp az agent: egy rövid összefoglaló, aztán lépésről lépésre a kód, mindegyik lépés a saját soraival, a változásokat kiemelve. Bármelyik sorról kérdezhetsz, vagy megnyithatod IntelliJ IDEA-ban.",
  },
  review: {
    kicker: "Átnéz",
    title: "Code review, amin végig tudsz menni.",
    body: "Verdikt és összefoglaló, végigvezetés a változáson, minden diff, és a sorokhoz tűzött észrevételek, mindegyiknél jelölve, hogy biztos vagy csak gyanús. Tartsd meg, amivel egyetértesz, fogalmazd át, és küldd el pending review-ként a GitHub pull requestre.",
  },
  more: {
    title: "És minden más, ami egy agenttel töltött naphoz kell",
    changes: {
      title: "Minden változás, a projekten kívül is",
      body: "Mit változtatott ez a kör vagy ez a beszélgetés, vagy az összes nem commitolt munka, minden fájl diffje egy kattintásra.",
    },
    terminals: { title: "Shell minden beszélgetés mellett", body: "Fülek és split nézetek, amelyek tovább futnak, amíg máshol vagy, és újraindítás után is megmaradnak." },
    approve: { title: "Minden módosítást a diffjével hagysz jóvá", body: "A kért módosítás a fájl saját sorszámaival jelenik meg a vásznon, mielőtt engedélyezed." },
    needsYou: { title: "Látod, hol van rád szükség", body: "Minden projekt egy oldalsávban, és látszik, melyik beszélgetés vár rád, melyik kész, és melyik hasalt el." },
    resume: { title: "Ott folytatod, ahol a terminálban abbahagytad", body: "Egy terminálban indított munkamenetet is folytathatsz, a teljes előzményeivel." },
    point: { title: "Mutass rá és kérdezz", body: "Mutass rá bármire egy oldalon, amit az agent rajzolt, és kérdezz róla, vagy kérd meg, hogy változtassa meg." },
    agents: {
      title: "Az összes agented, együtt",
      body: "Az igazi agentek, a hookjaiddal és MCP-szervereiddel. Az egyik átpasszolhat egy hosszú, egyszerű feladatot egy másiknak, például egy lokális modellnek, és ellenőrzi, mit kap vissza.",
    },
    jobs: {
      title: "Megvárja a hosszú buildeket",
      body: "Az agent elindít egy buildet vagy egy tesztfuttatást, akár egy buildszerveren ssh-n át vagy egy konténerben, és a Mirador felébreszti, amikor végzett.",
    },
    plugins: {
      title: "Bővítmények",
      body: "A hivatalos bővítmények új eszközöket adnak a vászonhoz, például a Media: jelöld meg egy videó képkockáján, mi a gond, és az agent kivágja és rendereli.",
    },
    talk: { title: "Beszélj hozzá", body: "Diktáld be az üzenetet, hallgasd meg a válasz lényegét, és beszélj tovább, kéz nélkül." },
  },
  install: {
    title: "Telepítés",
    unix: "Apple Silicon-os Macen vagy Linuxon (x64 vagy arm64) ez letölti, telepíti és elindítja az alkalmazást:",
    windows: "Windowson (x64, kísérleti) PowerShellben:",
    brew: "Vagy Homebrew-val, macOS-en és Linuxon:",
    notes:
      'A macOS-es alkalmazást az Apple aláírta és hitelesítette. A windowsos alkalmazás még nincs aláírva, ezért a SmartScreen figyelmeztet, ha kézzel futtatod a telepítőjét. Linuxon kell néhány rendszerkönyvtár; ezeket a <a href="https://github.com/sodre90/mirador#get-it">README</a> sorolja fel, a kézi telepítéssel és a forrásból futtatással együtt. Vagy töltsd le a fájlokat a <a href="https://github.com/sodre90/mirador/releases/latest">legújabb kiadásból</a>. Ezután az alkalmazás magától frissül.',
  },
  faq: {
    title: "Kérdések",
    cost: {
      question: "Mennyibe kerül?",
      answer: "Semmibe. A Mirador nyílt forráskódú (MIT-licenc), és regisztrálni sem kell. Az agented saját előfizetését vagy API-kulcsát használod, mint eddig.",
    },
    agents: {
      question: "Milyen coding agentekkel működik?",
      answer: "Jelenleg a Claude Code-dal, az opencode-dal, a pi-vel és a Codexszel (az utóbbi kettő kísérleti), az Agent Client Protocolon (ACP) keresztül. Továbbiak is jönnek.",
    },
    privacy: {
      question: "Elhagyja a kódom a gépemet?",
      answer:
        "A Mirador a gépeden fut. Az agented ugyanúgy a saját modellszolgáltatójával beszél, mint eddig, maga a Mirador pedig csak a GitHubtól kérdezi meg, van-e újabb kiadás. Telemetria nincs.",
    },
    terminal: {
      question: "Kiváltja a terminált?",
      answer: "Nem. Ugyanazt az agentet futtatja a beállításaiddal, hookjaiddal és MCP-szervereiddel, és egy terminálban indított munkamenetet is tud folytatni.",
    },
    phones: { question: "És telefonon?", answer: "Androidos és iOS-es app is készül." },
  },
  footer: { madeBy: "Mirador · MIT-licenc · Készítette: Erdős Péter", releases: "Kiadások", trailer: "Előzetes", privacy: "Adatvédelem" },
  privacy: {
    title: "Adatvédelmi irányelvek",
    updated: "Utolsó frissítés: 2026. november 1.",
    englishPrevails: 'Ez egy fordítás. Ha eltér az <a href="../privacy.html">angol nyelvű adatvédelmi irányelvektől</a>, az angol változat az irányadó.',
    intro:
      "Ezek az irányelvek a Miradorra, a számítógépeden futtatott alkalmazásra, és az androidos Miradorra, a hozzá csatlakozó telefonos alkalmazásra vonatkoznak. Mindkettőt Erdős Péter készíti. Röviden: az adataid a saját készülékeiden maradnak. Egyik alkalmazásban sincs fiók, analitika, hirdetés vagy hibajelentés-küldés. Az általunk üzemeltetett szervereken csak az alább leírt, opcionális értesítési és peer-to-peer szolgáltatások forgalma halad át, és ezek nem tudják elolvasni, amit küldesz.",
    computerTitle: "A Mirador a számítógépeden",
    computer:
      "A Mirador a beszélgetéseidet, a beállításaidat és a meghívott készülékeidet egy adatbázisban tárolja a számítógépeden. A vele futtatott coding agentek a saját modellszolgáltatóikkal kommunikálnak, azok feltételei szerint, ugyanúgy, mint Mirador nélkül. Maga a Mirador csak a GitHubot éri el: hogy megnézze, van-e újabb kiadás, és hogy letöltse az általa telepített bővítményeket.",
    androidTitle: "Androidos Mirador",
    android:
      "A telefonos alkalmazás csak azokhoz a Mirador-számítógépekhez csatlakozik, amelyekkel párosítod: közvetlenül, egy általad választott hálózaton, például Tailscale-en át, vagy peer-to-peer módon, ahogy alább leírjuk. Minden kapcsolat titkosított a telefon és a számítógéped között. Amit mutat, azoktól érkezik, és amit küldesz, hozzájuk kerül:",
    messages: "<strong>Az általad írt üzenetek és válaszok</strong> ahhoz a számítógéphez kerülnek, amelyen a beszélgetés fut.",
    photos: "<strong>A csatolt fényképek és képernyőképek</strong> – a kamerából, a galériádból vagy egy másik alkalmazás megosztásából – arra a számítógépre töltődnek fel.",
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
      "Nem adjuk el és senkivel nem osztjuk meg az adataidat, és semmi másra nem használjuk őket, csak az értesítések kézbesítésére és a kapcsolatok létrehozására. A Google Play a Google saját adatvédelmi irányelvei szerint gyűjthet adatokat a telepítésekről és az alkalmazás összeomlásairól.",
    childrenTitle: "Gyermekek",
    children: "A Mirador szoftverfejlesztőknek készült eszköz, és nem gyermekeknek szól.",
    changesTitle: "Változások és kérdések",
    changes:
      'Az irányelvek változásait ezen az oldalon tesszük közzé, új dátummal. Kérdés esetén nyiss egy issue-t itt: <a href="https://github.com/sodre90/mirador/issues">github.com/sodre90/mirador/issues</a>.',
  },
};
