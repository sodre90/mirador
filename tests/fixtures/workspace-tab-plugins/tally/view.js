const page = document.createElement("main");
page.innerHTML = `<h1>Tally</h1><p id="place"></p><p id="workspace"></p><p id="count"></p>
<button id="count-up">Count</button><p id="reply"></p><button id="refused">Do what tallies don't</button>
<button id="ask">Ask the agent</button><button id="start">Start a conversation</button><button id="compose">Add to the composer</button>
<a id="link" href="#">Open the tally's site</a><p id="handed"></p>
<input id="conversation" aria-label="Conversation"><button id="open">Open the conversation</button>`;
document.body.append(page);
const show = (id, text) => (document.getElementById(id).textContent = text);
const handOff = (promise, done) => promise.then(() => show("handed", done), (error) => show("handed", error.message));
show("place", `Drawn in the ${window.mirador.place}`);
window.mirador.onState(({ workspace, count, everywhere }) => {
  show("workspace", `Workspace: ${workspace}`);
  show("count", `Counted ${count} here, ${everywhere} everywhere`);
});
document.getElementById("count-up").addEventListener("click", () => window.mirador.send({ kind: "count" }).then(({ counted }) => show("reply", `Counted to ${counted}`)));
document.getElementById("refused").addEventListener("click", () => window.mirador.send({ kind: "other" }).catch((error) => show("reply", error.message)));
document.getElementById("ask").addEventListener("click", () => handOff(window.mirador.prompt("Tally says hello"), "Asked"));
document.getElementById("start").addEventListener("click", () => handOff(window.mirador.startConversation("Tally starts this"), "Started"));
document.getElementById("compose").addEventListener("click", () => handOff(window.mirador.addToComposer("Tally adds this"), "Added"));
document.getElementById("link").addEventListener("click", (event) => {
  event.preventDefault();
  window.mirador.openLink("https://example.invalid/tally");
});
document.getElementById("open").addEventListener("click", () => handOff(window.mirador.openConversation(document.getElementById("conversation").value), "Opened"));
