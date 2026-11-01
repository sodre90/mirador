import { inDesktopApp } from "./desktop-bridge.ts";
import { microphoneProblem, NO_MICROPHONE_API, type MicrophonePlace } from "./dictation.ts";
import type { SpeechSpan } from "./pause-watch.ts";
import { wavOf } from "./wav.ts";

const SPEECH_SAMPLE_RATE = 16_000;
const LEVEL_EVERY_MS = 100;
const CAPTURE_FRAMES = 4096;

export class MicrophoneProblem extends Error {}

export interface Recording {
  /** Ends the recording, giving what was said as 16 kHz mono WAV: all of it, or the span where speech was heard. */
  finish(span?: SpeechSpan | null): Promise<Blob>;
  cancel(): void;
}

function microphonePlace(): MicrophonePlace {
  const { userAgent } = navigator;
  return { desktopApp: inDesktopApp(), secure: window.isSecureContext, system: userAgent.includes("Mac") ? "mac" : userAgent.includes("Windows") ? "windows" : "other" };
}

async function microphone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicrophoneProblem(microphoneProblem(NO_MICROPHONE_API, microphonePlace()));
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new MicrophoneProblem(microphoneProblem(name, microphonePlace(), error instanceof Error ? error.message : String(error)));
  }
}

const rootMeanSquare = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);

function joined(chunks: Float32Array[]) {
  const samples = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  chunks.reduce((offset, chunk) => {
    samples.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  return samples;
}

/** Playing the samples into a 16 kHz context resamples them. */
async function asSpeechClip(samples: Float32Array<ArrayBuffer>, sampleRate: number) {
  const length = Math.max(1, samples.length);
  const resampling = new OfflineAudioContext(1, Math.ceil((length * SPEECH_SAMPLE_RATE) / sampleRate), SPEECH_SAMPLE_RATE);
  const recorded = resampling.createBuffer(1, length, sampleRate);
  recorded.copyToChannel(samples, 0);
  const playing = resampling.createBufferSource();
  playing.buffer = recorded;
  playing.connect(resampling.destination);
  playing.start();
  return new Blob([wavOf((await resampling.startRendering()).getChannelData(0), SPEECH_SAMPLE_RATE)], { type: "audio/wav" });
}

/**
 * Starts listening, telling the microphone's level as it goes, and once when its first samples come in: until then,
 * the microphone may still be starting, and what is said is lost. Call it from the press itself: its audio context is
 * made before the first await, while the browser still counts the press as the user's, or it may stay suspended.
 *
 * The samples are taken as they are, not through MediaRecorder, which needs encoders WebKitGTK's GStreamer lacks unless
 * extra plugins are installed. ScriptProcessorNode is deprecated for AudioWorklet, whose module the page's CSP would
 * have to serve, but every engine still runs it.
 */
export async function startRecording(onLevel: (level: number) => void, onRecording: () => void): Promise<Recording> {
  const listening = new AudioContext();
  void listening.resume();
  let stream: MediaStream;
  try {
    stream = await microphone();
  } catch (error) {
    void listening.close();
    throw error;
  }
  // WebKit lets a page start audio without a press once it captures the microphone.
  void listening.resume();
  const source = listening.createMediaStreamSource(stream);
  const analyser = listening.createAnalyser();
  const capture = listening.createScriptProcessor(CAPTURE_FRAMES, 1, 1);
  // A script processor runs only while connected to the output; a gain of 0 keeps the microphone out of the speakers.
  const silent = listening.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  capture.addEventListener("audioprocess", (event) => {
    if (chunks.length === 0) onRecording();
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  });
  source.connect(analyser);
  source.connect(capture).connect(silent).connect(listening.destination);
  const latestSamples = new Float32Array(analyser.fftSize);
  const tellLevel = setInterval(() => {
    analyser.getFloatTimeDomainData(latestSamples);
    onLevel(rootMeanSquare(latestSamples));
  }, LEVEL_EVERY_MS);
  const release = () => {
    clearInterval(tellLevel);
    capture.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void listening.close();
  };
  return {
    async finish(span) {
      release();
      const samples = joined(chunks);
      const at = (ms: number) => Math.min(samples.length, Math.round((ms / 1000) * listening.sampleRate));
      return asSpeechClip(span ? samples.slice(at(span.fromMs), at(span.toMs)) : samples, listening.sampleRate);
    },
    cancel: release,
  };
}
