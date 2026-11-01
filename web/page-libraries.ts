import type { PageLibraries } from "../shared/canvas-export.ts";
import { storedChoice } from "./stored-choice.ts";

const pageLibraries = storedChoice<PageLibraries>("mirador-page-libraries", ["cdn", "inline"], "cdn");

export const setPageLibraries = pageLibraries.set;
export const usePageLibraries = pageLibraries.use;
export const currentPageLibraries = pageLibraries.get;
