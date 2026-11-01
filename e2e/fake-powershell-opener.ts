/** Stands in for powershell.exe on Windows, compiled by writeCompiledBunProgram: it notes the file Invoke-Item was given, and fails for an .unclaimed one. */
import { appendFileSync } from "node:fs";
appendFileSync(process.env.MIRADOR_OPENED_LOG!, `${process.env.MIRADOR_OPEN_FILE}\n`);
if (process.env.MIRADOR_OPEN_FILE!.endsWith(".unclaimed")) process.exit(1);
