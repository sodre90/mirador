import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

/** The storefront's checkout demo: the product, a spinner that runs far too long, and the order placed. */
export const DEMO_VIDEO = {
  file: "checkout-demo.mp4",
  seconds: 16,
  fps: 30,
  width: 1280,
  height: 720,
  /** The spinner shows from here to `spinnerEnds`; the Media scene marks it and the agent cuts most of it. */
  spinnerStarts: 4.5,
  spinnerEnds: 10.5,
  /** Where the spinner sits on the frame, in its pixels, for the box drawn around it. */
  spinnerBox: { x: 560, y: 250, width: 160, height: 160 },
};

/** Draws one frame of the demo at `seconds` on a 2D canvas; runs in the browser. */
function drawFrame({ seconds, video }: { seconds: number; video: typeof DEMO_VIDEO }) {
  const canvas = (document.querySelector("canvas") ?? document.body.appendChild(Object.assign(document.createElement("canvas"), { width: video.width, height: video.height }))) as HTMLCanvasElement;
  const context = canvas.getContext("2d")!;
  const { width, height, spinnerStarts, spinnerEnds } = video;
  const font = (size: number, weight = 600) => `${weight} ${size}px -apple-system, "Helvetica Neue", sans-serif`;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fdf6ee");
  gradient.addColorStop(1, "#f3e8ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.textAlign = "left";
  context.fillStyle = "#1f1d2b";
  context.font = font(26, 700);
  context.fillText("acme shop", 48, 64);
  context.textAlign = "center";
  if (seconds < spinnerStarts) {
    context.fillStyle = "#ff7a59";
    context.beginPath();
    context.roundRect(140, 150, 420, 420, 32);
    context.fill();
    context.fillStyle = "#fff";
    context.font = font(220, 800);
    context.fillText("👟", 350, 440);
    context.textAlign = "left";
    context.fillStyle = "#1f1d2b";
    context.font = font(54, 800);
    context.fillText("Trail Runner 2", 640, 260);
    context.font = font(34, 500);
    context.fillStyle = "#5d5a70";
    context.fillText("€129 · free returns", 640, 316);
    const pressed = seconds > 3.6;
    context.fillStyle = pressed ? "#5a43b8" : "#6e56cf";
    context.beginPath();
    context.roundRect(640, 380, 300, 84, 42);
    context.fill();
    context.fillStyle = "#fff";
    context.font = font(34, 700);
    context.textAlign = "center";
    context.fillText("Buy now", 790, 434);
    return canvas.toDataURL("image/jpeg", 0.92);
  }
  if (seconds < spinnerEnds) {
    const turn = (seconds - spinnerStarts) * Math.PI * 2;
    context.lineWidth = 14;
    context.strokeStyle = "#e6e0f5";
    context.beginPath();
    context.arc(width / 2, 330, 64, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "#6e56cf";
    context.lineCap = "round";
    context.beginPath();
    context.arc(width / 2, 330, 64, turn, turn + Math.PI * 0.6);
    context.stroke();
    context.fillStyle = "#5d5a70";
    context.font = font(36, 500);
    context.fillText("Placing your order…", width / 2, 480);
    return canvas.toDataURL("image/jpeg", 0.92);
  }
  const grow = Math.min(1, (seconds - spinnerEnds) / 0.4);
  context.fillStyle = "#30a46c";
  context.beginPath();
  context.arc(width / 2, 300, 80 * grow, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#fff";
  context.lineWidth = 16;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(width / 2 - 34, 302);
  context.lineTo(width / 2 - 8, 328);
  context.lineTo(width / 2 + 38, 276);
  if (grow === 1) context.stroke();
  context.fillStyle = "#1f1d2b";
  context.font = font(54, 800);
  context.fillText("Order placed", width / 2, 460);
  context.fillStyle = "#5d5a70";
  context.font = font(32, 500);
  context.fillText("Thanks, Ada. It's on its way.", width / 2, 516);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Draws the demo frame by frame in Chrome and encodes it with ffmpeg into `path`. */
export async function makeDemoVideo(path: string) {
  const browser = await chromium.launch({ channel: process.platform === "darwin" ? "chrome" : undefined });
  const page = await browser.newPage();
  const { fps, seconds } = DEMO_VIDEO;
  const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path], { stdio: ["pipe", "inherit", "inherit"] });
  const finished = new Promise<void>((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed on ${path}`)))));
  for (const frame of Array.from({ length: seconds * fps }, (_, index) => index)) {
    const jpeg = await page.evaluate(drawFrame, { seconds: frame / fps, video: DEMO_VIDEO });
    const data = Buffer.from(jpeg.slice(jpeg.indexOf(",") + 1), "base64");
    if (!ffmpeg.stdin.write(data)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
  }
  ffmpeg.stdin.end();
  await finished;
  await browser.close();
}
