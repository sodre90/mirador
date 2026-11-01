/** Stands in for a text editor on Windows, compiled by writeCompiledBunProgram: it notes its name and the file it was given. */
import { appendFileSync } from "node:fs";
appendFileSync(process.env.MIRADOR_OPENED_LOG!, `${process.env.MIRADOR_EDITOR_NAME} ${process.argv.slice(2).join(" ")}\n`);
