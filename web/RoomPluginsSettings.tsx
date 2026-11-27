import type { InstalledApp } from "../shared/apps.ts";
import type { Conversation, Profile } from "../shared/model.ts";
import type { Room } from "../shared/rooms.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { conversationPlugins, looksOfPlugins } from "./plugin-settings.ts";
import { PluginIcon } from "./PluginIcon.tsx";
import { nameOf, roomStartsAfreshText, StartsAfreshWarning, useChangeStartingAfresh, workingThere } from "./RoomAgentSetup.tsx";
import { RoomSection } from "./RoomSection.tsx";

const words = t.rooms;

const APP_TOOL_NAMES = ["app_open", "apply", "app_state", "app_run"];

/**
 * The installed canvas and app plugins a room's owner can opt in to for this room. Changing them restarts host agents
 * already working in the room so their tools and instructions stay in sync, stopping turns under way when a plugin turns off.
 */
export function RoomPluginsTab({
  room,
  profiles,
  roomConversations,
  installedApps,
}: {
  room: Room;
  profiles: Profile[];
  roomConversations: Conversation[];
  installedApps: InstalledApp[];
}) {
  const byName = new Map<string, { plugin: string; title: string; tools: string[] }>();
  for (const entry of conversationPlugins()) byName.set(entry.plugin, entry);
  for (const app of installedApps) {
    const existing = byName.get(app.name);
    if (existing) byName.set(app.name, { ...existing, tools: [...existing.tools, ...APP_TOOL_NAMES] });
    else byName.set(app.name, { plugin: app.name, title: app.title, tools: APP_TOOL_NAMES });
  }
  const installed = [...byName.values()].toSorted((a, b) => a.title.localeCompare(b.title));
  const looks = looksOfPlugins();
  const { shown, change, pending, confirm, keep } = useChangeStartingAfresh(room.plugins, (plugins) =>
    connection.send({ type: "room.set-plugins", roomId: room.id, plugins }),
  );
  const startsAfresh = room.agents
    .filter((agent) => !agent.brought && workingThere(agent, roomConversations))
    .map(({ profileId }) => nameOf(profiles, profileId));
  const toggle = (plugin: string, on: boolean) => {
    const next = on ? [...new Set([...shown, plugin])].sort() : shown.filter((name) => name !== plugin);
    change(next, startsAfresh, !on);
  };
  return (
    <RoomSection title={words.plugins} meaning={words.pluginsHint}>
      {installed.length === 0 ? (
        <p className="hint">{words.noPluginsInstalled}</p>
      ) : (
        <div className="plugin-rows">
          {installed.map(({ plugin, title, tools }) => {
            const on = shown.includes(plugin);
            const look = looks[plugin];
            return (
              <section key={plugin} className={`plugin-row${on ? " on" : ""}`} data-room-plugin={plugin}>
                <div className="plugin-row-head">
                  <div className="plugin-row-label">
                    <PluginIcon name={plugin} title={title} icon={look?.icon ?? null} />
                    <span className="plugin-text">
                      <span className="plugin-row-name">
                        <span className="plugin-row-title">{title}</span>
                      </span>
                      <span className="plugin-summary">{look?.tagline ?? tools.join(", ")}</span>
                    </span>
                  </div>
                  <label className="plugin-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={words.usePluginInRoom(title)}
                      checked={on}
                      disabled={pending !== null}
                      onChange={(event) => toggle(plugin, event.target.checked)}
                    />
                    <span className="plugin-switch-track" aria-hidden="true" />
                  </label>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {pending && <StartsAfreshWarning text={roomStartsAfreshText(startsAfresh, pending.narrows)} onConfirm={confirm} onKeep={keep} />}
    </RoomSection>
  );
}
