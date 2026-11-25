import { TAKEN } from "../host/sandbox/vm-connections.ts";

/** What a VM's relay passes on of all Mirador said so far on a connection: what comes after the byte that says it was taken. */
export const pastTaken = (said: string) => (said.startsWith(TAKEN) ? said.slice(TAKEN.length) : said);
