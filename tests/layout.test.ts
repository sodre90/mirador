import { expect, test } from "bun:test";
import {
  FACTORY_DEFAULT,
  arrangements,
  broughtWorkWidthIn,
  inView,
  isPaneLayout,
  layoutFrom,
  placement,
  sideChatHeightIn,
  sideChatWidthIn,
  sidebarWidthWithinLimits,
  swapPanes,
  toggledInView,
  type PaneId,
} from "../web/layout.ts";

const everything: Record<PaneId, boolean> = { conversation: true, canvas: true, terminals: true };
const layout = { ...layoutFrom(FACTORY_DEFAULT), leftShare: 0.4, topShare: 0.6 };

test("there are six arrangements of the three panes, the factory default among them", () => {
  expect(new Set(arrangements.map((slots) => slots.join())).size).toBe(6);
  expect(arrangements[0]).toEqual(FACTORY_DEFAULT.slots);
});

test("all three panes shown: conversation on the left, canvas over terminals, with both dividers", () => {
  expect(placement(layout, everything, null)).toEqual({
    columns: "minmax(0, 0.4fr) var(--splitter-width) minmax(0, 0.6fr)",
    rows: "minmax(0, 0.6fr) var(--splitter-width) minmax(0, 0.4fr)",
    areas: { conversation: "1 / 1 / 4 / 2", canvas: "1 / 3 / 2 / 4", terminals: "3 / 3 / 4 / 4" },
    columnDivider: "1 / 2 / 4 / 3",
    rowDivider: "2 / 3 / 3 / 4",
    topLeft: "conversation",
  });
});

test("the top-left pane is the left one, else the top one, else the bottom one, and a fullscreen pane covers them all", () => {
  expect(placement(layout, everything, "terminals").topLeft).toBe("terminals");
  const swapped = swapPanes(layout, "conversation", "terminals");
  expect(placement(swapped, everything, null).topLeft).toBe("terminals");
  expect(placement(swapped, { ...everything, terminals: false }, null).topLeft).toBe("canvas");
  expect(placement(swapped, { ...everything, terminals: false, canvas: false }, null).topLeft).toBe("conversation");
});

test("a hidden pane's tracks collapse while the others keep their areas", () => {
  const withoutCanvas = placement(layout, { ...everything, canvas: false }, null);
  expect(withoutCanvas.areas).toEqual({ conversation: "1 / 1 / 4 / 2", terminals: "3 / 3 / 4 / 4" });
  expect(withoutCanvas.rows).toBe("0 0 minmax(0, 1fr)");
  expect(withoutCanvas.rowDivider).toBeNull();

  const conversationOnly = placement(layout, { conversation: true, canvas: false, terminals: false }, null);
  expect(conversationOnly).toMatchObject({ columns: "minmax(0, 1fr) 0 0", columnDivider: null, rowDivider: null });
});

test("swapped onto the left, a pane that is then hidden leaves the right column the whole width", () => {
  const swapped = swapPanes(layout, "conversation", "canvas");
  expect(swapped.slots).toEqual(["canvas", "conversation", "terminals"]);
  const canvasHidden = placement(swapped, { ...everything, canvas: false }, null);
  expect(canvasHidden).toMatchObject({
    columns: "0 0 minmax(0, 1fr)",
    areas: { conversation: "1 / 3 / 2 / 4", terminals: "3 / 3 / 4 / 4" },
    columnDivider: null,
    rowDivider: "2 / 3 / 3 / 4",
  });
});

test("a fullscreen pane covers the whole area and the dividers go away; a hidden pane cannot be fullscreen", () => {
  const terminalsFullscreen = placement(layout, everything, "terminals");
  expect(terminalsFullscreen.areas.terminals).toBe("1 / 1 / 4 / 4");
  expect(terminalsFullscreen.areas.canvas).toBe("1 / 3 / 2 / 4");
  expect(terminalsFullscreen).toMatchObject({ columnDivider: null, rowDivider: null });
  expect(placement(layout, { ...everything, terminals: false }, "terminals").columnDivider).toBe("1 / 2 / 4 / 3");
});

