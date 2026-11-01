import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { MERMAID_FILES_KEPT, packagesOnlyMermaidNeeds, pruneUnusedModules } from "../desktop/scripts/prune-unused-modules.ts";
import { resolveAsset } from "../host/canvas/assets.ts";

const stage = mkdtempSync(join(tmpdir(), "mirador-prune-"));
const modules = join(stage, "node_modules");
afterAll(() => rmSync(stage, { recursive: true, force: true }));

const write = (path: string, content = "") => {
  mkdirSync(dirname(join(stage, path)), { recursive: true });
  writeFileSync(join(stage, path), content);
};
const installed = (name: string, dependencies: Record<string, string> = {}, peerDependencies: Record<string, string> = {}) =>
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, dependencies, peerDependencies }));
const present = (path: string) => existsSync(join(modules, path));

beforeEach(() => {
  rmSync(stage, { recursive: true, force: true });
  write("package.json", JSON.stringify({ dependencies: { mermaid: "12", react: "19", three: "0.186.1" } }));
  installed("mermaid", { "@mermaid-js/parser": "1", khroma: "2", "shared-helper": "1" });
  ["LICENSE", "README.md", "dist/mermaid.min.js", "dist/mermaid.js", "dist/mermaid.min.js.map", "dist/chunks/flowchart.mjs"].forEach((file) => write(`node_modules/mermaid/${file}`));
  installed("@mermaid-js/parser", { langium: "3" });
  installed("langium");
  installed("khroma");
  installed("shared-helper");
  installed("react", { "shared-helper": "1" }, { "peer-of-react": "1" });
  installed("peer-of-react");
  ["index.js", "index.js.map", "index.d.ts", "types/client.d.mts", "colors.map.json"].forEach((file) => write(`node_modules/react/${file}`));
  installed("three");
  ["build/three.module.js", "examples/jsm/controls/OrbitControls.js", "src/core/Object3D.js"].forEach((file) => write(`node_modules/three/${file}`));
  mkdirSync(join(modules, ".bin"), { recursive: true });
  symlinkSync("../mermaid/dist/mermaid.js", join(modules, ".bin", "mermaid"));
  symlinkSync("../react/index.js", join(modules, ".bin", "react"));
});

test("the packages only mermaid needs are mermaid's own dependencies that nothing else of the app needs, peers included", () => {
  expect(packagesOnlyMermaidNeeds(modules, ["mermaid", "react", "three"]).sort()).toEqual(["@mermaid-js/parser", "khroma", "langium", "mermaid"]);
});

test("pruning keeps mermaid's served file and what the rest of the app needs, and drops sources, maps, types and the links left dead", () => {
  pruneUnusedModules(stage);

  ["@mermaid-js", "khroma", "langium", "three/src"].forEach((gone) => expect(present(gone)).toBe(false));
  expect(readdirSync(join(modules, ".bin"))).toEqual(["react"]);
  ["mermaid/dist/mermaid.js", "mermaid/dist/chunks", "mermaid/README.md", "react/index.js.map", "react/index.d.ts", "react/types"].forEach((gone) =>
    expect(present(gone)).toBe(false),
  );
  MERMAID_FILES_KEPT.forEach((kept) => expect(present(`mermaid/${kept}`)).toBe(true));
  ["shared-helper/package.json", "peer-of-react/package.json", "react/index.js", "react/colors.map.json", "three/build/three.module.js", "three/examples/jsm/controls/OrbitControls.js"].forEach(
    (kept) => expect(present(kept)).toBe(true),
  );
});

test("every file the canvas serves from a pruned package survives pruning", () => {
  // Packages resolve to their real path, and a worktree's node_modules can be a link to the checkout's.
  const appModules = realpathSync(join(import.meta.dir, "..", "node_modules"));
  const servedFromModules = (pathname: string) => relative(appModules, resolveAsset(pathname)!);

  expect(MERMAID_FILES_KEPT.map((file) => join("mermaid", file))).toContain(servedFromModules("/mermaid.min.js"));
  ["/three/build/three.module.js", "/three/addons/controls/OrbitControls.js"].forEach((pathname) => expect(servedFromModules(pathname)).not.toStartWith("three/src/"));
});
