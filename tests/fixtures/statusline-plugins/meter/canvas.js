const page = document.createElement("main");
page.innerHTML = `<h1>Meter window</h1><p id="showing"></p><p id="metered"></p>`;
document.body.append(page);
const show = (id, text) => (document.getElementById(id).textContent = text);
window.mirador.onState(({ showing, metered }) => {
  show("showing", `Showing ${showing ?? "nothing"}`);
  show("metered", `Metered profiles: ${metered.join(", ") || "none"}`);
});
