import type { Messages } from "../en/index.ts";

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const listed = (...parts: (string | false)[]) => parts.filter(Boolean).join(", ");

export const rooms: Messages["rooms"] = {
  rooms: "Räume",
  newRoom: "Neuer Raum",
  roomSettings: (room) => `Einstellungen von ${room}`,
  editRoom: "Raumeinstellungen",
  name: "Name des Raums",
  workspace: "Arbeitsbereich",
  workspaceHint: "Die Agenten des Raums arbeiten hier.",
  agents: "Agenten",
  agentsHint: "Eine Nachricht erreicht einen Agenten nur, wenn sie ihn mit @ markiert.",
  noProfiles: "Lege zuerst ein Profil an, damit der Raum einen Agenten hat.",
  create: "Raum anlegen",
  save: "Speichern",
  cancel: "Abbrechen",
  deleteRoom: "Raum löschen",
  deleteArmed: "Endgültig löschen?",
  deleteHint: "Löscht den Raum, seine Nachrichten und die Unterhaltungen seiner Agenten darin.",
  deleteArmedHint: "Klicke erneut, um den Raum zu löschen.",
  loading: "Wird geladen…",
  empty: "Noch hat niemand etwas geschrieben. Markiere einen Agenten mit @, um ihm eine Aufgabe zu geben.",
  placeholder: (room) => `Schreib in ${room}, @ markiert einen Agenten…`,
  followUpPlaceholder: (agent) => `Schreib ${agent} noch etwas…`,
  send: "Senden",
  tagMenu: "Agenten des Raums",
  working: (agent) => `${agent} arbeitet…`,
  waiting: (agent) => `${agent} antwortet nach seiner aktuellen Aufgabe.`,
  openThread: "Thread öffnen",
  thread: (agent) => `Thread von ${agent}`,
  closeThread: "Thread schließen",
  stopped: "Vor dem Ende angehalten.",
  failed: "Die Runde ist fehlgeschlagen.",
  noAnswer: "Ohne Antwort in Worten beendet.",
  agentGone: "Ein Agent, der nicht mehr im Raum ist",
  tagged: (agents) => `Hat ${agents} markiert`,
  tagsDropped: (agents, turns) =>
    `Nicht markiert: ${agents}. Die Agenten wurden angehalten, da sie sich ${turns}-mal gegenseitig markiert haben, seit ein Mensch geschrieben hat. Markiere einen mit @, um weiterzumachen.`,
  madeOnCanvas: (pages, questions) => `Im Canvas: ${listed(pages > 0 && counted(pages, "Seite", "Seiten"), questions > 0 && counted(questions, "Frage", "Fragen"))}`,
  openOnCanvas: "Im Canvas öffnen",
};
