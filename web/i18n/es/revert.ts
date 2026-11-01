import type { Messages } from "../en/index.ts";

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const revert: Messages["revert"] = {
  rewindToHere: "Retroceder hasta aquí",
  undoFiles: "Deshacer archivos",
  undoTheFiles: "Deshacer los archivos",
  undoTheFilesOfATurn: "Deshacer los archivos de un turno",
  rewindBefore: (turn) => `Retroceder a antes de “${turn}”`,
  undoTheFilesOf: (turn) => `Deshacer los archivos de “${turn}”`,
  checking: "Comprobando qué cambiaría…",
  putFilesBackToo: "Restaurar también los archivos",
  cancel: "Cancelar",
  goingBack: "Retrocediendo…",
  puttingFilesBack: "Restaurando los archivos…",
  rewind: "Retroceder",
  putFilesBack: "Restaurar los archivos",
  showFiles: "Mostrar los archivos",
  hideFiles: "Ocultar los archivos",
  deleted: "Se eliminan",
  putBackAsTheyWere: "Vuelven a como estaban",
  stayAsTheyAre: "Se quedan como están",
  stayAsCommitted: "Se quedan como en el commit",
  andMore: (count) => `y ${count} más`,
  turnsLeave: (turns, keptFrom) =>
    `${turns === 1 ? "1 turno sale" : `${turns} turnos salen`} de la conversación, y el historial propio del agente retrocede con ${turns === 1 ? "él" : "ellos"}, hasta antes de “${keptFrom}”.`,
  everyTurnLeaves: "Todos los turnos salen de la conversación y el agente empieza de cero, sin nada de ella.",
  filesStayBecause: (note) => `Los archivos se quedan como están: ${note}`,
  filesStayNow: "Los archivos se quedan como están ahora, con lo que les hicieron los turnos que salen.",
  filesGoBackToo: (changed) => `Los archivos también vuelven a como estaban al empezar este turno: ${changed}.`,
  filesGoBack: (changed) => `Los archivos vuelven a como estaban al empezar este turno: ${changed}.`,
  noOtherFileChanged: "Ningún otro archivo ha cambiado desde que empezó este turno.",
  noFileChanged: "Ningún archivo ha cambiado desde que empezó este turno.",
  turnStays: "El turno de arriba se queda en la conversación, y al agente se le avisa de que los archivos ya no lo reflejan.",
  restored: (count) => counted(count, "archivo vuelve a como estaba", "archivos vuelven a como estaban"),
  removed: (count) => counted(count, "archivo creado desde entonces se elimina", "archivos creados desde entonces se eliminan"),
  both: (first, second) => `${first} y ${second}`,
  noOtherFileDifferent: "ningún otro archivo era distinto",
  noFileDifferent: "ningún archivo era distinto",
  headMoved: (files) =>
    `Desde entonces HEAD pasó a otro commit, y ${files === 1 ? "1 archivo que difiere allí se queda" : `${files} archivos que difieren allí se quedan`} como ${files === 1 ? "está" : "están"}.`,
  commitsCameIn: (commits, files) =>
    `Desde entonces ${commits === 1 ? "llegó 1 commit" : `llegaron ${commits} commits`}, y ${files === 1 ? "1 archivo que cambió se queda" : `${files} archivos que cambiaron se quedan`} como en el commit.`,
  theFileWasEdited: "Después también se editó, y conserva esas ediciones.",
  someWereEdited: (edited) =>
    `${edited === 1 ? "1 de ellos se editó" : `${edited} de ellos se editaron`} también después, y ${edited === 1 ? "conserva" : "conservan"} esas ediciones.`,
  submodulesLeft: (count) =>
    `${count === 1 ? "1 submódulo que cambió se queda" : `${count} submódulos que cambiaron se quedan`} como ${count === 1 ? "está" : "están"} ahora: los archivos de un submódulo pertenecen a su propio repositorio, así que Mirador no los restaura.`,
};
