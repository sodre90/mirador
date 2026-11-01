import { expect, test } from "bun:test";
import { PluginSettingsStore } from "../host/plugin-settings.ts";
import { Store } from "../host/store.ts";
import { settingValue, type PluginManifest } from "../shared/apps.ts";

const openReviews = {
  id: "open-reviews",
  label: "Open reviews",
  choices: [
    { value: "fullscreen", label: "Full screen" },
    { value: "beside", label: "Beside" },
  ],
  default: "fullscreen",
};
const manifests: PluginManifest[] = [
  { name: "review", title: "Code review", api: 3, canvas: { host: "host.ts", view: "view.tsx" }, settings: [openReviews] },
  { name: "tally", title: "Tally", api: 2, app: { host: "host.ts", view: "view.tsx" } },
];

test("lists only plugins with settings, each at its default until the user chooses, and keeps the choice across restarts", () => {
  const store = new Store(":memory:");
  const settings = new PluginSettingsStore(store, manifests);
  expect(settings.all()).toEqual([{ plugin: "review", settings: [openReviews], chosen: {} }]);
  expect(settingValue(settings.all()[0], "open-reviews")).toBe("fullscreen");

  settings.choose("review", "open-reviews", "beside");
  const afterRestart = new PluginSettingsStore(store, manifests).all()[0];
  expect(afterRestart!.chosen).toEqual({ "open-reviews": "beside" });
  expect(settingValue(afterRestart, "open-reviews")).toBe("beside");
});

test("refuses a value that is not one of the setting's choices, and a setting the plugin doesn't have", () => {
  const settings = new PluginSettingsStore(new Store(":memory:"), manifests);
  expect(() => settings.choose("review", "open-reviews", "elsewhere")).toThrow("elsewhere is not one of the choices of Open reviews.");
  expect(() => settings.choose("review", "open-tours", "beside")).toThrow("review has no setting open-tours.");
  expect(() => settings.choose("tally", "open-reviews", "beside")).toThrow("tally has no setting open-reviews.");
  expect(settings.all()[0]!.chosen).toEqual({});
});
