import type { Messages } from "../en/index.ts";

export const hints: Messages["hints"] = {
  voiceRecognition:
    "Ami a beszédedet szöveggé alakítja. Saját szerver bármi lehet, ami az OpenAI beszédfelismerő API-ját beszéli (POST /audio/transcriptions): maga az OpenAI, vagy egy Whisper-szerver ezen vagy egy másik gépen. A Mirador 16 kHz-es WAV-ot küld neki.",
  voiceModel:
    "A nyelvi modell, amely angolra fordítja, amit mondasz, mielőtt az üzenetmezőbe kerül, és összefoglalja a felolvasandó válaszokat. Egy saját szerver az OpenAI chat API-ját beszéli (POST /chat/completions); egy profil API-ja az, amelyet a környezete megnevez: ANTHROPIC_BASE_URL az ANTHROPIC_API_KEY-jel vagy ANTHROPIC_AUTH_TOKEN-nel, illetve OPENAI_BASE_URL az OPENAI_API_KEY-jel. A Mirador közvetlenül hívja, a profil ágensének elindítása nélkül.",
  voiceModelThinkingOff:
    "Olyan helyi szerverhez, amelyen gondolkodó modell fut, például Gemma 4 vagy Qwen 3: a gondolkodástól a fordítás sokkal tovább tart, és el is fogyaszthatja a választ. A Mirador chat_template_kwargs-ot küld enable_thinking false értékkel, amelyet például az mlx_lm, a vLLM és a llama.cpp is megért. Az OpenAI API-jánál hagyd kikapcsolva.",
  voiceEngineVoiceModel:
    "A hangmodell angolra fordítja, amit mondasz, később pedig összefoglalja a felolvasandó válaszokat. A nagyobbak jobban fordítanak, de több memória kell nekik: a Mirador azokat kínálja, amelyek betöltve legfeljebb a Mac memóriájának felét foglalják. Ha nincs ilyen, amit mondasz, azon a nyelven kerül az üzenetmezőbe, amelyen mondtad, hacsak lent nincs másik hangmodell beállítva.",
  thisMacModel:
    "A Mirador modelljei ehhez a szolgáltatáshoz. A legjobb, jó és elfogadható azt jelzi, hogyan teljesítettek a Mirador összehasonlításában egy Macen; amelyik még nincs ezen a Macen, az a mellette lévő gombbal letölthető. A Mirador azokat kínálja, amelyek betöltve legfeljebb a Mac memóriájának felét foglalják.",
  voiceEngineIdle:
    "Egy betöltött modell memóriát foglal, egy hangmodell akár 15 GB-ot is, ezért mindegyik kirakódik, ha ennyi ideig nem használják. Az újbóli betöltés miatt a következő diktálás várni fog.",
  voiceEngineLoaded: (minutes) => `Betöltve, így azonnal válaszol. Ha ${minutes} percig nem használod, kirakódik; ezt a Modellek ezen a Macen részben állíthatod.`,
  voiceEngineUnloaded: "Most nem foglal memóriát. Akkor töltődik be, amikor legközelebb szükség van rá, általában 5–15 másodperc alatt.",
  voiceEngineDownloadWaits: "Egy másik letöltés folyik. Ez akkor indulhat, ha az véget ért.",
  voiceEngineRemoveWaits: "Egy letöltés folyik. Az eltávolítás akkor indulhat, ha az véget ért.",
  spokenVoiceKept: "A Kokoro a „Hang ezen a Macen” részeként érkezik az angol válaszokhoz, és csak az Összes eltávolítása viszi el.",
  removeVoiceEngineArmed: "Kattints újra, hogy töröld a beszédmotort és a modelljeit erről a Macről. Újbóli beállításkor újra letöltődnek.",
  removeVoiceEngineModelArmed: "Kattints újra, hogy töröld ezt a modellt erről a Macről. Ha újra kiválasztod, újra letöltődik.",
  voiceModelProfile: "A Mirador ennek a profilnak az API-ját hívja a kulcsaival. Az ágense nem indul el.",
  voiceAddress: "Az API címe a verziójáig bezárólag, például https://api.openai.com/v1. A Mirador hozzáteszi minden hívás útvonalát.",
  voiceLanguage:
    "A nyelv, amelyen beszélsz. Ha megadod, rövid felvételeknél segít, ahol a nyelvek pusztán hangzás alapján gyakran összekeverednek; a Mac saját motorja az angolt ettől még angolnak hallja. Bármely nyelvnél a beszédszerver dönt, és a hangmodell lefordít mindent, ami nem angol.",
  translateToEnglish: "Amit mondasz, angolul kerül az üzenetmezőbe, alatta azzal, amit mondtál, így küldés előtt ellenőrizheted.",
  translateNeedsVoiceModel: "A fordításhoz hangmodell kell. Válassz egyet lent.",
  replyVoice:
    "Ami felolvassa a válaszokat, miután a hangmodell mindegyiket néhány mondatban összefoglalta. A Mac saját motorja angolul a Kokoróval beszél, magyarul az OmniVoice-szal, amely külön letöltés, és a licence csak nem kereskedelmi használatot enged. Egy saját szerver az OpenAI szövegfelolvasó API-ját beszéli (POST /audio/speech) valamelyik hangjával. Egy diktált üzenet után a választ a kör végén olvassa fel, abban a böngészőben, amelyben diktáltál.",
  replyLanguage: "A nyelv, amelyen a válaszokat felolvassa. A hangmodell ezen a nyelven foglalja össze őket, bármilyen nyelven írt is az ágens.",
  replyVoiceName: "A szerver egyik hangja, ahogy az alloy az OpenAI egyik hangja.",
  readAloud: "Felolvassa ennek a válasznak egy rövid összefoglalóját.",
  stopReadingAloud: "Leállítja ennek a válasznak a felolvasását.",
  copyReply: "Formázott szövegként másolja ennek a körnek a válaszát, a futtatott eszközök nélkül.",
  copyReplyAsMarkdown: "Markdownként másolja ennek a körnek a válaszát, a futtatott eszközök nélkül.",
  keepTalking:
    "Miután a diktált üzenetedre adott választ felolvasta, a mikrofon újra megnyílik, és amit ezután mondasz, azonnal elküldi. A „stop” vagy „thanks” szó, illetve az Esc befejezi. Ha az ágens közben kérdez, azt felolvassa, hogy hanggal válaszolhass; mondd, hogy „help”, és meghallod, mit mondhatsz.",
  sendRightAway: "Azonnal elküldi, amit mondtál, amint szöveggé vált, ahelyett hogy az üzenetmezőben hagyná, hogy előbb ellenőrizhesd.",
  dictate: "Beszélj gépelés helyett. Koppints az indításhoz; megáll, ha szünetet tartasz vagy újra koppintasz; vagy tartsd lenyomva, amíg beszélsz. Amit mondtál, a kurzor helyére kerül.",
  dictateOff: "A diktáláshoz beszédfelismerés kell. A Beállítások → Hang részben kapcsolhatod be.",
  yolo:
    "Mindent jóváhagy kérdezés nélkül.\n\nAmikor az ágens engedélyt kér egy eszköz futtatására, a host azonnal az ágens saját „allow” lehetőségével válaszol, ahelyett hogy kártyát mutatna neked. Bekapcsoláskor a már várakozó kérést is jóváhagyja. Azok a kérések, amelyekben nincs engedélyező lehetőség, továbbra is megkérdeznek.\n\nEz független az ágens Módjától: azok az eszközök, amelyeket a Mód már enged, sosem kérdeznek. Beszélgetésenként mentődik.",
  conversationSettings:
    "A beszélgetés profilja, ágense, modellje és többi beállítása.\n\nA profil csak a kezdőértékeiket adja meg: ha itt változtatod őket, a profil nem változik.",
  yoloOn: "A YOLO be van kapcsolva: az ágens eszközhívásait kérdezés nélkül jóváhagyja. A beszélgetés beállításaiban kapcsolhatod ki.",
  profile:
    "A profil (környezeti változók és indítás előtti parancs), amellyel az ágens fut.\n\nMinden profil saját ágensfolyamatot futtat. Váltáskor ez a munkamenet bezárul a jelenlegi folyamaton, és az újon folytatódik, így az ágens megtartja az egész beszélgetést. A modell visszaáll az új profil alapértelmezettjére.\n\nHa váltasz, miközben az ágens dolgozik, leáll a köre, a munkamenet átkerül, és az ágens ott folytatja, ahol abbahagyta; a sorba állított üzeneteid ezután mennek ki.\n\nMás ágens profiljai csak az első üzenet előtt választhatók: az az ágens új munkamenetet kezd. Ha a beszélgetés már elkezdődött, indíts új beszélgetést a használatukhoz.",
  questions:
    "Mi történik, ha az ágens a vásznon kérdez tőled valamit.\n\nAz ágens vár: az ágens ask hívása nyitva marad, amíg meg nem nyomod a Küldés gombot, és a válaszod a kör közben, a hívás eredményeként érkezik vissza.\n\nKövetkező üzenet: az ask hívás azonnal visszatér, az ágens befejezi a körét, a válaszodat pedig később, a következő üzenetedként küldi el. Jó olyan kérdésekhez, amelyeken gondolkodni szeretnél.",
  pluginTextSetting: "Írd be: $NÉV, és a profil környezetének azt a változóját használja, pl. $LLM_GATEWAY_KEY.",
  conversationPluginSetting: "Csak erre a beszélgetésre. A Profil szerint azt követi, amit a profilja a Profilokban beállít; profilváltáskor visszaáll arra.",
  configOption:
    "Ezt a beállítást az ágens kínálja a munkamenethez. Ha módosítod, az új értéket elküldi az ágensnek (ACP session/set_config_option), amely erre a beszélgetésre alkalmazza.",
  dismissNewerVersion: "Elrejti, amíg nem jelenik meg még újabb. A Beállítások › Névjegy továbbra is mutatja.",
  pullToUpdate: "Lehúzza az új commitokat ebbe a checkoutba, csak fast-forward módon, így a saját commitjaid és a nem commitolt munkád változatlan marad. Indítsd újra a hostot a futtatásukhoz.",
  restartHost:
    "Helyben újraindítja a hostot, így a kódját a mostani állapotában futtatja. A dolgozó ágensek leállnak, majd ott folytatják, ahol abbahagyták; a sorba állított üzenetek megmaradnak. A terminálok új shellként térnek vissza a korábbi kimenetük alatt. A megnyitott oldalak maguktól újratöltődnek.",
  stop: "Megkéri az ágenst, hogy állítsa le a körét, ahogy az Esc is. Ha néhány másodpercen belül nem áll le, ebből Kényszerített leállítás lesz, amely inkább az ágensfolyamatot állítja le; az ugyanazon a profilon futó többi beszélgetés ott folytatja, ahol abbahagyta.",
  promptTemplates: "Gyakran küldött üzenetek, azokkal az értékekkel, amelyeket minden alkalommal kitöltesz. A Beállításokban adhatsz hozzá, módosíthatod és törölheted őket.",
  deleteTemplateArmed: "Kattints újra a sablon törléséhez. Az itt törölt alapértelmezett sablonok nem jönnek vissza.",
  findAddress:
    "Megkérdezi, milyen címen érik el más készülékek a Miradort: ennek a gépnek a nevét a tailnetjén, és azokat a címeket, amelyeket készülékek már használtak. Mindegyiket ellenőrzi, mielőtt felajánlja — ennek a Miradornak kell válaszolnia, a saját portján és a vászonkönyvtárak portján is. A host a következő indulásától a kiválasztott címet használja.",
  exposeOnTailscale:
    "Lefuttatja a tailscale serve-öt a Mirador két portjára, tükrözve, így a tailnet HTTPS-en éri el a Miradort a https://<ez a gép a tailneten>:<a portja> címen, a vászonkönyvtárakat pedig ugyanezen a néven a vászon portján. A tailneten semmi más nem változik; a host a következő indulásától használja a címeket.",
  address:
    "Ahol más készülékek megnyitják a Miradort: http://127.0.0.1:4600 csak ezen a gépen, vagy egy cím, amelyet egy proxy ide továbbít, például https://macbook.example.ts.net:4600. A port a Mirador saját portja, 4600, hacsak a host nem mással indult.",
  canvasAddress:
    "Ahonnan egy vászonoldal betölti a D3-at, a Mermaidot és a three-t. A Mirador saját porton szolgálja ki őket (4601), az alkalmazásétól eltérő originen, így egy ágens által írt oldal nem fér hozzá a Mirador saját tárolójához. Egy proxynak ezt a portot is továbbítania kell: https://macbook.example.ts.net:4601.",
  reachRoute:
    "A Mirador egyszerre csak egyféleképpen éri el a többi készüléket. A kiválasztás önmagában csak megmutatja a lehetőséget; a Használat vagy a Cím mentése gomb alkalmazza, és visszavonja a másikat, így itt nem marad olyan beállítás, amelyet a host nem használ. A host a következő indulásakor olvassa be. Egy elérhető címet egy proxynak kell adnia, például a tailscale serve-nek, különben a host maga szolgál ki HTTPS-t a hálózaton egy általa készített tanúsítvánnyal.",
  proxyElsewhere:
    "Egy másik gépen futó proxyhoz a hálózatodon, például Nginx Proxy Managerhez, amely nem éri el ennek a gépnek a saját portjait. A cím mentésekor a Mirador ilyenkor HTTPS-t is kiszolgál a hálózaton, és a proxy ezekre a portokra továbbít.",
  networkReachability:
    "A Mirador maga szolgál ki HTTPS-t ezen a porton, egy általa készített tanúsítványkiadóval, így az ugyanazon a hálózaton lévő készülékeknek nem kell sem proxy, sem cím. Minden böngésző egyszer figyelmeztet a tanúsítványra (vagy végleg megbízik benne, ha telepíti a mirador-ca.pem-et).",
  useThisNetwork:
    "Az ugyanazon a hálózaton lévő eszközök HTTPS-en érik el ezt a Miradort, ahogy a lenti választás is. A host a következő indulásától használja.",
  inviteDevice:
    "Egyszer használható kódot készít, amellyel egy másik böngésző vagy alkalmazás 15 percen belül csatlakozhat ehhez a Miradorhoz. Egy csatlakozott készülék itt mindent megtehet, terminálokban parancsokat is futtathat.",
  inviteRoute:
    "Az egyenrangú (peer to peer) kapcsolat bárhonnan eléri ezt a Macet VPN nélkül, egy telefonon futó Mirador alkalmazáson keresztül; böngésző csak a címen csatlakozhat. A QR-kód és a link a választással együtt változik.",
  removeMachineArmed: "Kattints újra, hogy eltávolítsd ezt a gépet a listáról. Tovább fut, és ez a számítógép a készülékei között marad, amíg ott vissza nem vonod.",
  thisComputer: "Ennek a számítógépnek a saját munkaterületei és beszélgetései",
  manageMachines: "Gépek hozzáadása vagy eltávolítása",
  machineColor: "Adj színt ennek a gépnek, hogy megkülönböztesd a sávban. Ez a számítógép jegyzi meg.",
  machineColorStyle:
    "Hol mutatja a színét egy gép, amelynek színt adtál: csak a sávgombján, vagy egy csíkként a nézete tetején is, így egy pillantásból látod, melyik gépen dolgozol. Színt a Gépek… menüpontban adhatsz egy gépnek.",
  machines: "Más számítógépek, amelyeken Mirador fut, például egy szerver, amelynek az ágensei tovább dolgoznak, amíg ez a gép alszik.",
  plugins: "A bővítmények saját eszközöket adnak az ágensnek a vásznon, vagy alkalmazást hoznak, például videó- vagy Google Docs-szerkesztőt. Itt telepítheted, frissítheted és állíthatod be őket.",
  revokeDeviceArmed: "Kattints újra, hogy kijelentkeztesd ezt a készüléket. Az újbóli csatlakozáshoz új meghívókód kell.",
  officialPlugin: "Az egyik hivatalos Mirador-bővítmény, amely a sodre90/mirador-plugins katalógusban szerepel.",
  installOfficialPlugin: "Klónozza a bővítmény repóját, és megmutatja, mi fut belőle. Semmi sem fut belőle, amíg bele nem egyezel.",
  addPlugin: "Klónozza a repót, és megmutatja, mi fut belőle: a build parancsát és a host-kódját. Semmi sem fut belőle, amíg bele nem egyezel.",
  agreeToPlugin: "Lefuttatja a build parancsot, majd a bővítményt a Mirador bővítménymappájába teszi. A Mirador a következő indulásától tölti be, a host-kódjával együtt.",
  checkForUpdates: "Most keres újabb Miradort, nem csak a következő automatikus ellenőrzéskor, amely 6 óránként történik.",
  checkPluginUpdates:
    "A bővítmény újabb kiadását keresi, illetve egy ágat követő bővítménynél az ág új commitjait. Semmi sem változik, amíg nem frissítesz.",
  pluginUpdatesWaiting:
    "Git-repókból telepített bővítmények, amelyekhez újabb kiadás vagy új commit érhető el. A Mirador induláskor és 6 óránként ellenőrzi őket. Magától csak akkor telepít, ha a Bővítményfrissítések beállítás ezt kéri; egyébként a Beállítások › Bővítmények részben frissítheted őket.",
  pluginUpdateMode:
    "Kérdezzen meg: minden frissítéshez a jóváhagyásod kell. A Mirador frissítésével: az automatikusan frissülő bővítmények új kiadásai a Mirador következő frissítésekor települnek, git checkoutból futó Miradornál egy új commitnál. Minden újraindításkor: a Mirador minden indulásakor települnek. A Mirador amint talál egy új kiadást, letölti, és rögtön le is futtatja a buildjét. Egy frissítés továbbra is a jóváhagyásodra vár, ha a plugin.json-ja más build parancsot vagy más host modul fájlokat nevez meg, vagy nem a hivatalos repóból származik; e fájlok tartalmát nem hasonlítja össze.",
  pluginUpdatesByItself:
    "A bővítmény új kiadásai kérdés nélkül települnek, a Bővítményfrissítések beállításnak megfelelően. A hivatalos bővítményeknél alapból be van kapcsolva.",
  undoPluginUpdate:
    "A következő újraindításkor visszaállítja a frissítés előtti verziót. Ez a kiadás ezután nem települ magától, de kézzel továbbra is frissíthetsz rá.",
  updateAllPlugins: "Klónozza minden bővítmény újabb kiadását vagy új commitjait, megmutatja, mi fut mindegyikből, majd egyszer kér beleegyezést mindegyikhez.",
  updatePlugin:
    "Klónozza a legújabb kiadást, vagy az ágat a mostani állapotában, és megmutatja, mi fut belőle. Ha beleegyezel, buildeli, és csak ezután cseréli le a bővítményt, így egy sikertelen frissítés a régi állapotban hagyja.",
  removePluginArmed: "Kattints újra a bővítmény eltávolításához. A Mirador a következő indulásától nem tölti be.",
  unlinkPluginArmed: "Kattints újra a link eltávolításához. A mappa, amelyre mutat, változatlan marad.",
  copyOnSelect: "A terminálban kijelölt szöveg – húzással, dupla vagy tripla kattintással – azonnal a vágólapra kerül, mint az iTerm2-ben és a Linux-terminálokban.",
  terminalLink: (click) => `${click} a link megnyitásához a böngésződben.`,
  terminalPreset: "Beépített terminálszínek: háttér, előtér és ANSI-paletta.",
  terminalFontSize: "Betűméret a terminálok felosztásaiban és lapjain (11–24 px). Ha egy terminál fókuszban van, a ⌘+ és a ⌘− lépteti.",
  terminalFontFamily:
    "Bármely ezen a gépen telepített betűtípus a neve alapján, például JetBrains Mono. A terminálok és az állapotsor azonnal átváltanak rá, tartalékként a szokásos betűtípusokkal. Ha üres, vagy a gépen nincs ilyen betűtípus, a szokásos betűtípus látszik.",
  terminalLineHeight: "Egy terminálsor magassága a betűméret többszöröseként.",
  terminalLetterSpacing: "Extra távolság a terminál karakterei között, pixelben.",
  terminalCursorStyle: "A terminálkurzor alakja.",
  terminalCursorBlink: "Villogjon-e a terminálkurzor.",
  terminalFontWeightBold: "Milyen vastag a félkövér szöveg a terminálokban.",
  terminalScrollback: "Hány sort őriz meg egy terminál, miután kigördültek a tetején.",
  connectedDevicesInSidebar:
    "Amíg készülékek csatlakoznak, az oldalsáv alján egy sor mutatja, hány; kattints rá, hogy lásd, melyek. Ez a böngésző megjegyzi.",
  connectedDevices: (names) => `Most csatlakozva: ${names.join(", ")}. Kattints, hogy lásd az összes készüléket a Beállítások → Készülékek részben.`,
  pageLibrariesSetting:
    "Ahonnan a vászonról másolt vagy mentett oldal betölti a D3-at, a Mermaidot és a three.js-t. A vászon maga szolgálja ki őket, de ezt egy Miradoron kívüli oldal nem éri el. A three.js mindig a CDN-ről jön.",
  editsInCanvasSetting:
    "Bekapcsolva egy szerkesztés, amelynek engedélyezésére az ágens vár, elfoglalja a vásznat, Egyesített / Osztott kapcsolóval és a fájl sorszámaival, a chatben pedig egy kis kártya marad. Kikapcsolva a chatkártya mutatja a diffet, a vászon pedig változatlan marad.",
  askPageBefore:
    "Az ágens közvetlenül a kérdés előtt, ugyanabban a körben mutatta ezt az oldalt. A kérdés fölött marad, hogy mindkettőt elolvashasd; az Előzményekben külön is megtalálod.",
  canvasToggle: "A vászon panel elrejtése vagy megjelenítése. A rajzok és kérdések rejtett állapotban is megérkeznek, és az Előzményekben maradnak.",
  runCommand:
    "Lefuttatja a ! utáni parancsot ennek a munkaterületnek a mappájában a bejelentkezési shelleddel, bemenet nélkül. A kimenete itt jelenik meg, és a következő üzeneteddel az ágenshez kerül, mint a Claude Code-ban a !-lel. Interaktív programokhoz használd a terminált.",
  undoFiles:
    "Visszaállítja ennek a munkaterületnek a fájljait arra az állapotra, amilyenek a kör kezdete előtt voltak: amit a kör módosított, az visszaáll, amit létrehozott, az törlődik. A Mirador azért őrizte meg őket, mert ez a munkaterület git-repó; a saját commitjaid, ágaid és előzményeid érintetlenek maradnak.\n\nA beszélgetés változatlan marad. Az ágens a következő üzeneteddel megtudja, hogy a fájlokban már nincs benne az a kör.",
  undoFilesConfirm:
    "Visszaírja a munkaterület fájljait arra az állapotra, amilyenek a kör kezdetén voltak. Elvész mindaz, amit a kör és minden utána következő tett a fájlokkal; a beszélgetés megőrzi a nyomát. Azok a fájlok, amelyeket azóta commitok módosítottak, például egy pullé, a commitolt állapotban maradnak. Használd a terminált, ha a fájlokat a mostani állapotukban szeretnéd.",
  rewind:
    "Visszaviszi a beszélgetést és ennek a munkaterületnek a fájljait arra az állapotra, amilyenek a kör kezdete előtt voltak: ez a kör és minden utána következő kikerül a beszélgetésből, az ágens pedig olyan munkamenetben folytatja, amelyben csak az előttük lévők vannak.\n\nA kikerülő köröket semmi sem kínálja fel újra, sem az idővonal, sem más. Az ágens saját munkamenetfájlja a lemezen marad, ahol a saját folytatása (a Claude Code --resume-ja, a pi /resume-ja) még eléri. A commitjaid, ágaid és előzményeid érintetlenek maradnak.",
  rewindConfirm:
    "A beszélgetés elveszíti ezt a kört és minden utána következőt, velük együtt az ágens saját előzményeit is; a fájlok visszaállnak a kör kezdetének állapotára, hacsak meg nem tartod őket úgy, ahogy vannak. Azok a fájlok, amelyeket azóta commitok módosítottak, például egy pullé, a commitolt állapotban maradnak. Innen egyik sem hozható vissza.",
  revertFiles:
    "Felsorolja a fenti számok mögötti fájlokat: az azóta létrehozottakat, amelyek törlődnek; azokat, amelyek visszaállnak a kör kezdetének állapotára; és azokat, amelyeket azóta commitok módosítottak, és változatlanok maradnak.",
  rewindPutFilesBack:
    "Bekapcsolva: a fájlok visszaállnak a kör kezdetének állapotára, kivéve azokat, amelyeket azóta commitok módosítottak. Kikapcsolva: csak a beszélgetés lép vissza, és minden fájl a mostani állapotában marad, azzal együtt, amit a kikerülő körök tettek vele. Az ágens ezt nem tudja meg; úgy találja a fájlokat, ahogy vannak.",
  commandDelivery: "A !-lel futtatott parancsok a következő üzeneteddel kerülnek az ágenshez, azokban a tagekben, amelyeket a Claude Code a saját ! parancsaihoz használ.",
  commandOutputsAttached: "A !-lel futtatott parancsok ezen kimenetei a következő üzeneted előtt mennek az ágenshez. A ✕ kihagyja őket.",
  terminalToggle:
    "A beszélgetés termináljainak elrejtése vagy megjelenítése; ezek a munkaterülete mappájában futnak. A shelljeik tovább futnak, amíg a panel rejtve van vagy másik beszélgetés látszik, és az oldal újratöltésekor újra csatlakozik hozzájuk.",
  terminalHide: "A terminálok elrejtése. A shelljeik tovább futnak; a beszélgetés fejlécéből vagy a parancspalettáról jelenítheted meg őket újra.",
  terminalNewTab:
    "Shell nyitása a beszélgetés termináljainak egy új lapján, a munkaterülete mappájában. Minden ablak ugyanazokat a lapokat mutatja ehhez a beszélgetéshez.",
  terminalSplit: "Újabb shell nyitása a fókuszban lévő mellett, ugyanazon a lapon (legfeljebb 4).",
  terminalSplitDown: "Újabb shell nyitása a fókuszban lévő alatt, ugyanazon a lapon (legfeljebb 4).",
  terminalFindWholeWord: "Egész szó egyezése: csak ahol a szöveg önállóan áll, nem egy hosszabb szó belsejében.",
  terminalFindRegex: "Reguláris kifejezés: a szöveg egy JavaScript reguláris kifejezés, például error|warn.",
  terminalShowAll: "A lap többi termináljának újbóli megjelenítése; ez már nem tölti ki a lapot.",
  terminalCloseBusy: (command) => `Ebben a terminálban fut: ${command}. Kattints újra, vagy nyomd meg az Entert vagy a ⌘W-t, hogy leállítsd és bezárd a terminált; az Esc megtartja.`,
  terminalCloseTab: "A lap bezárása és a shelljeinek leállítása. A lapra kattintás a középső gombbal is bezárja; ha parancs fut benne, előbb rákérdez.",
  terminalCloseTabBusy: (command) =>
    `Ezen a lapon fut: ${command}. Kattints újra, kattints a lapra újra a középső gombbal, vagy nyomd meg az Entert, hogy leállítsd és bezárd a lapot; az Esc megtartja.`,
  terminalCloseTabArmed: "Kattints újra, hogy leállítsd a lap shelljeit és mindazt, ami bennük fut.",
  terminalCloseSplit: "A shell leállítása és a felosztásának bezárása.",
  terminalCloseSplitArmed: "Kattints újra, hogy leállítsd ezt a shellt és mindazt, ami benne fut.",
  subagentsRunning:
    "Az ágens által indított, még dolgozó alágensek, amelyek az üzenetmező fölött is szerepelnek; kattints az első megnyitásához. A háttérben indított alágens addig számít, amíg az őt indító kör véget nem ér, mert addig semmi sem jelzi, hogy befejeződött.",
  searchAll: "Keresés minden munkaterület minden beszélgetésében. Egy találatot megnyitva a beszélgetésében mutatja.",
  find: "Szöveg keresése bárhol ebben a beszélgetésben: a még be nem töltött korábbi bejegyzésekben és az összecsukott kártyákban is, amelyek ott nyílnak ki, ahol találat van.",
  fork: "Ennek a beszélgetésnek a másolata egy új beszélgetésbe, ugyanazon a profilon; ez a beszélgetés változatlan marad. Az itt futó kör folytatódik, a másolatban az lesz, amit az ágens eddig elmentett belőle. Akkor lehetséges, ha az ágens már dolgozott egy üzeneten itt.",
  forkThroughTurn: "Ezt a beszélgetést e körig, a válaszával együtt, egy új beszélgetésbe másolja ugyanazon a profilon, azzal együtt, amit a vászon addig mutatott; ez a beszélgetés változatlan marad. A másolat ugyanazokon a fájlokon dolgozik, úgy, ahogy most vannak.",
  findOlder: "Előző találat, feljebb (Enter)",
  findNewer: "Következő találat, lejjebb (Shift+Enter)",
  findMatchCase: "Kis- és nagybetű megkülönböztetése.",
  runningSubagent: "Egy dolgozó alágens. Kattints, hogy megnyisd a kártyáját a beszélgetésben, és lásd, mit csinált eddig.",
  approvalWaiting: "Az ágens vagy valamelyik alágense feljebb a beszélgetésben a jóváhagyásodra vár. Kattints, hogy odaugorj.",
  subagentTokens: (read, written, fresh) =>
    `Bemeneti tokenek: ${read} a gyorsítótárból olvasva, ${written} oda írva, ${fresh} új. Az alágens Claude Code-átiratából számolva.`,
  inTerminal:
    "Ez a Claude Code-munkamenet egy terminálban is fut. A host ezt a Claude Code munkamenet-nyilvántartásából látja (<config dir>/sessions/<pid>.json), és mutatja, mit csinál a terminál.",
  launch:
    "A profil, amelyen az új beszélgetések ebben a munkaterületen indulnak, és vele az ágensük. Munkaterületenként megjegyzi. A meglévő beszélgetések azon a profilon maradnak, amelyen futnak, amíg át nem teszed őket.",
  setUpProfile:
    "Minden beszélgetés egy profilon fut. Az elsőt a fő panelen állíthatod be; ha semmi mást nem adsz meg, az ágenst úgy futtatja, ahogy ezen a gépen be van állítva.",
  continueSession:
    "Egy Claude Code-, opencode-, pi- vagy Codex-munkamenet folytatása, amelyet ebben a könyvtárban egy terminálban indítottak. Folytathatod helyben, vagy az előzményeit leágaztathatod egy új beszélgetésbe, az eredetit érintetlenül hagyva.",
  sessionSearch:
    "Munkamenetek keresése ebben a könyvtárban aszerint, mi hangzott el bennük, bármilyen régiek. A keresés az ágens saját feljegyzéseit olvassa minden itteni munkamenetről, így olyanokat is megtalál, amelyeket a lista nem mutat.",
  profiles:
    "Elnevezett beállítások egy ágenshez: környezeti változók és indítás előtti parancs, amelyeket a profil által indított ágensfolyamatra alkalmaz. Minden beszélgetés valamelyiken fut.",
  shellOutputStyle:
    "Hogyan jelenik meg egy beszélgetésben az ágens által futtatott minden shell-parancs, amíg ki nem nyitod vagy be nem csukod: a parancsa a kimenettel egy kattintásnyira, a kimenet csak akkor nyitva, ha a parancs hibázott, egyetlen sor, amelyből a parancs is egy kattintásnyira van, vagy minden nyitva. A !-lel futtatott parancsaid kimenete mindig látszik.",
  shellLook:
    "A shell-blokkok színei egy beszélgetésben: az ágens parancsai, a tieid és a jóváhagyásodra váró parancsok. „A témát követi” esetén az alkalmazás többi részéhez igazodik; az Egyéni az általad választott háttér-, szöveg- és promptszínt használja.",
  shellFont: "Bármely ezen a gépen telepített betűtípus a neve alapján, például JetBrains Mono. Ha üres, vagy a gépen nincs ilyen betűtípus, az alkalmazás monospace betűtípusa látszik.",
  shellFontSize: "A shell-blokkok szövegének mérete az alkalmazás szövegméretéhez képest.",
  timestamps: "Kikapcsolva: az idő minden szerző neve mellett látszik, egy későbbi soron pedig akkor, ha fölé viszed az egeret.\nBekapcsolva: minden sor mutatja az idejét.",
  pulses:
    "A dolgozó és egy feladatra váró beszélgetések pöttyei lüktetnek. Linuxon másodpercenként néhányszor változnak, mert minden változás újrarajzoltatja az ablakot.\nKikapcsolva: mozdulatlanok maradnak. Akkor is mozdulatlanok, ha a rendszered csökkentett mozgást kér.",
  textSize: "Szövegméret az egész alkalmazásban: 50%, 70%, 100%, 140% vagy 200%. A ⌘+ és a ⌘− lépteti, a ⌘0 visszaállítja.",
  theme: "Világos, sötét, vagy a rendszerbeállítást követi.",
  waitingStyle:
    "Hogyan jelöli az oldalsáv azt a beszélgetést, amelynek az ágense rád vár: jóváhagyásra vagy válaszra (Rád vár), vagy mert a köre véget ért, amíg máshol jártál (Kész, illetve hiba után Sikertelen).\n\nCímke és szám: egy címke a soron és egy szám a munkaterületén. Csak pötty: egy színes pötty és félkövér cím. Címkék és lista felül: emellett minden várakozó beszélgetést felsorol a munkaterületek fölött.",
  conversationOrder: "Válaszd ki, milyen sorrendben és melyik irányban álljanak a munkaterületek beszélgetései. A kedvencek felül maradnak.",
  addFavourite: "Hozzáadás a kedvencekhez: a munkaterülete tetején marad, bármilyen a sorrend.",
  removeFavourite: "Eltávolítás a kedvencek közül: visszakerül a helyére a sorrendben.",
  waitingCount: "A munkaterület rád váró beszélgetései.",
  workspaceColor: "Adj színt ennek a munkaterületnek, hogy megkülönböztesd az oldalsávban. Minden ablak mutatja.",
  workspaceColorStyle:
    "Hogyan mutatja a színét egy munkaterület, amelynek színt adtál: az egész kártyáján, csak a fejlécén, vagy csíkként a szélén egy halványabb árnyalat fölött. Kattints egy munkaterület monogramjára, hogy színt adj neki.",
  newConversation: "Beszélgetés indítása ezen a munkaterületen, a gomb mellett kiválasztott profilon.",
  worktrees: "Hol dolgoznak ennek a munkaterületnek az új beszélgetései: mind a projektmappában, vagy mindegyik saját git worktree-ben, az új worktree-k beállító parancsával.",
  addWorkspace: "Projektkönyvtár hozzáadása. A beszélgetései ezzel mint munkakönyvtárral futnak.",
  hideSidebar: "Elrejti az oldalsávot, hogy a beszélgetés, a vászon és a terminál kapja a teljes szélességet. Ez a böngésző megjegyzi.",
  showSidebar: "Újra megjeleníti az oldalsávot a munkaterületekkel és a beszélgetésekkel.",
  addWorkspaceGroup:
    "Csoport hozzáadása: egy összecsukható fejléc, amely alá munkaterületeket gyűjthetsz, például projektenként vagy ügyfelenként. Húzz egy munkaterületet a fejlécénél fogva egy csoportba, a munkaterületeket és csoportokat pedig bármilyen sorrendbe.",
  foldWorkspace: "A munkaterület összecsukása a fejlécére. Ha megnyitod valamelyik beszélgetését, kinyílik.",
  unfoldWorkspace: "A munkaterület beszélgetéseinek újbóli megjelenítése.",
  workspaceGroupCount: "A csoport munkaterületei.",
  waitingInGroup: "A csoport munkaterületeinek rád váró beszélgetései.",
  waitingAbove: "Rád váró beszélgetések, fent kigördülve a látómezőből. Kattints a legközelebbi megjelenítéséhez.",
  waitingBelow: "Rád váró beszélgetések, lent kigördülve a látómezőből. Kattints a legközelebbi megjelenítéséhez.",
  renameWorkspaceGroup: "A csoport átnevezése.",
  deleteWorkspaceGroup: "A csoport törlése. A munkaterületei a helyükön maradnak.",
  deleteWorkspaceGroupArmed: "Kattints újra a csoport törléséhez. A munkaterületei a helyükön maradnak.",
  removeWorkspace:
    "A munkaterület és a beszélgetései eltávolítása az alkalmazásból. A Mirador adatmappájában lévő worktree-jei is törlődnek, de a projektkönyvtár megmarad. Ha egy worktree-ben nem commitolt fájlok vannak, előbb rákérdez.",
  removeWorkspaceArmed:
    "Kattints újra, hogy eltávolítsd a munkaterületet és a beszélgetéseit az alkalmazásból. A Mirador adatmappájában lévő worktree-jei is törlődnek, de a projektkönyvtár megmarad. Ha egy worktree-ben nem commitolt fájlok vannak, előbb rákérdez.",
  deleteConversation: "A beszélgetés, az idővonala és a vászon-előzményei törlése az alkalmazásból. Az ágens saját munkamenetfájljai a lemezen maradnak. A saját worktree-je is törlődik; ha nem commitolt fájlok vannak benne, előbb rákérdez.",
  deleteConversationArmed: "Kattints újra a beszélgetés törléséhez. Az ágens saját munkamenetfájljai a lemezen maradnak.",
  deleteProfileArmed: "Kattints újra a profil törléséhez. A beszélgetései egy másik profillal folytatódhatnak.",
  profileColour: "Ilyen színű pötty áll a profil neve előtt mindenhol, ahol megjelenik, és a beszélgetései ilyen színű szegélyt kapnak az oldalsávban.",
  profilePrelaunch: "Nem kötelező. A shelleddel és ezzel a környezettel fut, mielőtt az ágens elindul. Egy percen belül be kell fejeződnie; a hosszan futó proxykat a háttérben indítsd.",
  profileTest:
    "Ezekkel a beállításokkal indítja az ágenst, mentés nélkül, és felsorolja, mit kínál: modelleket, módokat és más beállításokat. Ha nem indul el, megmondja, melyik lépés hibázott.",
  profileModel: "A modell, amelyet egy beszélgetés átvesz, amikor ezzel a profillal indul, vagy átkerül rá; ezután a saját fejléce módosítja.\n\nA modellek azok, amelyeket az ágens kínál: a Mirador minden alkalommal megkérdezi tőle, amikor megnyitod a profilt. Egy olyan modell, amelyet az ágens már nem kínál, a beszélgetést az ágens sajátján hagyja, és a beszélgetés jelzi.",
  profileMode: "A mód, amelyet egy beszélgetés átvesz, amikor ezzel a profillal indul, vagy átkerül rá; ezután a saját fejléce módosítja.\n\nA módok azok, amelyeket az ágens kínál: a Mirador minden alkalommal megkérdezi tőle, amikor megnyitod a profilt.",
  profileEffort: "Az erőfeszítés, amelyet egy beszélgetés átvesz, amikor ezzel a profillal indul, vagy átkerül rá; ezután a saját fejléce módosítja.\n\nA szintek azok, amelyeket az ágens kínál: a Mirador minden alkalommal megkérdezi tőle, amikor megnyitod a profilt. Az a beszélgetés, amelynek a modellje nem kínálja a szintet, megtartja a saját erőfeszítését.",
  profileYolo: "Mindent jóváhagy, amire az ágens engedélyt kér. Egy beszélgetés akkor veszi át, amikor ezzel a profillal indul, vagy átkerül rá; ezután a saját fejléce módosítja.",
  profileIdleCompaction: "A Claude Code összefoglalja a hosszú beszélgetést, ha nagyjából egy órája tétlen, közvetlenül azelőtt, hogy a prompt gyorsítótára lejár, így a következő üzeneted kevesebbe kerül. A beszélgetések akkor veszik át, amikor elindulnak vagy újra megnyílnak.",
  onlyProfile: "Ez az egyetlen profilod, és minden beszélgetésnek kell egy, ezért megmarad, amíg nem hozol létre másikat.",
  unsavedProfileEdits: "Még nem mentett módosítások. Megmaradnak, amíg a Profilok nyitva van; a Mentés őrzi meg őket.",
  splitter: "Húzd az átméretezéshez, dupla kattintással visszaáll.",
  composerGrip:
    "Húzd felfelé, hogy magasabb legyen az üzenetmező, lefelé, hogy kisebb; hosszabb szövegnél így is nő. Ebben a böngészőben minden beszélgetés ugyanezt a magasságot használja. Dupla kattintással újra a szöveghez igazodik.",
  paneGrip:
    "Húzd egy másik panelre, hogy felcseréld a kettőt, vagy használd a palettán a Csere parancsot. Minden beszélgetés megjegyzi a saját elrendezését; a Beállításokban választhatod ki, melyikkel induljanak az új beszélgetések.",
  paneFullscreen: "Ez a panel töltse ki a munkaterületet. A sávra duplán kattintva ugyanez történik.",
  paneExitFullscreen: "Vissza a többi panelhez. Az Esc ugyanezt teszi, kivéve terminálban, amely megtartja magának az Esc-et.",
  canvasHide: "A vászon elrejtése. A rajzok és kérdések továbbra is megérkeznek, és az Előzményekben maradnak; a beszélgetés fejlécéből vagy a palettáról jelenítheted meg újra.",
  settings:
    "A téma, az időbélyegek, az új beszélgetések kezdő elrendezése, a rendszerértesítések, macOS-en pedig az, hogy javítsa-e a helyesírásodat, vagy javasoljon-e szavakat gépelés közben.",
  queue:
    "Az ágens munkája közben küldött üzeneteid itt várakoznak.\n\nA Claude Code-dal, a pi-vel és a Codexszel egy „a körhöz csatlakozik” címkéjű üzenet csak addig vár itt, amíg az ágens eszközöket futtat: amint végeznek, a futó körbe kerül, így az ágens a következő lépése előtt elolvassa. Egy „a kör után” címkéjű üzenet a kör végéig vár, majd a következő üzenetedként megy ki. Az Enter és az ⌥Enter (Alt+Enter) egy-egy módon küld; a Beállításokban választhatod ki, melyik melyiket. Az opencode nem tud üzenetet fogadni futó körbe, így vele mind várakozik.\n\nA várakozó üzenetek egyenként mennek ki, mindegyik akkor, amikor az előtte lévő kör véget ér, akkor is, ha megnyomod a Leállítás gombot. Egy üzenetet a ⋮⋮ fogójánál húzva változtathatsz a kimenési sorrenden. A Szerkesztés visszateszi az üzenetet az üzenetmezőbe; üres mezőben a ↑ ugyanezt teszi az utolsóval. A sort a host őrzi, így túléli az oldal újratöltését és a host újraindítását.",
  usageLimit:
    "A Claude Code elérte a használati korlátját. Ahelyett, hogy a sorba állított üzeneteidet ugyanebbe a falba küldené, a host megtartja őket, és a Claude Code-hoz hasonlóan egy perccel a korlát lejárta után megkéri az ágenst, hogy folytassa, ahol abbahagyta; a sorba állított üzeneteid ezt követik. Ezt legfeljebb kétszer egymás után teszi meg magától; ezután, vagy ha az üzenet nem nevez meg lejárati időt, rád vár.\n\nA várakozás túléli a host újraindítását.",
  continueAfterUsageLimit:
    "Megkéri az ágenst, hogy most folytassa, ahol abbahagyta, például miután olyan profilra váltottál, amely egy másik fiókba jelentkezik be. A sorba állított üzenetek ezt követik.",
  tryAgain: "Megkéri az ágenst, hogy folytassa, ahol abbahagyta. Az az üzenet, amellyel a sikertelen kör kezdődött, még megvan neki.",
  stopWaitingForUsageLimit: "A korlát lejártára való várakozás leállítása: az ágens nem folytatja magától, a sorba állított üzeneteid pedig most kimennek.",
  jobWait:
    "Az ágens futni hagyta ezt a feladatot, és lefuttatta a mirador when-done parancsot, így nem kell figyelnie. A Mirador időnként ránéz: egy folyamatra másodpercenként, egy konténerre 5 másodpercenként, egy másik gépen futó feladatra 20 másodpercenként ssh-n keresztül. Amikor véget ér, az üzenet a következő üzenetedként megy az ágenshez, vagy ha az ágens így kérte, csak hozzád.\n\nA várakozás túléli a host újraindítását.",
  followJob:
    "Kövesd a beszélgetés egy terminállapján: mit futtat, mióta fut, majd a kimenetét, ahogy érkezik, abból a fájlból, amelybe egy folyamat ír, vagy a konténer naplóiból. A lap jelzi, amikor a feladat véget ér. A Ctrl+C bezárja; a feladat tovább fut.",
  stopWaitingForJob: "A feladatra való várakozás leállítása: amikor véget ér, senki sem kap értesítést. Tovább fut.",
  asyncTask:
    "Ezt maga a Claude Code futtatja a háttérben, így az ágensnek nem kell rá várnia: egy run_in_background-dal indított parancs vagy egy munkafolyamat. A Claude Code szól az ágensnek, amikor véget ér.\n\nA feladat az ágens folyamatával együtt él és hal.",
  asyncTaskOutput:
    "Megmutatja, mit írt eddig a feladat: annak a fájlnak a végét, amelyben a Claude Code a kimenetét tartja, frissítve, amíg nyitva van. Kattints újra az elrejtéséhez.",
  stopAsyncTask: "A feladat leállítása: a Claude Code befejezi, és az ágens értesül róla. Az őt indító kör tovább fut.",
  dismissAsyncTask: "A feladat elvetése: eltávolítja az üzenetmező fölül.",
  clearFinishedAsyncTasks: "Az összes befejezett feladat eltávolítása az üzenetmező fölül.",
  delegatedTask:
    "Egy bővítmény eszköze, például a delegate, egy másik profilon indította ezt a beszélgetést, hogy ennek a beszélgetésnek dolgozzon egy feladaton. Amikor az első köre véget ér, az ágensének utolsó üzenete a következő üzenetedként érkezik ennek a beszélgetésnek az ágenséhez.\n\nA válasz túléli a host újraindítását.",
  openDelegatedTask: "A feladaton dolgozó beszélgetés megnyitása, hogy figyeld, vagy válaszolj arra, amit kérdez.",
  stopDelegatedTask: "A köre leállítása. Az itteni ágens megtudja, hogy a feladat leállt, azzal együtt, amit a másik ágens addig mondott.",
  dismissDelegatedTask:
    "A feladat elvetése: eltávolítja az üzenetmező fölül, a beszélgetését pedig az oldalsávból. A keresés továbbra is megtalálja a beszélgetést.",
  clearFinishedDelegatedTasks: "Az összes befejezett átadott feladat eltávolítása az üzenetmező fölül.",
  delegatedFold: "Beszélgetések, amelyeknek ez feladatot adott át, például a delegate-tel. Kattints, hogy megjelenítsd vagy elrejtsd őket alatta.",
  sideChatToggle: "Kérdezz erről a beszélgetésről mellette, anélkül hogy megszakítanád. A mellékszál ágense olvashat és kereshet, de semmit nem módosíthat, ahol az ágens ezt lehetővé teszi.",
  sideChatReadOnly: "Az ágense olvashat és kereshet, de nem módosíthat fájlokat, és nem futtathat parancsokat.",
  sideChatCanChange: "Ezt az ágenst nem lehet olvasásra korlátozni: arra kérjük, hogy ne módosítson fájlokat és ne futtasson parancsokat, de semmi sem akadályozza meg.",
  sideChatNew: "Újabb kérdés egy új mellékszálban. Ez a mellékszál megmarad a beszélgetése alatt az oldalsávban.",
  sideChatClose: "A mellékszál elrakása. Az oldalsávban a beszélgetése alatt marad.",
  sideChatPromote: "Önálló beszélgetés lesz belőle, a fő beszélgetés módjában, így fájlokat is módosíthat.",
  sideChatSendToMain: "Ez a válasz idézetként a beszélgetés üzenetmezőjébe kerül, hogy szerkeszd és elküldd.",
  askInSideChat: "Kérdezz erről a szövegről a beszélgetés mellett, anélkül hogy megszakítanád.",
  quoteInReply: "Ez a szöveg idézetként az üzenetmezőbe kerül.",
  delegatedWorking: "Dolgozik: egy átadott feladat még fut. A válasza ennek az ágensnek a következő üzeneteként érkezik.",
  claudeProgram: (installFolders) =>
    `A claude program, amellyel a Mirador a Claude Code-ot futtatja a host gépén. Üresen: a PATH-on lévő claude, különben ezekben: ${installFolders}.\n\nEgy profil a környezetében a CLAUDE_CODE_EXECUTABLE-lel másikat is futtathat.`,
  keepAwake:
    "Megakadályozza, hogy a gép, amelyen a Mirador fut, tétlenül elaludjon.\n\nAmíg az ágensek dolgoznak: amíg minden futó kör véget nem ér, hogy a hosszú feladatok befejeződjenek.\n\nMindig: amíg a Mirador fut, hogy a telefonod és a többi készüléked bármikor elérje.\n\nmacOS-en és Linuxon.",
  canvasUse:
    "Szükség szerint: az ágens a vászon saját utasításai alapján dönt.\n\nGyakran: a Claude Code, a pi, a Codex és az Antigravity rendszerpromptja, valamint a Copilot vászonutasításai arra is utasítják őket, hogy a magyarázatokat, összehasonlításokat, terveket és egy nagyobb munka összefoglalóját a vászonra tegyék, és a választásokat ott kérdezzék meg tőled.\n\nAz oldalak több tokenbe kerülnek, mint ugyanaz a válasz szövegként.",
  keepDeletedCanvas:
    "Ha törölsz egy beszélgetést, a vászna ennyi ideig megmarad. Ha a munkamenetét a Munkamenet folytatása… menüből folytatod, a vászon úgy tér vissza, ahogy volt, az átnézésekkel és bejárásokkal együtt. Ezután csak az jön vissza, amit a munkamenet saját előzménye őriz: oldalak, kérdések és ellenőrzőlisták.",
  terminalCommand:
    "A Claude Code ezt csak a saját termináljában mutatja, ezért ez ott nyitja meg: a beszélgetés egy terminállapján, azzal a Claude Code-dal, amelyet a beszélgetés profilja használ. Maga a parancs a panelen zajlik; az ágens fenti válasza csak annyi, hogy elutasította.",
  logIn:
    "Megnyitja az ágens saját bejelentkezését a beszélgetés egy terminállapján, a profiljával, így egy saját fiókkal rendelkező profil abba jelentkezik be. Ha kiírja, hogy bejelentkeztél, küldd el újra az üzenetedet.",
  queuedGrip: "Húzd, hogy módosítsd a sorba állított üzenetek kimenési sorrendjét: felülről indulnak.",
  queuedDelivery: "Hogyan megy ki ez az üzenet: a futó körbe, amint az ágens eszközei végeztek, vagy a kör vége után. Kattints a váltáshoz.",
  steerMessage:
    "Az üzenetet a futó körhöz adja: a Claude Code azonnal elolvassa, megszakítva, amit éppen ír, vagy ha eszközöket futtat, amint azok végeztek. A pi akkor olvassa el, amikor befejezte az írást vagy az eszközei futtatását.",
  afterTurnMessage: "Megtartja az üzenetet, amíg a futó kör véget nem ér (vagy meg nem nyomod a Leállítás gombot), majd a következő üzenetedként küldi el.",
  messageBox:
    "A „Formáz gépelés közben” a **félkövér**, *dőlt*, ~~áthúzott~~, `kód`, ``` kódblokk, > idézet és - lista jelöléseket menet közben formázássá alakítja, mint a Slackben; a ⌘B, ⌘I, ⌘⇧X és ⌘E egy kijelölést formáz. Az ágens mindkét esetben ugyanazt a markdownt kapja.",
  formatBar: "Formázógombok az üzenetmező fölött. A Beállítások › Beszélgetések részben állandóan láthatóvá teheted őket.",
  formatBarSetting:
    "A formázógombok kezdettől látszanak-e a formázott üzenetmező fölött, vagy csak a mellette lévő Aa-ra kattintás után. Az Aa mindkét esetben megjeleníti és elrejti őket.",
  formatBold: "Félkövér, vagy gépeld: **szöveg**",
  formatItalic: "Dőlt, vagy gépeld: *szöveg*",
  formatStrike: "Áthúzott, vagy gépeld: ~~szöveg~~",
  formatCode: "Kód, vagy gépeld: `szöveg`",
  formatLink: "A kijelölt szöveg linkelése egy címre, vagy gépeld: [szöveg](cím)",
  formatLinkAddress: "Az Enter linkel, az üres cím megszünteti a linket, az Esc pedig változatlanul hagyja.",
  formatBullets: "Felsorolás, vagy kezdj egy sort - jellel és szóközzel. Az Enter új elemet ad hozzá; a ⌘Enter (Ctrl+Enter) elküldi.",
  formatNumbers: "Számozott lista, vagy kezdj egy sort 1. jellel és szóközzel. Az Enter új elemet ad hozzá; a ⌘Enter (Ctrl+Enter) elküldi.",
  formatQuote: "Idézet, vagy kezdj egy sort > jellel és szóközzel",
  formatCodeBlock: "Kódblokk, vagy gépelj ```-t egy sor elején. Az Enter új sort ad hozzá, a végén a ↓ kilép belőle, a ⌘Enter (Ctrl+Enter) elküldi.",
  enterWhileBusy: "Mit tesz az Enter egy üzenettel, amíg az ágens dolgozik; az ⌥Enter (Alt+Enter) a másikat teszi. Az opencode-dal az üzenetek mindig a kör végéig várnak.",
  openFile:
    "Megnyitja a fájlt abban a programban, amelyet a host rendszere használ hozzá, azon a gépen, amelyen a Mirador fut. Egy szkript szövegként nyílik meg, abban a programban, amelyet a Beállítások › Beszélgetések részben választasz. Egy programfájl nem nyílik meg.",
  pushRelayAddress: "Ahová ez a Mac a telefonjaidnak szóló push-értesítéseket küldi; üresen nem küld. A telefonok csak akkor kapnak értesítést, ha regisztráltak ennél a Macnél.",
  pushRelayToken: "A token, amelyet a továbbító gazdája készített ennek a Macnek. A Mirador megőrzi, és többé nem mutatja; hagyd üresen, hogy a beállított megmaradjon.",
  machineName:
    "Ahogy a telefonok hívják ezt a gépet: csatlakozáskor átveszik, és egy telefon saját nevet is adhat neki. Más gépekhez is ezen a néven csatlakozik Miradorként. Üresen a számítógép nevét viseli.",
  scriptProgram:
    "Ahol egy szkriptre mutató fájllink megnyílik, szövegként, a host gépén. A típusához tartozó program le is futtathatná: a Git for Windows a .sh fájlokat futtatja, a Python indítója a .py fájlokat.\n\nA rendszer szövegszerkesztője: macOS-en az, amelyet a szöveghez választottál, Windowson a Jegyzettömb. A Linuxnak nincs sajátja, így ott az xdg-open választja ki a programot a szkript típusához, egy futtatható szkript pedig – amelyet az a program futtathatna – nem nyílik meg.\n\nEgy általad megadott program: a neve a host PATH-ján, például code vagy subl, vagy a teljes útvonala. A fájl útvonalát kapja meg. Windowson .exe-t adj meg, például Code.exe-t: egy .cmd vagy .bat a cmd.exe-n keresztül futna, amely egy fájlnév egy részét parancsnak vehetné.",
  editor:
    "A szerkesztő, amelyet a Megnyitás gomb használ a host gépén. A Mirador mindegyik parancssori indítóját (idea, code, cursor, zed, subl) keresi a host PATH-ján és ott, ahová a telepítője teszi. Az elsőt használja, amelyet ebben a sorrendben megtalál.",
  editorCommand:
    "Egy program és argumentumai, shell nélkül futtatva. A {file} helyére a fájl útvonala, a {line} helyére a sora kerül; {file} nélkül az útvonal a végére. A szóközt tartalmazó programútvonalat tedd idézőjelbe.",
  profilePicture:
    "A képed, amely az üzeneteid mellett látszik. Négyzetre vágja, itt 128 pixelesen rajzolja ki, és a host őrzi meg: minden böngésző és készülék, amely megnyitja ezt a Miradort, látja.",
  blockedImage:
    "Megnyitja a képet a böngésződben. A Mirador maga nem tölt be képeket más oldalakról, így egy ágens nem küldheti el nekik, amit olvasott; a Beállítások → Beszélgetések részben ezt módosíthatod.",
  scriptMessage:
    "Egy szkript, amelyet az ágens indított, ezt a következő üzenetedként küldte el, így az ágens ott folytatja, amikor a szkript elkészült. A szkriptek a mirador message paranccsal küldenek.",
  miradorMessage:
    "Ezt a Mirador küldte az ágensnek, amikor a köre véget ért: hogy folytassa egy bejelentett, de meg nem tett lépéssel, vagy hogy használja a vásznat, ha a Beállítások gyakori használatot kérnek, például hogy az ask-kal kérdezzen tőled, ne a chatben.",
  pluginMessage:
    "Egy bővítmény küldte ezt a következő üzenetedként, például a Delegate egy átadott feladat válaszával, így az ágens onnan folytatja.",
  gitBranch: "A munkaterület könyvtárában kicheckoutolt git-ág.",
  model: "A modell, amelyet az ágens használ, a fenti Modell menüben kiválasztva.",
  cost: "Amennyibe a beszélgetés eddig került, ahogy az ágens jelenti.",
  credits: "A beszélgetés által eddig felhasznált AI-kreditek, ahogy a GitHub Copilot számolja.",
  profileChip: "A profil, amellyel ennek a beszélgetésnek az ágense fut.",
  quota: (limit, percent, resetsIn) =>
    `Az előfizetésed használati korlátja (${limit}): ${percent} felhasználva, újraindul: ${resetsIn}.\n\nAz ágens minden válasz után jelenti, a beszélgetés profiljához tartozó fiókra.`,
  statuslineCommand: (command) =>
    `Az állapotsorod, amelyet ez ír ki: ${command}.\n\nA host úgy futtatja, mint a Claude Code: a Claude Code állapotsor-JSON-jével a stdin-en (modell, cwd, munkamenet, átirat, kontextusablak, költség) és a beszélgetés profiljának környezetével. Itt válthatsz a beépített állapotsorra.`,
  statuslineBuiltIn: (command) => `A beépített állapotsor.\n\nA Claude Code beállításai egy állapotsor-parancsot neveznek meg (${command}); itt válthatsz rá.`,
  canvasOlder: "A vászon előző elemének megjelenítése.",
  canvasNewer: "A vászon következő elemének megjelenítése.",
  canvasHistory: "Minden, amit az ágens ebben a beszélgetésben rajzolt vagy kérdezett, a legújabbal kezdve.",
  canvasClear: "A vászon kiürítése. Semmi sem törlődik: az elem az Előzményekben marad.",
  canvasOpenInWindow: "Az elem megjelenítése egy saját, mindig naprakész ablakban, például egy második képernyőn. Ha újra megnyitod, az ablak előre jön.",
  canvasMore: "A sáv többi gombja, amelyeknek egy keskeny panelen nem jut hely, valamint az alkalmazások, amelyeket a munkaterület más beszélgetései használnak, hogy itt is megjelenhessenek.",
  canvasPageExport: "Az oldal másolása képként vagy HTML-ként, az ágens megkérése, hogy írja meg Markdownként, vagy mentés külön fájlba.",
  canvasPoint:
    "Mutass rá valamire az oldalon, hogy kérdezz róla az ágenstől, vagy módosíttasd: egy kattintás kiválasztja az egér alatti körvonalazott elemet, ahelyett hogy azt tenné, amit az oldal, egy húzás pedig keretet rajzol egy terület köré, amely képként megy el. Az Esc leállítja. Szövegről úgy kérdezhetsz, hogy egyszerűen kijelölöd.",
  canvasPageFind: "Keresés az ágens által mutatott oldalon: minden találat kiemelve az oldalon, az aktuális a látható részre görgetve.",
  pageMarkChange: "Mondd meg az ágensnek, mit változtasson ott: újra megmutatja az oldalt a változtatással.",
  pageMarkAdd: "Tedd ezt a megjegyzést a listára és maradj pontmódban: az oldal többi részére írt megjegyzések az ágensnek egy üzenetben mennek el.",
  pageMarkBatchChange: "Mindet egyszerre küld el, és kérd el az oldalt úgy, hogy mindegyik módosítás megtörténjen.",
  canvasMarkBatch: "A megjegyzések, amiket az oldal részeire tettél, és az ágensre várnak, hogy együtt menjenek el.",
  canvasEditsWaiting: "Annak a szerkesztésnek a megjelenítése, amelynek engedélyezésére vagy elutasítására az ágens vár.",
  canvasChanges: "A kör által módosított fájlok, vagy az összes nem commitolt változás, a sorváltozásaikkal.",
  canvasApp: "Az alkalmazás, amelyet ez a beszélgetés tart nyitva, és amelyet te és az ágense együtt módosítotok. A munkaterület egy másik beszélgetésének saját dokumentuma van.",
  canvasWorkspaceTab: "Egy bővítmény lapja ehhez a munkaterülethez, amely a munkaterület minden beszélgetésében ugyanaz.",
  canvasChecklist:
    "Az ágens munkájának lépései, kipipálva, ahogy végez velük. Te is kipipálhatod bármelyiket: az ágens a következő üzeneteddel értesül a pipáidról.",
  checklistClose: "Vissza ahhoz, amit a vászon mutatott. Az Ellenőrzőlista gomb újra megnyitja.",
  checklistDismiss: "Az ellenőrzőlista végleges levétele a vászonról. Addig nem jön vissza, amíg az ágens újat nem tesz közzé.",
  checklistPlan: "Az ágens saját teendőlistája, ahogy utoljára frissítette. Ezeket csak az ágens pipálja ki.",
  changesScope: {
    turn: "A fájlok, amelyek eltérnek attól, amilyenek a kör kezdetén voltak, ahogy az ágens vagy bármi más hagyta őket.",
    uncommitted: "git status: a fájlok, amelyek eltérnek az utolsó committól, és a projekten kívüli fájlok, amelyeket az ágens ebben a beszélgetésben szerkesztett.",
    session:
      "Minden fájl, amelyet az ágens a szerkesztőeszközeivel módosított ebben a beszélgetésben, akkor is, ha egy későbbi kör visszaállította, és a parancsai futása közben írt fájlok, a build-kimenettel és a commitjaival együtt. Nem szerepel a parancs által törölt fájl, az általa futni hagyott feladat által később írt fájl, sem az, amelyet ebben a mappában egy másik beszélgetés írt – ezt a futása közben a fájlt megnevező eszközhívásai jelzik.",
  },
  changesView: {
    list: "Minden módosított fájl külön sorban, a teljes útvonalával. Ez a böngésző megjegyzi.",
    tree: "A módosított fájlok a mappáikban. Egy mappára kattintva összecsukod. Ez a böngésző megjegyzi.",
    all: "A projekt minden fájlja a mappáiban, a módosítottak megjelölve. Csak a változást tartalmazó mappák indulnak nyitva. Ez a böngésző megjegyzi.",
  },
  changesFoldAll: "Minden mappa összecsukása, hogy csak a legfelső szint látszódjon. Egy mappára kattintva újra kinyílik.",
  changesIgnored: "A git által figyelmen kívül hagyott, az ágens parancsai által írt fájlok, például a build-kimenet megjelenítése vagy elrejtése. Ez a böngésző megjegyzi.",
  changesEditedByAgent: "A projekt fájljai, amelyeket ennek a beszélgetésnek az ágense a szerkesztőeszközeivel módosított ebben a körben.",
  changesChangedOtherwise:
    "A projekt fájljai, amelyek ebben a körben az ágens szerkesztőeszközei nélkül változtak: az ágens által futtatott parancsok, te magad, vagy egy ebben a mappában dolgozó másik beszélgetés vagy eszköz révén.",
  changesOthersMayHaveWritten:
    "Olyan fájlok, amelyek ennek a beszélgetésnek a parancsai alatt íródtak, de közben egy másik beszélgetés is futtatott ebben a mappában parancsot vagy szerkesztést, és abból, amit a kettő futtatott, nem derül ki, melyik írta őket. Azok a fájlok, amelyeket csak egy másik beszélgetés eszközhívásai neveznek meg, kimaradnak.",
  changesFromCommit: "A kör kezdete óta egy commit módosította ezt a fájlt, például egy pullé vagy az ágens sajátja.",
  changesRefresh: "A lista újratöltése. Az ágens minden befejezett eszközhívása után és a kör végén is betöltődik.",
  changesCommit: "A mappa fájljainak commitolása az általad írt üzenettel. Ennek a beszélgetésnek a változásai eleve ki vannak jelölve; amit magad tettél a staging területre, úgy marad.",
  changesMerge: "A worktree commitjainak beolvasztása a projektmappa kikért ágába, a mappa fájljaival együtt. Ha az ág azóta továbblépett, a commitok előbb rebase-elődnek rá. Semmi sem változik, ha ez ütközik, vagy felülírná a projektmappa nem commitolt változásait.",
  commitOthers: "A mappa többi nem commitolt változása: a tiéd, egy másik beszélgetésé, vagy egy fájl, amelyet ennek a beszélgetésnek egy parancsa törölt, de semmi nem köti hozzá. Jelöld ki, amelyiket ez a commit is vigye.",
  commitConfirm: "A kijelölt fájlok commitolása egészben, ahogy most vannak. A commit a tiéd: a git-azonosítód, az aláírás és a hookok érvényesek. A ⌘Enter ugyanezt teszi.",
  changesByAgent: "Ennek a beszélgetésnek az ágense a szerkesztőeszközeivel módosította ezt a fájlt.",
  changesOpenInEditor: "A fájl megnyitása az első módosított soránál, a Beállítások › Beszélgetések alatt választott szerkesztőben.",
  editDiffStyle: "Az Egyesített egy oszlopban mutatja a régi és az új sorokat; az Osztott bal oldalon a régi, jobb oldalon az új változatot. Ez a böngésző megjegyzi.",
};

export const waitingHints: Messages["waitingHints"] = {
  permission: "Rád vár: az ágens arra vár, hogy jóváhagyj egy eszközt.",
  question: "Rád vár: az ágens kérdezett tőled valamit a vásznon.",
  finished: "Kész: a kör véget ért, amíg máshol jártál. A beszélgetés megnyitása törli a jelzést.",
  error: "Sikertelen: a kör hibával leállt, amíg máshol jártál. A beszélgetés megnyitása törli a jelzést.",
  unread: "Olvasatlan: megjelölted, hogy visszatérj hozzá. A beszélgetés megnyitása törli a jelzést.",
};

export const statusHints: Messages["statusHints"] = {
  idle: "Tétlen: a következő üzenetedre vár.",
  starting: "Indul: a host elindítja az ágensfolyamatot, vagy folytatja rajta a munkamenetet.",
  running: "Fut: az ágens az üzeneteden dolgozik. Az Esc vagy a Leállítás megszakítja a kört.",
  error: "Hiba: az ágens nem tudott elindulni vagy folytatni. A részletek a fejléc alatt vannak.",
};
