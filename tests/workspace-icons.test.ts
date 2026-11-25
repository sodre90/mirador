import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { workspaceIcon } from "../host/workspace-icons.ts";
import { iconInTheme } from "../shared/workspace-icon.ts";

let root: string;
let folder: string;
let logged: Mock<typeof console.error>;
beforeEach(() => {
  logged = spyOn(console, "error").mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), "workspace-icons-"));
  folder = join(root, "project");
  mkdirSync(folder);
});
afterEach(() => {
  logged.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

const drawing = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg"><title>${name}</title></svg>`;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), content);
};
const draw = (...paths: string[]) => paths.forEach((path) => write(path, drawing(path)));
const drawn = (url: string | null | undefined) => url && Buffer.from(url.split(",")[1]!, "base64").toString().match(/<title>(.*)<\/title>/)?.[1];
const shown = async () => {
  const icon = await workspaceIcon(folder);
  return icon && { light: drawn(icon.light), dark: drawn(icon.dark) };
};

describe("workspaceIcon", () => {
  test("finds none in a folder without one, and in a folder that is gone", async () => {
    expect(await workspaceIcon(folder)).toBeNull();
    expect(await workspaceIcon(join(root, "gone"))).toBeNull();
  });

  test("takes the first that is there: Mirador's own, IntelliJ's, then the web project's", async () => {
    const inOrder = [
      ...[".mirador/icon.svg", ".mirador/icon.png", ".idea/icon.svg", ".idea/icon.png"],
      ...["", "public/", "static/"].flatMap((place) => ["svg", "ico", "png"].map((extension) => `${place}favicon.${extension}`)),
      ...["svg", "ico", "png"].map((extension) => `app/icon.${extension}`),
    ];
    draw(...inOrder);
    for (const path of inOrder) {
      expect(await shown()).toEqual({ light: path, dark: null });
      rmSync(join(folder, path));
    }
    expect(await workspaceIcon(folder)).toBeNull();
  });

  test("passes over one it can't show", async () => {
    write(".mirador/icon.svg", "<svg><script/></svg>");
    mkdirSync(join(folder, ".mirador/icon.png"));
    draw(".idea/icon.svg");
    expect(await shown()).toEqual({ light: ".idea/icon.svg", dark: null });
  });

  test("logs why it passes over one, once, and nothing of one behind the icon it shows", async () => {
    write(".mirador/icon.svg", "<svg><script/></svg>");
    write(".mirador/icon.png", "a".repeat(257 * 1024));
    draw(".idea/icon.svg");
    write("favicon.svg", "<svg><script/></svg>");
    await workspaceIcon(folder);
    expect(logged.mock.calls.flat()).toEqual([
      `${join(folder, ".mirador/icon.svg")} isn't shown as its workspace's icon: it holds "<script", which is no plain shape`,
      `${join(folder, ".mirador/icon.png")} isn't shown as its workspace's icon: it is over 256 KB`,
    ]);
  });

  test("gives a dark theme the dark icon beside the icon, and nothing for favicons", async () => {
    draw(".idea/icon.svg", ".idea/icon_dark.svg", "favicon_dark.svg");
    expect(await shown()).toEqual({ light: ".idea/icon.svg", dark: ".idea/icon_dark.svg" });
  });

  test("keeps Mirador's own icon in a dark theme over IntelliJ's dark one", async () => {
    draw(".mirador/icon.svg", ".idea/icon_dark.svg");
    expect(await shown()).toEqual({ light: ".mirador/icon.svg", dark: null });
  });

  test("shows a dark icon alone in a dark theme only", async () => {
    draw(".mirador/icon_dark.png");
    expect(await shown()).toEqual({ light: null, dark: ".mirador/icon_dark.png" });
  });

  test("follows a link inside the workspace and refuses one leading out of it", async () => {
    draw("assets/logo.svg");
    mkdirSync(join(folder, ".mirador"));
    symlinkSync(join(folder, "assets/logo.svg"), join(folder, ".mirador/icon.svg"));
    expect(await shown()).toEqual({ light: "assets/logo.svg", dark: null });
    rmSync(join(folder, ".mirador"), { recursive: true });
    const outside = join(root, "project-secrets");
    mkdirSync(outside);
    writeFileSync(join(outside, "icon.svg"), drawing("secret"));
    symlinkSync(outside, join(folder, ".mirador"));
    symlinkSync(join(outside, "icon.svg"), join(folder, "favicon.svg"));
    expect(await workspaceIcon(folder)).toBeNull();
  });

  test("finds the icon of a workspace that is itself added through a link", async () => {
    draw("favicon.svg");
    const link = join(root, "link");
    symlinkSync(folder, link);
    expect(drawn((await workspaceIcon(link))?.light)).toBe("favicon.svg");
  });
});

describe("iconInTheme", () => {
  test("shows the dark icon in a dark theme, or the only one there is", () => {
    expect(iconInTheme({ light: "a", dark: "b" }, "light")).toBe("a");
    expect(iconInTheme({ light: "a", dark: "b" }, "dark")).toBe("b");
    expect(iconInTheme({ light: "a", dark: null }, "dark")).toBe("a");
    expect(iconInTheme({ light: null, dark: "b" }, "light")).toBeNull();
    expect(iconInTheme(undefined, "dark")).toBeNull();
  });
});
