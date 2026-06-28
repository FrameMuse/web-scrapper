import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

function generateAlertWav(): Uint8Array {
  const sampleRate = 44100;
  const duration = 0.3;
  const frequency = 880;
  const amplitude = 0.5;
  const numSamples = Math.floor(sampleRate * duration);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;

  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);

  const w = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };

  w(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  w(36, "data");
  v.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin(2 * Math.PI * frequency * i / sampleRate);
    v.setInt16(44 + i * 2, Math.floor(s * amplitude * 32767), true);
  }

  return new Uint8Array(buf);
}

let wavData: Uint8Array | null = null;

export async function playAlertSound(): Promise<void> {
  if (!wavData) wavData = generateAlertWav();

  const tmpFile = join(tmpdir(), `scrape-alert-${process.pid}.wav`);

  try {
    await writeFile(tmpFile, wavData);
    const proc = Bun.spawn(["paplay", tmpFile], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    proc.unref();
    proc.finished.then(() => unlink(tmpFile).catch(() => {}));
  } catch {
    try {
      const proc = Bun.spawn(["aplay", tmpFile], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.unref();
      proc.finished.then(() => unlink(tmpFile).catch(() => {}));
    } catch {
      process.stderr.write("\x07");
    }
  }
}
