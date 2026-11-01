import { join } from "node:path";
import { choosableModels, SPOKEN_VOICE, type ChoosableModel, type EngineModel } from "../../../shared/voice-engine-models.ts";
import type { SpeakingVoice } from "../endpoints.ts";

/** What setting up voice on this Mac installs, pinned so that every Mac gets the same engine. */
export interface EngineSources {
  uv: { url: string; sha256: string };
  pythonVersion: string;
  /** Compiled by scripts/lock-voice-engine.sh, with every package's hashes. */
  lockFile: string;
  /** Hugging Face, or a fake of it in e2e. */
  modelsUrl: string;
  /** Always set up, as the speech server needs it. */
  spokenVoice: EngineModel;
  models: ChoosableModel[];
}

export const engineSources = (modelsUrl: string): EngineSources => ({
  uv: {
    url: "https://github.com/astral-sh/uv/releases/download/0.13.4/uv-aarch64-apple-darwin.tar.gz",
    sha256: "e0b1d4743ce64c55d9f0f4a444afa6b81125680070ee04e853fcd0f6c1ebf8f1",
  },
  pythonVersion: "3.12.15",
  lockFile: join(import.meta.dir, "requirements.lock"),
  modelsUrl,
  spokenVoice: SPOKEN_VOICE,
  models: choosableModels,
});

/** Kokoro's sample recordings and the repositories' readmes; the servers never read them. */
export const isUnusedModelFile = (path: string) => path.endsWith(".md") || path === ".gitattributes" || path.startsWith("samples/");

/** mlx-audio tells a model's kind from its folder's name when its config doesn't say, as Kokoro's doesn't. */
export const modelFolderName = ({ repo }: EngineModel) => repo.split("/").at(-1)!;

/** As a file: mlx-audio looks a voice given by name up on Hugging Face, which the engine never reaches. */
const kokoroVoice = (modelDir: string) => join(modelDir, "voices", "am_fenrir.safetensors");

/** The female voice the owner chose by ear, which OmniVoice made itself; asked only for a female voice, it makes up a new one each time. */
const HUNGARIAN_VOICE_CLIP = {
  path: join(import.meta.dir, "hungarian-voice.wav"),
  text: "Lefuttattam az e2e teszteket a Fedora gépen. Kettő elbukott, a beállítások oldal és a hangfelvétel teszt, a többi rendben van.",
};

/** How this Mac's engine speaks with the reply voice, by id: Kokoro in one of its voices, OmniVoice in Hungarian, copying the clip's voice. */
export function speakingVoice(model: string, modelDir: string): SpeakingVoice {
  if (model === SPOKEN_VOICE.id) return { voice: kokoroVoice(modelDir) };
  return { lang_code: "hu", ref_audio: HUNGARIAN_VOICE_CLIP.path, ref_text: HUNGARIAN_VOICE_CLIP.text };
}
