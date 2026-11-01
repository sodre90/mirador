import { SERVER_OF, type EngineServerState, type VoiceEngineSetup, type VoiceEngineStatus } from "../shared/voice-engine.ts";
import { fitsMemory, memoryGb, memoryNeededGb, type ChoosableModel } from "../shared/voice-engine-models.ts";
import { describedText } from "./host-error.ts";
import { formatNumber, t } from "./i18n/index.ts";

const words = t.voice;

export const gigabytes = (bytes: number) => words.gigabytes(formatNumber(bytes / 1e9, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export const modelWithQuality = ({ name, quality }: ChoosableModel) => (quality ? `${name} · ${words.quality[quality] ?? quality}` : name);

const licence = ({ nonCommercial }: ChoosableModel) => (nonCommercial ? words.nonCommercialUseOnly : "");

/** How good the model is, what its licence allows and what it downloads, or, when this Mac has too little memory for it, how much a Mac needs. */
export const modelChoice = (model: ChoosableModel, memoryBytes: number) =>
  `${modelWithQuality(model)}${licence(model)} · ${fitsMemory(model, memoryBytes) ? gigabytes(model.bytes) : words.needsAMacWith(memoryNeededGb(model))}`;

/** A model on this Mac by its name and quality; one still to download also says what it downloads, or what Mac it needs. */
export const modelOffer = (model: ChoosableModel, engine: Pick<VoiceEngineStatus, "onDisk" | "memoryBytes">) =>
  engine.onDisk.includes(model.id) ? modelWithQuality(model) : modelChoice(model, engine.memoryBytes);

export const tooLittleMemoryForVoiceModel = (memoryBytes: number) => words.tooLittleMemoryForVoiceModel(memoryGb(memoryBytes));

/** What shows beside a model chosen for this Mac: whether its server has it loaded, its download, or why this Mac can't have it. */
export type ModelState =
  | { is: "on-disk"; server: EngineServerState }
  | { is: "downloading"; setup: Extract<VoiceEngineSetup, { state: "setting-up" }> }
  | { is: "too-big"; neededGb: number }
  /** Setup downloads one set of models at a time. */
  | { is: "waiting-for-another-download" }
  /** problem says why adding it failed the last time. */
  | { is: "downloadable"; problem: string | null };

export function modelState(model: ChoosableModel, engine: VoiceEngineStatus): ModelState {
  const { setup } = engine;
  if (engine.onDisk.includes(model.id)) return { is: "on-disk", server: engine.servers[SERVER_OF[model.service]] };
  if (setup.state === "setting-up" && setup.models.includes(model.id)) return { is: "downloading", setup };
  if (!fitsMemory(model, engine.memoryBytes)) return { is: "too-big", neededGb: memoryNeededGb(model) };
  if (setup.state === "setting-up") return { is: "waiting-for-another-download" };
  const notAdded = setup.state === "set-up" && setup.notAdded?.models.includes(model.id) ? describedText(setup.notAdded.problem, setup.notAdded.problemAbout) : null;
  return { is: "downloadable", problem: notAdded };
}
