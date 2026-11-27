/**
 * Stands in for Apple's `container` in e2e. It keeps its service, builder, images and VMs in state.json under
 * FAKE_CONTAINER_STATE and notes each call it gets in calls.log there, but the throwaway runs that install the sandbox's
 * tools, which it notes in installs.log. `exec` starts the agent "in" a VM by running
 * e2e/fake-acp-agent.ts on this computer, in the folder `-w` names, with only the values `-e` names, and runs the
 * script that puts held files back in a VM here, from host/sandbox/in-vm; what it runs ends with the VM. A throwaway
 * `run`, which installs a tool, installs nothing and succeeds. With FAKE_CONTAINER_BUILD_HELD_BY, the base image's build
 * stops after its second step until that file exists; with FAKE_CONTAINER_INSTALL_HELD_BY, so does Claude Code's install.
 */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface State {
  serviceRunning: boolean;
  builderRunning: boolean;
  images: string[];
  vms: Record<string, Record<string, string>>;
  /** What each VM mounts, by its name, as `container list` shows it. */
  mounts?: Record<string, { source: string; options: string[] }[]>;
}

const AGENT = join(import.meta.dirname, "fake-acp-agent.ts");
const HELD_PLACES_IN_VM = "/mirador/sandbox/held-places.ts";
const HELD_PLACES_HERE = join(import.meta.dirname, "../host/sandbox/in-vm/held-places.ts");

const stateFolder = process.env.FAKE_CONTAINER_STATE!;
const statePath = join(stateFolder, "state.json");
const args = process.argv.slice(2);
const isInstall = args[0] === "run" && !args.includes("--detach");
appendFileSync(join(stateFolder, isInstall ? "installs.log" : "calls.log"), `${JSON.stringify(args)}\n`);

const read = (): State => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { serviceRunning: false, builderRunning: false, images: [], vms: {} });
const write = (state: State) => {
  writeFileSync(`${statePath}.${process.pid}`, JSON.stringify(state));
  renameSync(`${statePath}.${process.pid}`, statePath);
};
const change = (changing: (state: State) => void) => {
  const state = read();
  changing(state);
  write(state);
};
const valueAfter = (flag: string) => args[args.indexOf(flag) + 1]!;
const valuesAfter = (flag: string) => args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));
const mountsOfRun = () =>
  valuesAfter("-v").map((mount) => {
    const [source, , access] = mount.split(":");
    return { source: `${source}/`, options: access === "ro" ? ["ro"] : [] };
  });

async function waitForFile(path: string | undefined) {
  while (path && !existsSync(path)) await Bun.sleep(100);
}

async function build() {
  const tag = valueAfter("-t");
  console.log("#1 [internal] load build definition from base.Containerfile");
  console.log("#5 [1/3] FROM docker.io/library/debian:bookworm-slim");
  console.log("#6 [2/3] RUN apt-get update");
  await waitForFile(process.env.FAKE_CONTAINER_BUILD_HELD_BY);
  console.log("#7 [3/3] RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +");
  change((state) => state.images.push(tag));
}

async function installTool() {
  if (args.some((arg) => arg.includes("@anthropic-ai/claude-code@"))) await waitForFile(process.env.FAKE_CONTAINER_INSTALL_HELD_BY);
}

/**
 * `exec [-i] [--user U] [-w DIR] [-e NAME[=VALUE]]… VM mirador-guard as U -- COMMAND…`: the fake agent, given what a VM's process
 * would get, and the FAKE_ACP_ values of this program's own for the fake agent itself; or the put-back of held files.
 */
async function exec() {
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[0].startsWith("FAKE_ACP_") && entry[1] !== undefined));
  let folder = process.cwd();
  let index = 1;
  for (; index < args.length && args[index]!.startsWith("-"); index++) {
    const flag = args[index]!;
    if (flag === "-i") continue;
    const value = args[++index]!;
    if (flag === "-w") folder = value;
    if (flag === "-e") {
      const [name, ...rest] = value.split("=");
      environment[name!] = rest.length > 0 ? rest.join("=") : (process.env[name!] ?? "");
    }
  }
  const vm = args[index]!;
  if (!read().vms[vm]) {
    console.error(`Error: container ${vm} not found`);
    process.exit(1);
  }
  const command = args.slice(index + 1);
  const program = command.includes(HELD_PLACES_IN_VM) ? HELD_PLACES_HERE : AGENT;
  const ran = Bun.spawn([process.execPath, program], { cwd: folder, env: environment, stdio: ["inherit", "inherit", "inherit"] });
  setInterval(() => read().vms[vm] || ran.kill("SIGKILL"), 100);
  process.exit(await ran.exited);
}

const [command, sub] = args;
switch (command) {
  case "system":
    if (sub === "status") process.exit(read().serviceRunning ? 0 : 1);
    change((state) => (state.serviceRunning = sub === "start"));
    break;
  case "builder":
    if (sub === "status") console.log(read().builderRunning ? JSON.stringify([{ status: "running", configuration: { id: "buildkit" } }]) : "builder is not running");
    if (sub === "start") change((state) => (state.builderRunning = true));
    if (sub === "stop") change((state) => (state.builderRunning = false));
    break;
  case "build":
    await build();
    break;
  case "image":
    if (sub === "list") console.log(JSON.stringify(read().images.map((reference) => ({ reference }))));
    if (sub === "inspect") process.exit(read().images.includes(args[2]!) ? 0 : 1);
    if (sub === "delete") change((state) => (state.images = state.images.filter((name) => !args.slice(2).includes(name))));
    break;
  case "run":
    if (isInstall) {
      await installTool();
      break;
    }
    change((state) => {
      state.vms[valueAfter("--name")] = Object.fromEntries(valuesAfter("--label").map((label) => label.split("=") as [string, string]));
      state.mounts = { ...state.mounts, [valueAfter("--name")]: mountsOfRun() };
    });
    break;
  case "logs":
    if (read().vms[args.at(-1)!]) console.log("relays ready");
    break;
  case "exec":
    await exec();
    break;
  case "stop":
  case "delete":
    change((state) =>
      args.slice(1).forEach((name) => {
        delete state.vms[name];
        delete state.mounts?.[name];
      }),
    );
    break;
  case "list":
    console.log(JSON.stringify(Object.entries(read().vms).map(([id, labels]) => ({ status: "running", configuration: { id, labels, mounts: read().mounts?.[id] ?? [] } }))));
    break;
  default:
    console.error(`fake container: no ${command}`);
    process.exit(1);
}
