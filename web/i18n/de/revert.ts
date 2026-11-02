import type { Messages } from "../en/index.ts";

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const revert: Messages["revert"] = {
  rewindToHere: "Bis hierher zurückspulen",
  undoFiles: "Dateien zurücksetzen",
  undoTheFiles: "Die Dateien zurücksetzen",
  undoTheFilesOfATurn: "Die Dateien einer Runde zurücksetzen",
  rewindBefore: (turn) => `Zurückspulen bis vor „${turn}“`,
  undoTheFilesOf: (turn) => `Die Dateien von „${turn}“ zurücksetzen`,
  checking: "Wird geprüft, was sich ändern würde…",
  putFilesBackToo: "Auch die Dateien zurücksetzen",
  cancel: "Abbrechen",
  goingBack: "Wird zurückgespult…",
  puttingFilesBack: "Dateien werden zurückgesetzt…",
  rewind: "Zurückspulen",
  putFilesBack: "Dateien zurücksetzen",
  showFiles: "Dateien zeigen",
  hideFiles: "Dateien ausblenden",
  deleted: "Werden gelöscht",
  putBackAsTheyWere: "Werden wiederhergestellt",
  stayAsTheyAre: "Bleiben, wie sie sind",
  stayAsCommitted: "Bleiben wie committet",
  andMore: (count) => `und ${count} weitere`,
  turnsLeave: (turns, keptFrom) =>
    `${turns === 1 ? "1 Runde verschwindet" : `${turns} Runden verschwinden`} aus der Unterhaltung, und der eigene Verlauf des Agenten geht mit ${turns === 1 ? "ihr" : "ihnen"} zurück, bis vor „${keptFrom}“.`,
  everyTurnLeaves: "Alle Runden verschwinden aus der Unterhaltung, und der Agent fängt ohne etwas davon neu an.",
  filesStayBecause: (note) => `Die Dateien bleiben, wie sie sind: ${note}`,
  filesStayNow: "Die Dateien bleiben, wie sie jetzt sind, mit dem, was die entfernten Runden an ihnen geändert haben.",
  filesGoBackToo: (changed) => `Auch die Dateien gehen auf den Stand zurück, den sie zu Beginn dieser Runde hatten: ${changed}.`,
  filesGoBack: (changed) => `Die Dateien gehen auf den Stand zurück, den sie zu Beginn dieser Runde hatten: ${changed}.`,
  noOtherFileChanged: "Seit Beginn dieser Runde hat sich keine andere Datei geändert.",
  noFileChanged: "Seit Beginn dieser Runde hat sich keine Datei geändert.",
  turnStays: "Die Runde oben bleibt in der Unterhaltung, und der Agent erfährt, dass die Dateien sie nicht mehr enthalten.",
  restored: (count) => counted(count, "Datei wiederhergestellt", "Dateien wiederhergestellt"),
  removed: (count) => counted(count, "seitdem erstellte Datei gelöscht", "seitdem erstellte Dateien gelöscht"),
  both: (first, second) => `${first} und ${second}`,
  noOtherFileDifferent: "keine andere Datei war anders",
  noFileDifferent: "keine Datei war anders",
  headMoved: (files) =>
    `HEAD ist seitdem auf einen anderen Commit gewechselt, und ${files === 1 ? "1 Datei, die dort abweicht, bleibt, wie sie ist" : `${files} Dateien, die dort abweichen, bleiben, wie sie sind`}.`,
  commitsCameIn: (commits, files) =>
    `Seitdem ${commits === 1 ? "kam 1 Commit" : `kamen ${commits} Commits`} hinzu, und ${files === 1 ? "1 Datei, die dabei geändert wurde, bleibt" : `${files} Dateien, die dabei geändert wurden, bleiben`} wie committet.`,
  theFileWasEdited: "Sie wurde danach auch bearbeitet und behält diese Änderungen.",
  someWereEdited: (edited) =>
    `${edited === 1 ? "1 davon wurde" : `${edited} davon wurden`} danach auch bearbeitet und ${edited === 1 ? "behält" : "behalten"} diese Änderungen.`,
  submodulesLeft: (count) =>
    `${count === 1 ? "1 geändertes Submodul bleibt, wie es" : `${count} geänderte Submodule bleiben, wie sie`} jetzt ${count === 1 ? "ist" : "sind"}: Die Dateien eines Submoduls gehören zu dessen eigenem Repository, daher setzt Mirador sie nicht zurück.`,
};
