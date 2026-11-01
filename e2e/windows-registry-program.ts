/** Run with Bun: prints the program named first that a Windows host finds on the PATH the registry holds, or nothing. */
import { currentPath } from "../host/current-path.ts";

console.log(Bun.which(process.argv[2]!, { PATH: currentPath("") }) ?? "");
