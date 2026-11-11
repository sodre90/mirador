const page = document.createElement("main");
page.innerHTML = `<h1>Starter</h1><label>Profile <select id="profile"></select></label><button id="start">Start on it</button><p id="started"></p>`;
document.body.append(page);
const picker = document.getElementById("profile");
window.mirador.onState(({ profiles }) => picker.replaceChildren(...profiles.map((name) => new Option(name, name))));
document.getElementById("start").addEventListener("click", () =>
  window.mirador.send({ profile: picker.value }).then(
    ({ profile }) => (document.getElementById("started").textContent = `Started on ${profile}`),
    (error) => (document.getElementById("started").textContent = error.message),
  ),
);
