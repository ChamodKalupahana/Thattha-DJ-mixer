import type { Mix, VideoInfo } from '../db/types';
import { fsRead, fsUnlink, runFFmpeg } from './instance';
import { getCodecCaps } from './analyze';
import { resolveTransitions, transitionName } from '../lib/transitions';
import { makeTitleCardBlob } from '../lib/titleCard';
import { readBlobAsU8 } from '../lib/util';

export type RenderQuality = 'fast' | 'good';
export type RenderFormat = 'video' | 'audio';

export interface RenderProgress {
  phase: 'prepare' | 'stitch';
  fraction: number;
}

export interface RenderOptions {
  mix: Mix;
  getBlob: (videoId: string) => Promise<Blob | undefined>;
  getVideo: (videoId: string) => VideoInfo | undefined;
  quality: RenderQuality;
  format: RenderFormat;
  onProgress?: (p: RenderProgress) => void;
  onLog?: (line: string) => void;
}

export interface RenderResult {
  blob: Blob;
  mime: string;
  name: string;
}

export class RenderError extends Error {
  code: 'oom' | 'big' | 'unsupported' | 'generic';
  constructor(code: RenderError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_INPUT_BYTES = 750 * 1024 * 1024;
const LARGE_TOTAL = 350 * 1024 * 1024;
const MANY_CLIPS = 6;
const CUT_DURATION = 0.04;

function sanitize(s: string): string {
  return s.replace(/[\/\\:*?"<>|]/g, '-');
}

function toBlob(u8: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return new Blob([copy], { type: mime });
}

interface StreamRef {
  inputArgs: string[];
  vIdx: number;
  aIdx: number;
  in: number;
  out: number;
}

export async function renderMix(opts: RenderOptions): Promise<RenderResult> {
  const clips = opts.mix.clips;
  const n = clips.length;
  if (n < 1) throw new RenderError('generic', 'empty mix');

  const infos: VideoInfo[] = [];
  const inS: number[] = [];
  const outS: number[] = [];
  const Ls: number[] = [];
  for (const c of clips) {
    const v = opts.getVideo(c.videoId);
    if (!v) throw new RenderError('generic', 'missing video');
    infos.push(v);
    inS.push(c.in);
    outS.push(c.out);
    Ls.push(Math.max(0, c.out - c.in));
  }

  const resolved = resolveTransitions(clips, Ls, opts.mix.transitions);
  const Dact: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    Dact.push(opts.mix.transitions[k]?.type === 'cut' ? CUT_DURATION : resolved.overlaps[k]);
  }
  let total = Ls.reduce((a, b) => a + b, 0) - Dact.reduce((a, b) => a + b, 0);
  if (total < 0) total = 0;

  const blobs = await Promise.all(clips.map((c) => opts.getBlob(c.videoId)));
  if (blobs.some((b) => !b)) throw new RenderError('generic', 'missing blob');
  const u8blobs = await Promise.all((blobs as Blob[]).map(readBlobAsU8));
  const totalBytes = u8blobs.reduce((a, b) => a + b.byteLength, 0);
  if (totalBytes > MAX_INPUT_BYTES) throw new RenderError('big', 'input too large');

  let caps = { loudnorm: false, libmp3lame: false };
  try {
    caps = await getCodecCaps();
  } catch {
    /* keep defaults */
  }

  const title = sanitize(opts.mix.title || 'mix');
  const onLog = (output: string) => {
    if (!opts.onLog) return;
    for (const line of output.split('\n')) if (line) opts.onLog(line);
  };
  const emitStitch = (frac: number) => opts.onProgress?.({ phase: 'stitch', fraction: frac });
  const emitPrepare = (frac: number) => opts.onProgress?.({ phase: 'prepare', fraction: frac });

  if (opts.format === 'audio') {
    return renderAudio({
      n, infos, inS, outS, Dact, total, u8blobs, caps, title,
      onLog, emitStitch,
    });
  }

  const W = opts.quality === 'fast' ? 1280 : 1920;
  const H = opts.quality === 'fast' ? 720 : 1080;

  const widthsUniform = new Set(infos.map((v) => v.width)).size === 1;
  const heightsUniform = new Set(infos.map((v) => v.height)).size === 1;
  const allVideo = infos.every((v) => v.hasVideo);
  const fpsUniform = infos.every((v, i) => i === 0 || Math.abs(infos[0].fps - v.fps) <= 1.0);
  const isUniform = allVideo && widthsUniform && heightsUniform && fpsUniform;
  const useTwoPass = !isUniform || totalBytes > LARGE_TOTAL || clips.length > MANY_CLIPS;

  const clipStreams = (k: number): StreamRef => {
    const info = infos[k];
    const hasV = info.hasVideo;
    const hasA = info.hasAudio;
    const inputArgs: string[] = [];
    // Inputs can carry extra option flags (-loop/-framerate for the title card,
    // -f for anullsrc), so inputArgs.length / 2 is NOT the stream index. Count
    // actual inputs instead.
    let inputCount = 0;
    const vIdx = inputCount++;
    if (hasV) {
      inputArgs.push('-i', `in_${k}.dat`);
    } else {
      inputArgs.push('-loop', '1', '-framerate', '30', '-i', `title_${k}.png`);
    }
    const aIdx = inputCount++;
    if (hasA) {
      inputArgs.push('-i', `in_${k}.dat`);
    } else {
      inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    }
    return {
      inputArgs,
      vIdx,
      aIdx,
      in: hasV ? inS[k] : 0,
      out: hasV ? outS[k] : Ls[k],
    };
  };

  const buildStitchGraph = (streams: StreamRef[], useLoudnorm: boolean): string[] => {
    const segs: string[] = [];
    const audioLoud = useLoudnorm ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : '';
    for (let k = 0; k < n; k++) {
      const s = streams[k];
      segs.push(
        `[${s.vIdx}:v]trim=start=${s.in}:end=${s.out},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p[v${k}]`,
      );
      segs.push(
        `[${s.aIdx}:a]atrim=start=${s.in}:end=${s.out},asetpts=PTS-STARTPTS,aresample=48000${audioLoud},aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`,
      );
    }
    let T = Ls[0];
    for (let k = 1; k < n; k++) {
      const D = Dact[k - 1];
      const O = T - D;
      const tr = transitionName(opts.mix.transitions[k - 1]?.type ?? 'smooth');
      const prev = k === 1 ? 'v0' : `x${k - 1}`;
      segs.push(`[${prev}][v${k}]xfade=transition=${tr}:duration=${D}:offset=${O}[x${k}]`);
      T = T - D + Ls[k];
    }
    for (let k = 1; k < n; k++) {
      const prev = k === 1 ? 'a0' : `aa${k - 1}`;
      const next = k === n - 1 ? 'aout' : `aa${k}`;
      segs.push(`[${prev}][a${k}]acrossfade=d=${Dact[k - 1]}[${next}]`);
    }
    return segs;
  };

  const buildStitchArgs = (streams: StreamRef[], useLoudnorm: boolean): string[] => {
    const inputArgs = streams.flatMap((s) => s.inputArgs);
    const vMap = n === 1 ? '[v0]' : `[x${n - 1}]`;
    const aMap = n === 1 ? '[a0]' : '[aout]';
    return [
      ...inputArgs,
      '-filter_complex',
      buildStitchGraph(streams, useLoudnorm).join(';'),
      '-map', vMap, '-map', aMap,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4',
    ];
  };

  const writeClipToFs = async (f: any, k: number): Promise<void> => {
    await f.fs.writeFile(`in_${k}.dat`, u8blobs[k]);
    if (!infos[k].hasVideo) {
      const png = await readBlobAsU8(await makeTitleCardBlob(W, H, infos[k].title));
      await f.fs.writeFile(`title_${k}.png`, png);
    }
  };

  const runStitch = async (
    args: string[],
    fsWork?: (f: any) => Promise<void>,
  ): Promise<void> => {
    const res = await runFFmpeg(args, { fsWork, outputDuration: total, onProgress: emitStitch });
    onLog(res.output);
    if (res.code !== 0) throw new Error(res.output || `ffmpeg exited with code ${res.code}`);
  };

  const mapStitchError = (err: unknown): RenderError => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/memory|allocate|Cannot enlarge|out of memory|OOM|abort\(/i.test(msg)) {
      return new RenderError('oom', msg);
    }
    if (/codec|encoder|decoder|pixel format|Error while/i.test(msg)) {
      return new RenderError('unsupported', msg);
    }
    return new RenderError('generic', msg);
  };

  const cleanup: string[] = [];
  try {
    if (useTwoPass) {
      for (let k = 0; k < n; k++) {
        const s = clipStreams(k);
        const vFilter =
          `[${s.vIdx}:v]trim=start=${s.in}:end=${s.out},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p[v]`;
        const aFilter =
          `[${s.aIdx}:a]atrim=start=${s.in}:end=${s.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]`;
        const prepArgs = [
          ...s.inputArgs,
          '-filter_complex', `${vFilter};${aFilter}`,
          '-map', '[v]', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
          '-c:a', 'aac', '-b:a', '192k', `prep_${k}.mp4`,
        ];
        let res: { code: number; output: string };
        try {
          res = await runFFmpeg(prepArgs, { fsWork: (f) => writeClipToFs(f, k) });
        } catch (e) {
          throw mapStitchError(e);
        }
        onLog(res.output);
        if (res.code !== 0) throw new RenderError('unsupported', res.output);
        cleanup.push(`prep_${k}.mp4`);
        await fsUnlink([`in_${k}.dat`, `title_${k}.png`]);
        emitPrepare((k + 1) / n);
      }
      const prepStreams: StreamRef[] = [];
      for (let k = 0; k < n; k++) {
        prepStreams.push({ inputArgs: ['-i', `prep_${k}.mp4`], vIdx: k, aIdx: k, in: 0, out: Ls[k] });
      }
      try {
        await runStitch(buildStitchArgs(prepStreams, false));
      } catch (e) {
        throw mapStitchError(e);
      }
    } else {
      const streams: StreamRef[] = [];
      for (let k = 0; k < n; k++) streams.push(clipStreams(k));
      const writeAll = async (f: any) => {
        for (let k = 0; k < n; k++) await writeClipToFs(f, k);
      };
      try {
        if (caps.loudnorm) {
          try {
            await runStitch(buildStitchArgs(streams, true), writeAll);
          } catch {
            await runStitch(buildStitchArgs(streams, false));
          }
        } else {
          await runStitch(buildStitchArgs(streams, false), writeAll);
        }
      } catch (e) {
        throw mapStitchError(e);
      }
    }
    const out = await fsRead('out.mp4');
    return {
      blob: toBlob(out, 'video/mp4'),
      mime: 'video/mp4',
      name: `${title}.mp4`,
    };
  } finally {
    const names: string[] = ['out.mp4'];
    for (let k = 0; k < n; k++) names.push(`in_${k}.dat`, `title_${k}.png`);
    for (const p of cleanup) names.push(p);
    await fsUnlink([...new Set(names)]);
  }
}

interface AudioContext {
  n: number;
  infos: VideoInfo[];
  inS: number[];
  outS: number[];
  Dact: number[];
  total: number;
  u8blobs: Uint8Array[];
  caps: { loudnorm: boolean; libmp3lame: boolean };
  title: string;
  onLog: (output: string) => void;
  emitStitch: (frac: number) => void;
}

async function renderAudio(ctx: AudioContext): Promise<RenderResult> {
  const { n, infos, inS, outS, Dact, total, u8blobs, caps, title, onLog, emitStitch } = ctx;
  const inputArgs: string[] = [];
  const aIdx: number[] = [];
  const written: string[] = [];
  const writtenBlobs: Uint8Array[] = [];
  let inputCount = 0;
  for (let k = 0; k < n; k++) {
    if (infos[k].hasAudio) {
      aIdx.push(inputCount++);
      inputArgs.push('-i', `in_${k}.dat`);
      written.push(`in_${k}.dat`);
      writtenBlobs.push(u8blobs[k]);
    } else {
      aIdx.push(inputCount++);
      inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    }
  }
  const segs: string[] = [];
  for (let k = 0; k < n; k++) {
    segs.push(
      `[${aIdx[k]}:a]atrim=start=${inS[k]}:end=${outS[k]},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`,
    );
  }
  for (let k = 1; k < n; k++) {
    const prev = k === 1 ? 'a0' : `aa${k - 1}`;
    const next = k === n - 1 ? 'aout' : `aa${k}`;
    segs.push(`[${prev}][a${k}]acrossfade=d=${Dact[k - 1]}[${next}]`);
  }
  const aMap = n === 1 ? '[a0]' : '[aout]';
  const args = [...inputArgs, '-filter_complex', segs.join(';'), '-map', aMap];
  let ext: string;
  let mime: string;
  if (caps.libmp3lame) {
    args.push('-c:a', 'libmp3lame', '-b:a', '192k', 'out.mp3');
    ext = 'mp3';
    mime = 'audio/mpeg';
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k', 'out.m4a');
    ext = 'm4a';
    mime = 'audio/mp4';
  }
  const res = await runFFmpeg(args, {
    outputDuration: total,
    onProgress: emitStitch,
    fsWork: async (f) => {
      for (let i = 0; i < written.length; i++) await f.fs.writeFile(written[i], writtenBlobs[i]);
    },
  });
  onLog(res.output);
  if (res.code !== 0) throw new RenderError('generic', res.output);
  const out = await fsRead('out.' + ext);
  await fsUnlink([...written, 'out.' + ext]);
  return {
    blob: toBlob(out, mime),
    mime,
    name: `${title}.${ext}`,
  };
}
