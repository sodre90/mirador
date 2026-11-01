import { hostname } from "node:os";

/** The computer's own name, which the machine goes by until Settings give it another. */
export const computerName = () => hostname().replace(/\.local$/, "");
