import type { FFmpeg } from '@ffmpeg.wasm/main';
import { runFFmpeg, fsRead, fsUnlink } from './instance';

export interface AnalysisResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  waveform: Float32Array | null;
  waveformHz: number;
}

const WAVE_RATE = 8000;
const BUCKET_MS = 20;

export interface CodecCaps {
  loudnorm: boolean;
  libmp3lame: boolean;
}

let capsPromise: Promise<CodecCaps> | null = null;

export function getCodecCaps(): Promise<CodecCaps> {
  if (!capsPromise) {
    capsPromise = (async () => {
      const filters = await runFFmpeg(['-filters']);
      const codecs = await runFFmpeg(['-codecs']);
      const both = `${filters.output}\n${codecs.output}`;
      return {
        loudnorm: /\bloudnorm\b/.test(both),
        libmp3lame: /libmp3lame/.test(both),
      };
    })().catch(() => ({ loudnorm: false, libmp3lame: false }));
  }
  return capsPromise;
}

function parseDurationFromOutput(output: string): number {
  const m = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseProbeLines(output: string): {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
} {
  let durationSec = parseDurationFromOutput(output);
  let width = 0;
  let height = 0;
  let fps = 0;
  let hasVideo = false;
  let hasAudio = false;

  for (const line of output.split('\n')) {
    if (/Stream #\d+:\d+[^\n]*Audio:/.test(line)) hasAudio = true;
    if (!/Stream #\d+:\d+[^\n]*Video:/.test(line)) continue;
    hasVideo = true;
    const res = line.match(/(\d{2,5})x(\d{2,5})/);
    if (res) {
      width = Number(res[1]);
      height = Number(res[2]);
    }
    const fr = line.match(/([\d.]+)\s*fps/);
    if (fr) fps = Number(fr[1]);
  }
  return { durationSec, width, height, fps, hasVideo, hasAudio };
}

function computeWaveform(data: Float32Array): Float32Array {
  const perBucket = Math.round((WAVE_RATE * BUCKET_MS) / 1000);
  const bucketCount = Math.max(1, Math.ceil(data.length / perBucket));
  const out = new Float32Array(bucketCount);
  for (let b = 0; b < bucketCount; b++) {
    let sum = 0;
    let count = 0;
    const start = b * perBucket;
    const end = Math.min(data.length, start + perBucket);
    for (let j = start; j < end; j++) {
      const v = data[j] ?? 0;
      sum += v * v;
      count++;
    }
    out[b] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  const peak = out.reduce((a, b) => Math.max(a, b), 0);
  if (peak > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= peak;
  }
  return out;
}

/**
 * Probe a file's streams and render a mono-RMS waveform. Runs inside the FFmpeg
 * worker-core. Never mutates the app's IndexedDB — returns plain data.
 */
export async function analyzeMediaFile(
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<AnalysisResult> {
  const inputName = 'analyze_in.dat';

  const result = await runFFmpeg(
    ['-i', inputName, '-vn', '-ac', '1', '-ar', String(WAVE_RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', 'wave.pcm'],
    {
      outputDuration: 0,
      onProgress,
      fsWork: async (f: FFmpeg) => {
        f.fs.writeFile(inputName, new Uint8Array(await blob.arrayBuffer()));
      },
    },
  );

  const info = parseProbeLines(result.output);

  let waveform: Float32Array | null = null;
  if (result.code === 0) {
    try {
      const pcm = await fsRead('wave.pcm');
      const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
      waveform = computeWaveform(samples);
    } catch {
      waveform = null;
    }
  }

  await fsUnlink([inputName, 'wave.pcm']);

  return {
    durationSec: info.durationSec || 0,
    width: info.width,
    height: info.height,
    fps: info.fps || 30,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    waveform,
    waveformHz: 1000 / BUCKET_MS,
  };
}