import type { Messages } from "../en/index.ts";
import { canvas } from "./canvas.ts";
import { chat } from "./chat.ts";
import { dictation } from "./dictation.ts";
import { hints, statusHints, waitingHints } from "./hints.ts";
import { labels } from "./labels.ts";
import { revert } from "./revert.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { terminals } from "./terminals.ts";
import { devices } from "./devices.ts";
import { voice } from "./voice.ts";
import { profiles } from "./profiles.ts";
import { plugins } from "./plugins.ts";
import { desktop } from "./desktop.ts";

export const es: Messages = { hints, waitingHints, statusHints, labels, settings, chat, revert, dictation, shell, canvas, terminals, devices, voice, profiles, plugins, desktop };
