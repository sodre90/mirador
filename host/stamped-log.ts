import { stampConsoleLines } from "./timestamped-lines.ts";

if (!process.stdout.isTTY) stampConsoleLines();
