const page = document.createElement("main");
page.innerHTML = '<p>Count: <output id="count">…</output></p><p id="last-change"></p><p id="problem"></p><button id="add">Add one</button><button id="ask">Ask about the count</button><button id="read-note">Read the note</button><button id="read-outside">Read the file outside</button><p id="file-text"></p><p id="page-load"></p><button id="remember">Remember the count</button><p id="remembered"></p><p id="same-storage"></p><button id="show-clip">Show the clip</button><video id="clip" crossorigin="anonymous" muted preload="auto"></video><p id="clip-state"></p><button id="ask-frame">Ask about the frame</button><p id="prompt-state"></p><button id="count-up">Count up</button><button id="wait">Wait</button><button id="stop">Stop the task</button><p id="task"></p>';
document.body.append(page);
document.getElementById("page-load").textContent = crypto.randomUUID();
const taskText = (task) => {
  if (!task) return "no task yet";
  const done = task.done === null ? "" : ` ${Math.round(task.done * 100)}%`;
  return `${task.name} ${task.state}${done}${task.text ? ` (${task.text})` : ""}${task.summary ? `: ${task.summary}` : ""}${task.problem ? `: ${task.problem}` : ""}`;
};
window.mirador.onState((state) => {
  document.getElementById("count").textContent = String(state.document.count);
  document.getElementById("last-change").textContent = state.lastChange ? `${state.lastChange.author.kind}: ${state.lastChange.summary}` : "";
  document.getElementById("problem").textContent = state.problem ?? "";
  document.getElementById("task").textContent = taskText(state.task);
});
document.getElementById("add").addEventListener("click", () => window.mirador.apply({ op: "add", by: 1 }));
document.getElementById("ask").addEventListener("click", () => window.mirador.prompt(`Is ${document.getElementById("count").textContent} a good count?`));
const showFile = (path) => window.mirador.readFile(path).then((blob) => blob.text()).catch((error) => error.message).then((text) => (document.getElementById("file-text").textContent = text));
document.getElementById("read-note").addEventListener("click", () => showFile("note.txt"));
document.getElementById("read-outside").addEventListener("click", () => showFile("../outside.txt"));
document.getElementById("remembered").textContent = localStorage.getItem("remembered") ?? "nothing remembered";
document.getElementById("same-storage").textContent = window.mirador.storage === localStorage ? "localStorage is the app's storage" : "localStorage is the frame's own";
document.getElementById("remember").addEventListener("click", () => localStorage.setItem("remembered", `the count was ${document.getElementById("count").textContent}`));
const clip = document.getElementById("clip");
const showText = (id) => (text) => (document.getElementById(id).textContent = text);
clip.addEventListener("loadeddata", () => showText("clip-state")(`showing ${clip.videoWidth}×${clip.videoHeight}`));
clip.addEventListener("error", () => showText("clip-state")("the clip didn't load"));
document.getElementById("show-clip").addEventListener("click", () => {
  showText("clip-state")("loading");
  window.mirador.mediaUrl("clip.webm").then((url) => (clip.src = url), (error) => showText("clip-state")(error.message));
});
const frameOfClip = () => {
  const canvas = Object.assign(document.createElement("canvas"), { width: clip.videoWidth, height: clip.videoHeight });
  canvas.getContext("2d").drawImage(clip, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
};
document.getElementById("ask-frame").addEventListener("click", async () => {
  const frame = await frameOfClip();
  window.mirador.prompt("What is in this frame?", { images: [frame] }).then(() => "sent with the frame", (error) => error.message).then(showText("prompt-state"));
});
document.getElementById("count-up").addEventListener("click", () => window.mirador.run("count-up"));
document.getElementById("wait").addEventListener("click", () => window.mirador.run("wait"));
document.getElementById("stop").addEventListener("click", () => window.mirador.stopTask());