test("a pane covered by another in fullscreen is not in view, and showing it leaves the fullscreen", () => {
  const allShown = { ...layout, hidden: { canvas: false, terminals: false } };
  const conversationFullscreen = { ...allShown, fullscreen: "conversation" as const };
  expect(inView(allShown, "canvas")).toBe(true);
  expect(inView(conversationFullscreen, "canvas")).toBe(false);
  expect(inView(conversationFullscreen, "terminals")).toBe(false);
  expect(toggledInView(conversationFullscreen, "canvas")).toMatchObject({ hidden: { canvas: false, terminals: false }, fullscreen: null });
  expect(inView({ ...allShown, fullscreen: "canvas" }, "canvas")).toBe(true);
  expect(toggledInView({ ...allShown, fullscreen: "canvas" }, "canvas").hidden.canvas).toBe(true);
});

test("a hidden pane's fullscreen covers nothing, as the workspace ignores it", () => {
  const hiddenTerminalsFullscreen = { ...layout, hidden: { canvas: false, terminals: true }, fullscreen: "terminals" as const };
  expect(inView(hiddenTerminalsFullscreen, "canvas")).toBe(true);
  expect(toggledInView(hiddenTerminalsFullscreen, "terminals")).toMatchObject({ hidden: { canvas: false, terminals: false }, fullscreen: null });
});

test("stored layouts are checked before use", () => {
  expect(isPaneLayout(layout)).toBe(true);
  expect(isPaneLayout({ ...layout, slots: ["conversation", "conversation", "canvas"] })).toBe(false);
  expect(isPaneLayout({ ...layout, leftShare: 1.5 })).toBe(false);
  expect(isPaneLayout({ ...layout, hidden: { canvas: true } })).toBe(false);
  expect(isPaneLayout({ ...layout, fullscreen: "canvas" })).toBe(true);
  expect(isPaneLayout({ ...layout, fullscreen: "sidebar" })).toBe(false);
  expect(isPaneLayout({ ...layout, fullscreen: undefined })).toBe(false);
  expect(isPaneLayout(null)).toBe(false);
});

test("the sidebar keeps between 180 and 480 pixels wide, in whole pixels", () => {
  expect(sidebarWidthWithinLimits(90)).toBe(180);
  expect(sidebarWidthWithinLimits(300.6)).toBe(301);
  expect(sidebarWidthWithinLimits(900)).toBe(480);
});

test("a side chat never dragged starts at 38% of the room beside the conversation, between 300 and 460 pixels", () => {
  expect(sideChatWidthIn(1000, null)).toBe(380);
  expect(sideChatWidthIn(760, null)).toBe(300);
  expect(sideChatWidthIn(1600, null)).toBe(460);
});

test("a dragged side chat keeps its width while it leaves the conversation 320 pixels and keeps 300 itself, and takes it back once the window grows", () => {
  expect(sideChatWidthIn(1200, 650.4)).toBe(650);
  expect(sideChatWidthIn(900, 650)).toBe(580);
  expect(sideChatWidthIn(1200, 120)).toBe(300);
  expect(sideChatWidthIn(1200, 1100)).toBe(880);
});

test("under the conversation, a side chat starts at half the height and leaves each of the two 160 pixels, or half of a box too low for that", () => {
  expect(sideChatHeightIn(800, null)).toBe(400);
  expect(sideChatHeightIn(800, 700)).toBe(640);
  expect(sideChatHeightIn(800, 40)).toBe(160);
  expect(sideChatHeightIn(240, 200)).toBe(120);
});

test("a brought agent's work drawer starts at 440 pixels, keeps a dragged width within 300 pixels and an 80-pixel margin, and recovers when the room grows", () => {
  expect(broughtWorkWidthIn(1200, null)).toBe(440);
  expect(broughtWorkWidthIn(1200, 720.4)).toBe(720);
  expect(broughtWorkWidthIn(760, 720)).toBe(680);
  expect(broughtWorkWidthIn(1200, 120)).toBe(300);
  expect(broughtWorkWidthIn(1200, 1180)).toBe(1120);
  expect(broughtWorkWidthIn(400, null)).toBe(320);
});
