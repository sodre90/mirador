# Glossary

Mirador's Hungarian uses the informal *te* form ("Válaszd ki", "Kattints újra").
Its Spanish is neutral international Spanish in the *tú* form ("Elige", "Haz clic de nuevo"): no *vosotros*, and no
words only one region uses (*equipo*, not *ordenador* or *computadora*; *archivo*, not *fichero*; *durazno*, not *melocotón*).
Its Simplified Chinese (简体中文, code `zh`, tag `zh-Hans`) addresses the user as 你, not 您.
Its German addresses the user as *du*, not *Sie* ("Wähle ein Profil", "Klicke erneut").
These terms stay the same everywhere:

| English | Magyar | Español | 简体中文 | Deutsch |
| --- | --- | --- | --- | --- |
| agent | ágens | agente | Agent | Agent (den Agenten, die Agenten) |
| subagent | alágens | subagente | 子 Agent | Subagent |
| canvas | vászon | lienzo | 画布 | Canvas (der) |
| host | host | host | host | Host |
| workspace | munkaterület | espacio de trabajo | 工作区 | Arbeitsbereich |
| conversation | beszélgetés | conversación | 对话 | Unterhaltung |
| session | munkamenet | sesión | 会话 | Sitzung |
| profile | profil | perfil | 配置 | Profil |
| turn | kör | turno | 轮次 | Runde |
| tour | bejárás | recorrido | 导览 | Rundgang |
| review (code) | átnézés | revisión | 审查 | Review |
| prompt | prompt | prompt | 提示词 | Prompt |
| message box | üzenetmező | cuadro de mensaje | 消息框 | Nachrichtenfeld |
| terminal | terminál | terminal | 终端 | Terminal |
| plugin | bővítmény | plugin | 插件 | Plugin |
| palette | (parancs)paletta | paleta | 命令面板 | Befehlspalette |
| checklist | ellenőrzőlista | checklist (la) | 清单 | Checkliste |
| History (canvas) | Előzmények | Historial | 历史 | Verlauf |
| AI credits (Copilot's usage unit) | AI-kredit | créditos de IA | AI 积分 | KI-Credits |
| queue / queued | sor / sorba állított | cola / en cola | 队列 / 已排队 | Warteschlange / in der Warteschlange |
| device | készülék | dispositivo | 设备 | Gerät |
| machine | gép | máquina | 机器 | Rechner |
| computer | számítógép | equipo | 电脑 | Computer |
| rail | sáv | barra de máquinas | 机器栏 | Rechnerleiste |
| tool (agent's) | eszköz | herramienta | 工具 | Tool |
| approve / approval | jóváhagy / jóváhagyás | aprobar / aprobación | 批准 | genehmigen / Genehmigung |
| statusline | állapotsor | línea de estado | 状态栏 | Statuszeile |
| fork (a session) | elágaztatás | fork | Fork | forken / Fork |
| invite code / link | meghívókód / meghívólink | código / enlace de invitación | 邀请码 / 邀请链接 | Einladungscode / Einladungslink |
| keyboard shortcuts | billentyűparancsok | atajos de teclado | 键盘快捷键 | Tastenkürzel |
| Changes (canvas) | Változások | Cambios | 更改 | Änderungen |
| Point and ask | Mutass és kérdezz | Señala y pregunta | 指着问 | Zeigen und fragen |
| Dismiss | Elvetés | Descartar | 忽略 | Verwerfen |
| window (of its own) | ablak | ventana | 窗口 | Fenster |
| Settings | Beállítások | Configuración | 设置 | Einstellungen |
| Add / Remove / Delete | Hozzáadás / Eltávolítás / Törlés | Agregar / Quitar / Eliminar | 添加 / 移除 / 删除 | Hinzufügen / Entfernen / Löschen |
| uncommitted | nem commitolt | sin commit | 未提交 | nicht committet |
| effort (thinking) | erőfeszítés | esfuerzo | 思考强度 | Denkaufwand |
| go back / rewind (a turn) | visszalépés / visszatekerés | retroceder | 回退 | zurückspulen |
| unload (a model from memory) | kirakás | liberar (de la memoria) | 卸载 | entladen |
| delegated (task) | átadott | delegado | 已委派 | delegiert |
| phone | telefon | teléfono | 手机 | Handy |
| invite code (also a bare "code" in the join flow) | meghívókód | código de invitación | 邀请码 | Einladungscode |
| Voice on this Mac (the local engine) | Hang ezen a Macen | Voz en este Mac | 这台 Mac 上的语音 | Sprachfunktionen auf diesem Mac |

## Hungarian

Never attach a suffix or an article to a value filled in at runtime (a name, a version, a number):
vowel harmony and a/az can't be chosen in advance. Phrase around it, as in "Ezt futtatja: ${program}".
After a number, nouns stay singular: "3 fájl", "5 perc".

The Hungarian tooltips name these buttons and labels; translate the UI with the same words:
Leállítás, Kényszerített leállítás, Küldés, Szerkesztés, Előzmények, Ellenőrzőlista, Modell (menu), Mód,
Rád vár / Kész / Sikertelen / Olvasatlan, Gépek…, Csere, Egyesített / Osztott, Használat, Cím mentése,
Összes eltávolítása, Modellek ezen a Macen, „a körhöz csatlakozik” / „a kör után”.
The palette command "Elrendezés visszaállítása az alapértelmezettre" is `t.settings.layout.resetCommand`: reuse it.

The website (`site/words/hu.ts`) is written freely, the way Hungarian developers talk, not word for word. It keeps
the app's vászon, bővítmény, bejárás and munkamenet, but says agent, coding agent, review, build, mockup and diff in
English with Hungarian suffixes. Its feature kickers are verbs: Rajzol / Kérdez / Végigvezet / Átnéz.

## Spanish

Don't put an article or a gendered word in front of a value filled in at runtime (a name, a file, a version): its
gender can't be known in advance. Phrase around it, as in "Ejecuta: ${program}". Nouns after a number take the plural
unless the number is 1, as in English: use the `plural` helper the English file uses.
Button and menu labels are infinitives or nouns ("Enviar", "Detener", "Historial"), not imperatives; sentences that
tell the user what to do use *tú* imperatives ("Elige un perfil").
"Terminal" is feminine: *la terminal*, *las terminales*. Keys keep their English names (Enter, Tab, Esc), not *Intro*.
Sentence case, as in English. Spanish punctuation: ¿…? and ¡…!.

The Spanish tooltips name these buttons and labels; translate the UI with the same words:
Esperándote / Listo / Falló / No leída, Usar esta, Guardar dirección, Quitar todo, Modelos en este Mac, Intercambiar,
Modelo (menu), Modo.

## Chinese

Full-width punctuation in Chinese text (，。：？！), “” for quotes and … for an ellipsis; a space between Chinese and Latin
words or numbers ("3 个文件", "打开 Mirador"). Chinese has no plural: drop the English `plural` helper. Values filled
in at runtime need no grammar around them, but keep each sentence natural with the value where Chinese puts it.
Button and menu labels are short verbs or nouns ("发送", "停止", "历史"). Keys keep their English names (Enter, Tab, Esc).
Mirador, Claude Code, opencode, pi, Codex, Copilot, Antigravity, git, Tailscale and other product names stay as they are.

## German

Don't put an article, a case ending or a gendered word in front of a value filled in at runtime (a name, a file, a
version): its gender can't be known in advance. Phrase around it, as in "Führt aus: ${program}". Nouns after a number
take the plural unless the number is 1, as in English: use the `plural` helper the English file uses.
Button and menu labels are infinitives or nouns ("Senden", "Stoppen", "Verlauf"), not imperatives; sentences that tell
the user what to do use *du* imperatives ("Wähle ein Profil"). Sentence case as in English, but nouns keep their
capital letter. „…“ for quotes. Keys keep their English names (Enter, Tab, Esc), not *Eingabe*.
Developer words stay English where German developers use them: commit, branch, Prompt, Tool, Plugin, Review, Token.

The German tooltips name these buttons and labels; translate the UI with the same words:
Stoppen, Stoppen erzwingen, Senden, Bearbeiten, Verlauf, Checkliste, Modell (menu), Modus,
Wartet auf dich / Fertig / Fehlgeschlagen / Ungelesen, Rechner…, Tauschen, Vereint / Geteilt, Nutzung,
Adresse speichern, Alle entfernen, Modelle auf diesem Mac, „schließt sich der Runde an“ / „nach der Runde“.
The palette command "Layout auf Standard zurücksetzen" is `t.settings.layout.resetCommand`: reuse it.

## Every language

The website (`site/words/`) is marketing copy, written freely in each language the way its developers talk, not word
for word. Unlike the app, it keeps developer words English where developers say them in English (canvas, diff, commit,
build, pull request, plugin, review), so its words can differ from the table above.

Spoken command words stay English, as the voice parser only knows those: “stop”, “repeat that”, “help”, “yes”,
“the others”, “thanks”. So do option names the agent sends, such as its “allow” option.
