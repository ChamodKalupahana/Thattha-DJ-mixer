export async function fetchBlobUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  // Some Chrome builds fail on response.blob() for large bodies; arrayBuffer
  // always works, so construct the Blob explicitly.
  return URL.createObjectURL(new Blob([await res.arrayBuffer()]));
}

/**
 * The ffmpeg.wasm core ships as a UMD file (var createFFmpegCore). Loading it
 * via dynamic import cannot feed the multi-thread runtime the classic script
 * URL it must pass to its spawned workers, so instead we evaluate the UMD in
 * global scope to obtain the constructor and keep a blob URL of the raw
 * classic script for the workers to importScripts().
 */
export async function loadCoreConstructor(
  url: string,
  crateGlobal = '__createFFmpegCore',
): Promise<{ fn: (opts?: Record<string, unknown>) => unknown; classicUrl: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  const classicUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const source = `${text}\n;globalThis.${crateGlobal} = typeof createFFmpegCore !== 'undefined' ? createFFmpegCore : globalThis.${crateGlobal};\n`;
  // indirect eval runs in global scope so `var createFFmpegCore` becomes global
  (0, eval)(source);
  const fn = (globalThis as unknown as Record<string, unknown>)[crateGlobal];
  if (typeof fn !== 'function') {
    URL.revokeObjectURL(classicUrl);
    throw new Error(`FFmpeg core did not expose a constructor: ${url}`);
  }
  return { fn: fn as (opts?: Record<string, unknown>) => unknown, classicUrl };
}

export function base64EncodeFromU8(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function u8FromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64EncodeBuffer(buf: ArrayBuffer): string {
  return base64EncodeFromU8(new Uint8Array(buf));
}

/**
 * Encode the exact viewed region of a Float32Array (respecting byteOffset and
 * byteLength) so subarray views like the analysis waveform encode correctly.
 */
export function f32ToBase64(data: Float32Array): string {
  return base64EncodeFromU8(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  );
}

export function f32FromBase64(b64: string): Float32Array {
  const bytes = u8FromBase64(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}