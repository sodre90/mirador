import { cc, CString, dlopen, JSCallback, type Pointer, read } from "bun:ffi";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopSpellCheck } from "../../../shared/desktop-menu.ts";
import { dictionaryLanguages, languagesToCheck, systemDictionaries } from "../core/spell-check.ts";

/**
 * Electrobun runs GTK's main loop on the process's main thread and this code in a worker, and WebKitGTK may only be
 * called from the main thread. So the calls are made by C that the GLib loop runs from an idle callback, which no
 * JavaScript takes part in: the worker only hands it the languages. It gets every function as a pointer, so no
 * development symlink of a library is needed to build it.
 */
const HELPER_SOURCE = `
typedef int gboolean;
typedef void *gpointer;
typedef gboolean (*SourceFunc)(gpointer);
static unsigned int (*idle_add)(SourceFunc, gpointer);
static void *(*malloc0)(unsigned long);
static void (*gfree)(void *);
static char **(*strsplit)(const char *, const char *, int);
static void (*strfreev)(char **);
static void *(*get_default)(void);
static void (*set_enabled)(void *, gboolean);
static void (*set_languages)(void *, char **);

struct job { char **languages; gboolean enabled; };

void setup(void *a, void *b, void *c, void *d, void *e, void *f, void *g, void *h) {
  idle_add = a; malloc0 = b; gfree = c; strsplit = d; strfreev = e; get_default = f; set_enabled = g; set_languages = h;
}

static gboolean run(gpointer data) {
  struct job *job = data;
  void *context = get_default();
  set_languages(context, job->languages);
  set_enabled(context, job->enabled);
  strfreev(job->languages);
  gfree(job);
  return 0;
}

int schedule(int enabled, const char *languages) {
  struct job *job = malloc0(sizeof *job);
  job->languages = strsplit(languages, ",", -1);
  job->enabled = enabled;
  return idle_add(run, job) != 0;
}
`;

const pointerOnly = { args: [], returns: "void" } as const;

/** Bun gives a symbol loaded without a signature its address as `ptr`, which its typings leave out. */
const addressOf = (symbol: unknown) => (symbol as { ptr: number }).ptr;

function compileHelper() {
  const directory = mkdtempSync(join(tmpdir(), "mirador-spell-check-"));
  try {
    const source = join(directory, "spell-check.c");
    writeFileSync(source, HELPER_SOURCE, { mode: 0o600 });
    return cc({
      source,
      // The C uses no libc, and Bun's own link of it needs libc6-dev, which many systems lack.
      flags: "-nostdlib",
      symbols: {
        setup: { args: Array(8).fill("ptr"), returns: "void" },
        schedule: { args: ["i32", "ptr"], returns: "i32" },
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function enchantLanguages() {
  const enchant = dlopen("libenchant-2.so.2", {
    enchant_broker_init: { args: [], returns: "ptr" },
    enchant_broker_list_dicts: { args: ["ptr", "function", "ptr"], returns: "void" },
    enchant_broker_free: { args: ["ptr"], returns: "void" },
  });
  const tags: string[] = [];
  const collect = new JSCallback((tag) => void tags.push(String(new CString(tag!))), { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "void" });
  const broker = enchant.symbols.enchant_broker_init();
  try {
    enchant.symbols.enchant_broker_list_dicts(broker, collect.ptr, null);
  } finally {
    enchant.symbols.enchant_broker_free(broker);
    collect.close();
  }
  return dictionaryLanguages(tags);
}

/** GLib's `g_get_language_names()`: the locale's names, most specific first, as `fr_FR.UTF-8`, `fr_FR`, `fr`, `C`. */
function systemLanguageNames(list: Pointer | null) {
  const names: string[] = [];
  if (!list) return names;
  for (let index = 0; index < 64; index++) {
    const name = read.ptr(list, index * 8);
    if (!name) break;
    names.push(String(new CString(name)));
  }
  return names;
}

export interface LinuxSpellChecker {
  /** The dictionaries the system has, as Enchant tags. */
  languages: string[];
  apply(spellCheck: DesktopSpellCheck): void;
}

/** Null, after saying why, when this system lacks what it needs; spell checking is then whatever WebKitGTK does by itself. */
export function linuxSpellChecker(): LinuxSpellChecker | null {
  try {
    const glib = dlopen("libglib-2.0.so.0", { g_idle_add: pointerOnly, g_malloc0: pointerOnly, g_free: pointerOnly, g_strsplit: pointerOnly, g_strfreev: pointerOnly, g_get_language_names: { args: [], returns: "ptr" } });
    const webkit = dlopen("libwebkit2gtk-4.1.so.0", {
      webkit_web_context_get_default: pointerOnly,
      webkit_web_context_set_spell_checking_enabled: pointerOnly,
      webkit_web_context_set_spell_checking_languages: pointerOnly,
    });
    const languages = enchantLanguages();
    const systemLanguages = systemLanguageNames(glib.symbols.g_get_language_names() as Pointer | null);
    const helper = compileHelper();
    const g = glib.symbols;
    const w = webkit.symbols;
    helper.symbols.setup(
      addressOf(g.g_idle_add),
      addressOf(g.g_malloc0),
      addressOf(g.g_free),
      addressOf(g.g_strsplit),
      addressOf(g.g_strfreev),
      addressOf(w.webkit_web_context_get_default),
      addressOf(w.webkit_web_context_set_spell_checking_enabled),
      addressOf(w.webkit_web_context_set_spell_checking_languages),
    );
    return {
      languages,
      apply(spellCheck) {
        try {
          let chosen = languagesToCheck(spellCheck.languages, languages);
          if (chosen.length === 0) chosen = systemDictionaries(systemLanguages, languages);
          // With no dictionary to name, WebKit would fall back to whichever Enchant lists first.
          const enabled = spellCheck.enabled && chosen.length > 0;
          helper.symbols.schedule(enabled ? 1 : 0, Buffer.from(`${chosen.join(",")}\0`, "utf8"));
        } catch (error) {
          console.error("Could not apply spell checking:", error);
        }
      },
    };
  } catch (error) {
    console.error("Spell checking languages unavailable:", error);
    return null;
  }
}
