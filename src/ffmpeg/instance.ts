import { FFmpeg } from '@ffmpeg.wasm/main';
import coreMtJsUrl from '@ffmpeg.wasm/core-mt/dist/core.js?url';
import coreMtWasmUrl from '@ffmpeg.wasm/core-mt/dist/core.wasm?url';
import coreMtWorkerUrl from '@ffmpeg.wasm/core-mt/dist/core.worker.js?url';
import coreStJsUrl from '@ffmpeg.wasm/core-st/dist/core.js?url';
import coreStWasmUrl from '@ffmpeg.wasm/core-st/dist/core.wasm?url';
import { fetchBlobUrl, loadCoreConstructor } from './util';

// @ffmpeg.wasm 0.13 references `process.env` directly in its published browser
// build. Browsers without a bundler shim throw "process is not defined" when a
// command runs, so provide a minimal global before the core ever executes.
if (typeof (globalThis as Record<string, unknown>).process === 'undefined') {
  (globalThis as Record<string, unknown>).process = { env: { NODE_ENV: 'production' } };
}

export interface RunOptions {
  onProgress?: (fraction: number) => void;
  /** Expected output duration in seconds, used to translate out_time to % */
  outputDuration?: number;
}

export interface RunResult {
  code: number;
  output: string;
}

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** True when the multi-threaded core is usable (SharedArrayBuffer present). */
export function canUseMtCore(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

let blobUrls: string[] = [];
function rememberUrl(url: string): string {
  blobUrls.push(url);
  return url;
}

function revokeUrls(): void {
  for (const u of blobUrls) URL.revokeObjectURL(u);
  blobUrls = [];
}

export function isFFmpegLoaded(): boolean {
  return ffmpeg !== null;
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    const useMt = canUseMtCore();
    const { fn, classicUrl } = await loadCoreConstructor(
      useMt ? coreMtJsUrl : coreStJsUrl,
    );
    const mainScriptUrlOrBlob = rememberUrl(classicUrl);
    const wasmUrl = rememberUrl(await fetchBlobUrl(useMt ? coreMtWasmUrl : coreStWasmUrl));
    const workerUrl = useMt ? rememberUrl(await fetchBlobUrl(coreMtWorkerUrl)) : undefined;

    try {
      const coreFactory = (moduleArg?: Record<string, unknown>) =>
        fn({ ...moduleArg, mainScriptUrlOrBlob });
      const inst = await FFmpeg.create({
        core: coreFactory as never,
        coreOptions: {
          wasmPath: wasmUrl,
          ...(workerUrl ? { workerPath: workerUrl } : {}),
        },
        log: true,
        logger: (level, ...msg) => {
          const line = msg.join(' ');
          collectLog(level, line);
        },
      });
      return inst;
    } catch (err) {
      loading = null;
      throw new Error(`Failed to start the FFmpeg worker core: ${String(err)}`);
    }
  })();
  return loading;
}

/** Serialize all FFmpeg work — only one exec at a time. */
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

export async function fsWrite(name: string, data: Uint8Array): Promise<void> {
  return enqueue(async () => {
    const f = await getFFmpeg();
    f.fs.writeFile(name, data);
  });
}

export async function fsRead(name: string): Promise<Uint8Array> {
  return enqueue(async () => {
    const f = await getFFmpeg();
    return f.fs.readFile(name);
  });
}

export async function fsUnlink(names: string[]): Promise<void> {
  if (names.length === 0) return;
  return enqueue(async () => {
    const f = await getFFmpeg();
    for (const name of names) {
      try {
        f.fs.unlink(name);
      } catch {
        /* already gone */
      }
    }
  });
}

let logCollector: { lines: string[] } | null = null;
let progressCollector: ((line: string) => void) | null = null;

function collectLog(level: string, line: string): void {
  if (logCollector) logCollector.lines.push(line);
  if (level === 'info' && progressCollector) progressCollector(line);
}

/**
 * Run a single ffmpeg command against the shared core. The exec and all FS
 * writes/reads happen inside one queue slot so no two commands interleave.
 */
export function runFFmpeg(
  args: string[],
  opts: RunOptions & { fsWork?: (f: FFmpeg) => Promise<void> } = {},
): Promise<RunResult> {
  return enqueue(async () => {
    const f = await getFFmpeg();
    const lines: string[] = [];
    const collector = { lines };
    const progress = opts.onProgress;
    const duration = opts.outputDuration;

    logCollector = collector;
    progressCollector = progress && duration
      ? (line) => {
          let seconds: number | null = null;
          const mUs = line.match(/out_time_us=(\d+)/);
          if (mUs) {
            seconds = Number(mUs[1]) / 1e6;
          } else {
            const mMs = line.match(/out_time_ms=(\d+)/);
            if (mMs) seconds = Number(mMs[1]);
          }
          if (seconds !== null && duration > 0) {
            progress(Math.min(1, Math.max(0, seconds / duration)));
          }
        }
      : null;

    try {
      if (opts.fsWork) await opts.fsWork(f);
      let code: number;
      try {
        code = await f.run(...args);
      } catch (err) {
        if (err instanceof Error) {
          err.message = `${err.message}${lines.length ? `\n--- ffmpeg output ---\n${lines.join('\n')}` : ''}`;
        }
        throw err;
      }
      return { code, output: lines.join('\n') };
    } finally {
      logCollector = null;
      progressCollector = null;
    }
  });
}

/**
 * Free the wasm instance and its ~1GB of addressable memory. Call after long
 * renders / analysis batches: load lazily, unload aggressively.
 */
export async function unloadFFmpeg(): Promise<void> {
  if (loading) {
    await loading.catch(() => {});
  }
  const f = ffmpeg;
  ffmpeg = null;
  loading = null;
  if (f) {
    try {
      await f.exit('wait');
    } catch {
      /* core already gone */
    }
  }
  revokeUrls();
}

export function getCoreKind(): 'mt' | 'st' {
  return canUseMtCore() ? 'mt' : 'st';
}