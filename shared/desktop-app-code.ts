import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ENTRY = "src/bun/index.ts";

const transpiler = new Bun.Transpiler({ loader: "ts" });

const isRelative = (path: string) => path.startsWith("./") || path.startsWith("../");

/**
 * Names the code the desktop app in `desktopDirectory` runs: the files its entry reaches, as they run, without types and
 * comments. The app is built with it and tells the host, which can then tell when the checkout moved past the app.
 */
export function desktopAppCode(desktopDirectory: string): string | null {
  const directory = resolve(desktopDirectory);
  const entry = join(directory, ENTRY);
  if (!existsSync(entry)) return null;
  const hash = new Bun.CryptoHasher("sha256");
  [...runningCodeReachableFrom(entry)]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([path, code]) => hash.update(`${relative(directory, path)}\0${code}\0`));
  return hash.digest("hex").slice(0, 16);
}

function runningCodeReachableFrom(entry: string) {
  const codeByPath = new Map<string, string>();
  const visit = (path: string) => {
    if (codeByPath.has(path)) return;
    const code = transpiler.transformSync(readFileSync(path, "utf8"));
    codeByPath.set(path, code);
    transpiler
      .scanImports(code)
      .map((imported) => imported.path)
      .filter(isRelative)
      .forEach((imported) => visit(Bun.resolveSync(imported, dirname(path))));
  };
  visit(entry);
  return codeByPath;
}

if (import.meta.main) console.log(desktopAppCode(process.argv[2]!) ?? "");
