/** The engine's services whose model the user picks. */
export type ThisMacService = "recognition" | "voiceModel";
/** Speaking replies takes the voice for their language: Kokoro, always set up, for English. */
export type EngineService = ThisMacService | "speaking";

export interface EngineModel {
  id: string;
  name: string;
  repo: string;
  revision: string;
  /** What it downloads. */
  bytes: number;
}

export interface ChoosableModel extends EngineModel {
  service: EngineService;
  /** How it did in Mirador's comparison on a Mac, against the others for its service; none until compared. */
  quality?: string;
  /** What its server held in memory while it worked, measured on a Mac. */
  memoryBytes: number;
  /** Speech recognition that names the language it heard. */
  tellsLanguage?: boolean;
  /** Its licence allows only non-commercial use. */
  nonCommercial?: boolean;
}

const mebibytes = (count: number) => count * 2 ** 20;
const GIBIBYTE = 2 ** 30;

export const SPOKEN_VOICE: EngineModel = { id: "kokoro-82m", name: "Kokoro", repo: "mlx-community/Kokoro-82M-bf16", revision: "a71e4d38b236d968966a2002c4c895dbd12b1c3c", bytes: 383_587_492 };

/**
 * Best first for each service, pinned so that every Mac gets the same models. Gemma 4 E4B, 12B and 26B-A4B made 2, 1
 * and no serious errors translating 16 Hungarian sentences; E2B, 31B and Qwen3.5 9B did worse for their size or speed.
 */
export const choosableModels: ChoosableModel[] = [
  {
    id: "whisper-large-v3-turbo",
    service: "recognition",
    name: "Whisper large-v3 turbo",
    repo: "mlx-community/whisper-large-v3-turbo-asr-fp16",
    revision: "624c19c9af5603fa73b83bce14d4aeea96156d18",
    bytes: 1_618_633_596,
    memoryBytes: mebibytes(2_784),
    tellsLanguage: true,
  },
  {
    id: "gemma-4-26b-a4b",
    service: "voiceModel",
    name: "Gemma 4 26B-A4B",
    quality: "best",
    repo: "mlx-community/gemma-4-26b-a4b-it-4bit",
    revision: "0d77464eeb233a2da68ebf9d7dc4edaac7db956d",
    bytes: 15_373_586_252,
    memoryBytes: mebibytes(15_360),
  },
  {
    id: "gemma-4-12b",
    service: "voiceModel",
    name: "Gemma 4 12B",
    quality: "good",
    repo: "mlx-community/gemma-4-12B-it-4bit",
    revision: "73bcf09092aa277861d5a191b989b666f7f32e8f",
    bytes: 6_773_371_194,
    memoryBytes: mebibytes(8_567),
  },
  {
    id: "gemma-4-e4b",
    service: "voiceModel",
    name: "Gemma 4 E4B",
    quality: "fair",
    repo: "mlx-community/gemma-4-e4b-it-4bit",
    revision: "475b9088d29754a3379866cf5aeb6b41acd313c2",
    bytes: 5_179_239_349,
    memoryBytes: mebibytes(5_034),
  },
  {
    id: "omnivoice",
    service: "speaking",
    name: "OmniVoice",
    repo: "mlx-community/OmniVoice-bfloat16",
    revision: "6119f7072580cc30c3cbdf496269216b03ad9742",
    bytes: 2_042_320_520,
    memoryBytes: mebibytes(9_050),
    nonCommercial: true,
  },
];

/** What setting up voice on this Mac put in place before its models could be chosen. */
export const FIRST_MODELS: Record<ThisMacService, string> = { recognition: "whisper-large-v3-turbo", voiceModel: "gemma-4-26b-a4b" };

/** uv, Python and the speech servers' packages, once installed. */
export const ENGINE_PACKAGES_BYTES = 1.5e9;

export const choosableModel = (id: string) => choosableModels.find((model) => model.id === id);
export const modelName = (id: string) => choosableModel(id)?.name ?? id;
export const modelsFor = (service: EngineService) => choosableModels.filter((model) => model.service === service);

/** At most half the Mac's memory, leaving the rest to macOS, the user's apps and the engine's other model. */
export const fitsMemory = (model: ChoosableModel, memoryBytes: number) => model.memoryBytes * 2 <= memoryBytes;

export const bestFitting = (service: ThisMacService, memoryBytes: number) => modelsFor(service).find((model) => fitsMemory(model, memoryBytes)) ?? null;

const MAC_MEMORY_SIZES_GB = [8, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512];

/** The least memory a Mac comes with that the model fits. */
export const memoryNeededGb = (model: ChoosableModel) =>
  MAC_MEMORY_SIZES_GB.find((size) => fitsMemory(model, size * GIBIBYTE)) ?? Math.ceil((model.memoryBytes * 2) / GIBIBYTE);

/** As Apple counts a Mac's memory: 16 GB is 16 GiB. */
export const memoryGb = (bytes: number) => Math.round(bytes / GIBIBYTE);
