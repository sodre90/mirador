# Glossary

Mirador's Hungarian uses the informal *te* form ("Válaszd ki", "Kattints újra").
Its Spanish is neutral international Spanish in the *tú* form ("Elige", "Haz clic de nuevo"): no *vosotros*, and no
words only one region uses (*equipo*, not *ordenador* or *computadora*; *archivo*, not *fichero*; *durazno*, not *melocotón*).
Its Simplified Chinese (简体中文, code `zh`, tag `zh-Hans`) addresses the user as 你, not 您.
These terms stay the same everywhere:

| English | Magyar | Español | 简体中文 |
| --- | --- | --- | --- |
| agent | ágens | agente | 智能体 |
| subagent | alágens | subagente | 子智能体 |
| canvas | vászon | lienzo | 画布 |
| host | host | host | host |
| workspace | munkaterület | espacio de trabajo | 工作区 |
| conversation | beszélgetés | conversación | 对话 |
| session | munkamenet | sesión | 会话 |
| profile | profil | perfil | 配置 |
| turn | kör | turno | 轮次 |
| tour | bejárás | recorrido | 导览 |
| review (code) | átnézés | revisión | 审查 |
| prompt | prompt | prompt | 提示词 |
| message box | üzenetmező | cuadro de mensaje | 消息框 |
| terminal | terminál | terminal | 终端 |
| plugin | bővítmény | complemento | 插件 |
| palette | (parancs)paletta | paleta | 命令面板 |
| checklist | ellenőrzőlista | lista de verificación | 清单 |
| History (canvas) | Előzmények | Historial | 历史 |
| queue / queued | sor / sorba állított | cola / en cola | 队列 / 已排队 |
| device | készülék | dispositivo | 设备 |
| machine | gép | máquina | 机器 |
| computer | számítógép | equipo | 电脑 |
| rail | sáv | barra de máquinas | 机器栏 |
| tool (agent's) | eszköz | herramienta | 工具 |
| approve / approval | jóváhagy / jóváhagyás | aprobar / aprobación | 批准 |
| statusline | állapotsor | línea de estado | 状态栏 |
| fork (a session) | elágaztatás | bifurcar | 分叉 |
| invite code / link | meghívókód / meghívólink | código / enlace de invitación | 邀请码 / 邀请链接 |
| keyboard shortcuts | billentyűparancsok | atajos de teclado | 键盘快捷键 |
| Changes (canvas) | Változások | Cambios | 更改 |
| Point and ask | Mutass és kérdezz | Señala y pregunta | 指着问 |
| Dismiss | Elvetés | Descartar | 忽略 |
| window (of its own) | ablak | ventana | 窗口 |
| Settings | Beállítások | Configuración | 设置 |
| Add / Remove / Delete | Hozzáadás / Eltávolítás / Törlés | Agregar / Quitar / Eliminar | 添加 / 移除 / 删除 |
| uncommitted | nem commitolt | sin confirmar | 未提交 |
| effort (thinking) | erőfeszítés | esfuerzo | 思考强度 |

## Hungarian

Never attach a suffix or an article to a value filled in at runtime (a name, a version, a number):
vowel harmony and a/az can't be chosen in advance. Phrase around it, as in "Ezt futtatja: ${program}".
After a number, nouns stay singular: "3 fájl", "5 perc".

The Hungarian tooltips name these buttons and labels; translate the UI with the same words:
Leállítás, Kényszerített leállítás, Küldés, Szerkesztés, Előzmények, Ellenőrzőlista, Modell (menu), Mód,
Rád vár / Kész / Sikertelen / Olvasatlan, Gépek…, Csere, Egyesített / Osztott, Használat, Cím mentése,
Összes eltávolítása, Modellek ezen a Macen, „a körhöz csatlakozik” / „a kör után”.
The palette command "Elrendezés visszaállítása az alapértelmezettre" is `t.settings.layout.resetCommand`: reuse it.

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
Mirador, Claude Code, opencode, pi, git, Tailscale and other product names stay as they are.

## Every language

Spoken command words stay English, as the voice parser only knows those: “stop”, “repeat that”, “help”, “yes”,
“the others”, “thanks”. So do option names the agent sends, such as its “allow” option.
