/** Assembles the website from site/ and the README's screenshots and icons, into the folder given (site-build/ by default): English at the root, each other language in a folder of its own. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES, languageNames, languageTags, type Language } from "../shared/i18n/languages.ts";
import { de } from "../site/words/de.ts";
import { en, type SiteWords } from "../site/words/en.ts";
import { es } from "../site/words/es.ts";
import { hu } from "../site/words/hu.ts";
import { zh } from "../site/words/zh.ts";

const SITE = "https://mirador.sodre90.com/";
const LANGUAGE_KEY = "mirador-site-language";
const SUGGESTED_KEY = "mirador-site-suggested";
const PAGES = ["index.html", "privacy.html"] as const;
type Page = (typeof PAGES)[number];

const wordsIn: Record<Language, SiteWords> = { en, hu, es, zh, de };

const folderOf = (language: Language) => (language === "en" ? "" : `${language}/`);
const rootFrom = (language: Language) => (language === "en" ? "" : "../");
const pagePath = (language: Language, page: Page) => folderOf(language) + (page === "index.html" ? "" : page);

const escapeAttribute = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function wordAt(words: SiteWords, key: string): string {
  const value = key.split(".").reduce<unknown>((entry, part) => (entry as Record<string, unknown> | undefined)?.[part], words);
  if (typeof value !== "string") throw new Error(`No text for {{${key}}}`);
  return key.startsWith("attributes.") ? escapeAttribute(value) : value;
}

function languagePicker(language: Language, page: Page) {
  const links = LANGUAGES.map((other) => {
    const href = rootFrom(language) + pagePath(other, page) || "./";
    const current = other === language ? ' aria-current="page"' : "";
    return `<li><a href="${href}" hreflang="${languageTags[other]}" lang="${languageTags[other]}" data-language="${other}"${current}>${languageNames[other]}</a></li>`;
  });
  return `<details class="languages"><summary aria-label="${wordAt(wordsIn[language], "attributes.language")}">${languageNames[language]}</summary><ul>${links.join("")}</ul></details>`;
}

const alternates = (page: Page) =>
  [
    ...LANGUAGES.map((other) => `<link rel="alternate" hreflang="${languageTags[other]}" href="${SITE}${pagePath(other, page)}">`),
    `<link rel="alternate" hreflang="x-default" href="${SITE}${pagePath("en", page)}">`,
  ].join("\n  ");

const rememberPickedLanguage = `
  <script>
    for (const link of document.querySelectorAll(".languages a")) {
      link.addEventListener("click", () => {
        try { localStorage.setItem(${JSON.stringify(LANGUAGE_KEY)}, link.dataset.language); } catch {}
      });
    }
  </script>`;

/**
 * On the English home page only, before it paints: a visitor who picked a language goes to it;
 * one who never did, arriving from elsewhere, goes once to the first of their browser's languages the site has.
 */
const goToVisitorsLanguage = `
  <script>
    (() => {
      const languages = ${JSON.stringify(LANGUAGES)};
      const stored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
      const go = (language) => location.replace(language + "/" + location.search + location.hash);
      const picked = stored(${JSON.stringify(LANGUAGE_KEY)});
      if (languages.includes(picked)) {
        if (picked !== "en") go(picked);
        return;
      }
      const fromThisSite = document.referrer !== "" && new URL(document.referrer).origin === location.origin;
      if (fromThisSite || stored(${JSON.stringify(SUGGESTED_KEY)})) return;
      const ofTag = (tag) => {
        const lowered = tag.toLowerCase();
        if (lowered === "zh" || lowered.startsWith("zh-")) return /^zh-(hant|tw|hk|mo)\\b/.test(lowered) ? null : "zh";
        const primary = lowered.split("-")[0];
        return languages.includes(primary) ? primary : null;
      };
      const browsers = (navigator.languages ?? [navigator.language]).map(ofTag).find((language) => language !== null) ?? "en";
      if (browsers === "en") return;
      try { localStorage.setItem(${JSON.stringify(SUGGESTED_KEY)}, browsers); } catch {}
      go(browsers);
    })();
  </script>`;

function render(template: string, language: Language, page: Page) {
  const words = wordsIn[language];
  const special: Record<string, string> = {
    lang: languageTags[language],
    root: rootFrom(language),
    canonical: SITE + pagePath(language, page),
    alternates: alternates(page),
    picker: languagePicker(language, page),
    englishPrevails: language === "en" ? "" : `\n      <p class="translation-note">${words.privacy.englishPrevails}</p>`,
    redirect: language === "en" && page === "index.html" ? goToVisitorsLanguage : "",
    scripts: rememberPickedLanguage + "\n",
  };
  return template.replace(/\{\{(@?)([\w.]+)\}\}/g, (_, isSpecial: string, key: string) => {
    if (!isSpecial) return wordAt(words, key);
    if (!(key in special)) throw new Error(`No value for {{@${key}}}`);
    return special[key]!;
  });
}

const repo = join(import.meta.dir, "..");
const out = process.argv[2] ?? join(repo, "site-build");

rmSync(out, { recursive: true, force: true });
cpSync(join(repo, "site"), out, { recursive: true, filter: (source) => ![join(repo, "site", "words"), ...PAGES.map((page) => join(repo, "site", page))].includes(source) });
cpSync(join(repo, "docs/screenshots"), join(out, "screenshots"), { recursive: true });
cpSync(join(repo, "desktop/assets/app-icon.svg"), join(out, "icon.svg"));
cpSync(join(repo, "web/favicon.svg"), join(out, "favicon.svg"));
for (const language of LANGUAGES) {
  mkdirSync(join(out, folderOf(language)), { recursive: true });
  for (const page of PAGES) writeFileSync(join(out, folderOf(language), page), render(readFileSync(join(repo, "site", page), "utf8"), language, page));
}
console.log(out);
