import type { VoiceEngineStatus } from "../../../shared/voice-engine.ts";
import { modelName } from "../../../shared/voice-engine-models.ts";
import { VoiceUnavailable, type ThisMac } from "../voice.ts";
import type { VoiceEngineInstaller } from "./installer.ts";
import type { VoiceEngineServers } from "./servers.ts";

/** Mirador's own speech engine on this Mac: set up by the installer, run by the servers. */
export class VoiceEngine {
  private removing = false;
  private readonly removingModels = new Set<string>();

  constructor(
    private readonly installer: Pick<VoiceEngineInstaller, "status" | "setUp" | "cancel" | "remove" | "removeModel" | "isSettingUp">,
    private readonly servers: Pick<VoiceEngineServers, "states" | "use" | "servedModels" | "stopServing" | "stopAll" | "killAllNow" | "idleTimeChanged">,
  ) {}

  status(): VoiceEngineStatus {
    return { ...this.installer.status(), servers: this.servers.states() };
  }

  setUp(models: string[]) {
    this.installer.setUp(models);
  }

  cancel() {
    this.installer.cancel();
  }

  /** No server starts while removing, so none runs from files about to be deleted; while a setup runs, nothing is removed, so the servers go on. */
  async remove() {
    if (this.installer.isSettingUp()) return;
    this.removing = true;
    try {
      await this.servers.stopAll();
      await this.installer.remove();
    } finally {
      this.removing = false;
    }
  }

  /** As remove does, for one model. */
  async removeModel(model: string) {
    if (this.installer.isSettingUp()) return;
    this.removingModels.add(model);
    try {
      await this.servers.stopServing(model);
      await this.installer.removeModel(model);
    } finally {
      this.removingModels.delete(model);
    }
  }

  /** A model the settings no longer use unloads at once, freeing its memory, as its server would start again for the new one anyway. */
  async unloadAllBut(models: string[]) {
    await Promise.all(this.servers.servedModels().filter((model) => !models.includes(model)).map((model) => this.servers.stopServing(model)));
  }

  use: ThisMac = (service, model, work) => {
    if (this.removing) return Promise.reject(new VoiceUnavailable({ code: "voice-being-removed" }));
    if (this.removingModels.has(model)) return Promise.reject(new VoiceUnavailable({ code: "voice-engine-model-being-removed", model: modelName(model) }));
    return this.servers.use(service, model, work);
  };

  idleTimeChanged() {
    this.servers.idleTimeChanged();
  }

  async stop() {
    this.installer.cancel();
    await this.servers.stopAll();
  }

  killServersNow() {
    this.servers.killAllNow();
  }
}
