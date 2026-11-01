import { Easing, interpolate } from "remotion";
import type { CameraKey, ClipInfo, ClipScene, Rect } from "./timeline.ts";
import { sceneSecondsOf } from "./timeline.ts";

export const APP = { width: 1536, height: 864 };

/** The part of the app the camera frames, by its centre and width; its height follows from the app's 16:9. */
type View = { centerX: number; centerY: number; width: number };

const WHOLE_APP: View = { centerX: APP.width / 2, centerY: APP.height / 2, width: APP.width };

/** How long the camera takes to move from one view to the next. */
const MOVE_SECONDS = 1.1;

const easeCamera = Easing.bezier(0.5, 0, 0.15, 1);

/** A box framed with some room around it, or at a given zoom around its centre, kept inside the app. */
function viewOf(rect: Rect | undefined, zoom: number | undefined): View {
  if (!rect) return WHOLE_APP;
  const roomy = Math.max(rect.width * 1.12, (rect.height * 1.12 * APP.width) / APP.height);
  const width = Math.min(APP.width, zoom ? APP.width / zoom : roomy);
  const height = (width * APP.height) / APP.width;
  const clamp = (value: number, size: number, total: number) => Math.min(total - size / 2, Math.max(size / 2, value));
  return { centerX: clamp(rect.x + rect.width / 2, width, APP.width), centerY: clamp(rect.y + rect.height / 2, height, APP.height), width };
}

function viewForKey(key: CameraKey, clip: ClipInfo): View {
  if (key.look === "app") return key.zoom ? viewOf({ x: 0, y: 0, width: APP.width, height: APP.height }, key.zoom) : WHOLE_APP;
  if (typeof key.look === "object") return viewOf(key.look, key.zoom);
  const rect = clip.rects[key.look];
  if (!rect) throw new Error(`${clip.name} has no box "${key.look}"; it has ${Object.keys(clip.rects).join(", ")}`);
  return viewOf(rect, key.zoom);
}

/** What the camera frames at a second of the scene: each key's view, reached by an eased move that starts at the key. */
export function viewAt(scene: ClipScene, clip: ClipInfo, seconds: number): View {
  const keys = scene.camera.map((key) => ({ at: sceneSecondsOf(scene, clip, key.at), view: viewForKey(key, clip) })).sort((a, b) => a.at - b.at);
  let view = keys[0] && keys[0].at <= 0 ? keys[0].view : WHOLE_APP;
  for (const key of keys) {
    if (seconds < key.at) break;
    const progress = easeCamera(Math.min(1, (seconds - key.at) / MOVE_SECONDS));
    view = {
      centerX: interpolate(progress, [0, 1], [view.centerX, key.view.centerX]),
      centerY: interpolate(progress, [0, 1], [view.centerY, key.view.centerY]),
      width: Math.exp(interpolate(progress, [0, 1], [Math.log(view.width), Math.log(key.view.width)])),
    };
  }
  return view;
}

/** How far past the whole app the camera has to zoom before a view fills the frame edge to edge. */
const ZOOM_TO_FILL = 0.3;

/**
 * The transform that frames a view: the whole app sits in its window at rest (`appBox` on screen), and the closer the
 * camera zooms, the more the view grows to fill the frame edge to edge.
 */
export function cameraTransform(view: View, appBox: Rect, frame: { width: number; height: number }) {
  const pointsToPixels = appBox.width / APP.width;
  const filling = Math.min(1, Math.max(0, (APP.width / view.width - 1) / ZOOM_TO_FILL));
  const targetWidth = interpolate(filling, [0, 1], [appBox.width, frame.width]);
  const targetX = interpolate(filling, [0, 1], [appBox.x + appBox.width / 2, frame.width / 2]);
  const targetY = interpolate(filling, [0, 1], [appBox.y + appBox.height / 2, frame.height / 2]);
  const scale = targetWidth / (view.width * pointsToPixels);
  const translateX = targetX - (appBox.x + view.centerX * pointsToPixels) * scale;
  const translateY = targetY - (appBox.y + view.centerY * pointsToPixels) * scale;
  return { transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: "0 0" };
}
