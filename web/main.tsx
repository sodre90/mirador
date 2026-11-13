import { createRoot } from "react-dom/client";
import { itemWindowRouteOf, pluginWindowRouteOf } from "../shared/item-window.ts";
import { App } from "./App.tsx";
import { askDesktopAppForNonce, giveLanguageToDesktopApp } from "./desktop-bridge.ts";
import { closeWhatHasFocusOnCommandW } from "./desktop-close.ts";
import { applyExternalImages, externalImages } from "./external-images.ts";
import { openOutsideLinksInTheBrowser } from "./outside-links.ts";
import { PageErrorBoundary } from "./PageErrorBoundary.tsx";
import { reportUncaughtPageErrors } from "./page-errors.ts";
import { ItemWindow } from "./ItemWindow.tsx";
import { PluginWindow } from "./PluginWindow.tsx";
import { applyFontScale, currentFontScale } from "./font-scale.ts";
import { applyPulses, keepPulsesInStep, storedPulsesOn } from "./pulses.ts";
import { applyShellAppearance, storedShellAppearance } from "./shell-look.ts";
import { applyLanguage } from "./language.ts";
import { applyTextCursor } from "./text-cursor.ts";
import { applyTheme, giveThemeToDesktopApp, storedTheme } from "./theme.ts";
import { applyTimestampsShown, storedTimestampsShown } from "./timestamps.ts";
import { applyWaitingStyle, storedWaitingStyle } from "./waiting.ts";
import { applyWorkspaceColorStyle } from "./workspace-colors.ts";

reportUncaughtPageErrors();
applyExternalImages(externalImages.get());
applyFontScale(currentFontScale());
applyLanguage();
applyTheme(storedTheme());
applyShellAppearance(storedShellAppearance());
applyTimestampsShown(storedTimestampsShown());
applyPulses(storedPulsesOn());
keepPulsesInStep();
applyWaitingStyle(storedWaitingStyle());
applyWorkspaceColorStyle();
applyTextCursor();
askDesktopAppForNonce();
giveThemeToDesktopApp();
giveLanguageToDesktopApp();
openOutsideLinksInTheBrowser();
closeWhatHasFocusOnCommandW();
function Page() {
  const itemWindowRoute = itemWindowRouteOf(location.hash);
  if (itemWindowRoute) return <ItemWindow route={itemWindowRoute} />;
  const pluginWithWindow = pluginWindowRouteOf(location.hash);
  return pluginWithWindow ? <PluginWindow plugin={pluginWithWindow} /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <PageErrorBoundary>
    <Page />
  </PageErrorBoundary>,
);
