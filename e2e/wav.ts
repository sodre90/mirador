/** 16-bit mono PCM, which every browser and speech server reads. */
export function wavFile(samples: number[], rate: number) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples.length * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return wav;
}

/** A tone of the length, as a speech server's answer that a page can decode and play. */
export const toneWav = (seconds: number, rate = 24_000) =>
  wavFile(
    Array.from({ length: Math.round(seconds * rate) }, (_, index) => 0.2 * Math.sin((2 * Math.PI * 220 * index) / rate)),
    rate,
  );
