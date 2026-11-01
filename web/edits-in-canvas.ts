import { storedChoice } from "./stored-choice.ts";

/** Whether an edit the agent waits for permission to make shows its diff on the canvas, leaving a small card in the chat. */
const editsInCanvas = storedChoice<"on" | "off">("mirador-edits-in-canvas", ["on", "off"], "on");

export const useEditsInCanvas = () => editsInCanvas.use() === "on";
export const setEditsInCanvas = (on: boolean) => editsInCanvas.set(on ? "on" : "off");
