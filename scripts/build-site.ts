/** Assembles the website from site/ and the README's screenshots and icons, into the folder given (site-build/ by default). */
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const out = process.argv[2] ?? join(repo, "site-build");

rmSync(out, { recursive: true, force: true });
cpSync(join(repo, "site"), out, { recursive: true });
cpSync(join(repo, "docs/screenshots"), join(out, "screenshots"), { recursive: true });
cpSync(join(repo, "desktop/assets/app-icon.svg"), join(out, "icon.svg"));
cpSync(join(repo, "web/favicon.svg"), join(out, "favicon.svg"));
console.log(out);
