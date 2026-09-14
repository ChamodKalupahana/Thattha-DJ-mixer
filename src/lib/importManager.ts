import type { AnalysisResult } from '../ffmpeg/analyze';
import { analyzeMediaFile } from '../ffmpeg/analyze';
import { putRecord } from '../db/db';
import type { VideoInfo } from '../db/types';
import { probeWithVideo, type MediaProbe } from '../media/probe';
import { makeTitleCardBlob } from './titleCard';
import { newId } from './util';

export const MAX_FILE_SIZE = 900 * 1024 * 1024; // wasm 1GB hard cap, keep margin

const VIDEO_MIME = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/ogg',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
];
const AUDIO_MIME = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/opus',
  'audio/x-wav',
];
const EXTENSIONS = [
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.ogv',
  '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus',
];

export type ImportStage = 'probing' | 'analyzing';

export class ImportError extends Error {
  constructor(
    public code: 'too-big' | 'unsupported' | 'analysis-failed',
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export function isImportable(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (VIDEO_MIME.includes(mime) || AUDIO_MIME.includes(mime)) return true;
  const name = file.name.toLowerCase();
  for (const ext of EXTENSIONS) if (name.endsWith(ext)) return true;
  return false;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function mergeProbe(probe: MediaProbe, analysis: AnalysisResult): {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
} {
  const hasVideo = analysis.hasVideo || (probe.width > 0 && probe.height > 0);
  return {
    durationSec: probe.durationSec > 0 ? probe.durationSec : analysis.durationSec,
    width: analysis.width > 0 ? analysis.width : probe.width,
    height: analysis.height > 0 ? analysis.height : probe.height,
    fps: analysis.fps > 0 ? analysis.fps : probe.fps || 30,
    hasVideo,
    hasAudio: analysis.hasAudio,
  };
}

/**
 * Import one file: probe via hidden <video>, decode a waveform with ffmpeg.wasm,
 * then persist both the raw bytes and the metadata record into IndexedDB.
 * Callers should call unloadFFmpeg() after a batch is done.
 */
export async function importOneFile(
  file: File,
  onStage?: (stage: ImportStage) => void,
): Promise<VideoInfo> {
  if (file.size > MAX_FILE_SIZE) {
    throw new ImportError('too-big', `file ${file.name} exceeds ${MAX_FILE_SIZE}`);
  }
  if (!isImportable(file)) {
    throw new ImportError('unsupported', `unsupported type for ${file.name}`);
  }

  onStage?.('probing');
  const probe = await probeWithVideo(file);

  onStage?.('analyzing');
  const analysis = await analyzeMediaFile(file, () => {});

  const merged = mergeProbe(probe, analysis);
  const id = newId();

  let thumb = probe.thumb;
  if (!thumb && !merged.hasVideo) {
    try {
      const card = await makeTitleCardBlob(320, 180, defaultTitle(file.name));
      thumb = await blobToDataURL(card);
    } catch {
      thumb = '';
    }
  }

  const video: VideoInfo = {
    id,
    title: defaultTitle(file.name),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    durationSec: merged.durationSec,
    width: merged.width,
    height: merged.height,
    fps: merged.fps || 30,
    hasVideo: merged.hasVideo,
    hasAudio: merged.hasAudio,
    waveform: analysis.waveform,
    waveformHz: analysis.waveformHz,
    thumb,
    addedAt: Date.now(),
  };

  await putRecord('files', id, { id, blob: file });
  await putRecord('videos', id, video);
  return video;
}

function defaultTitle(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return base.replace(/[_]+/g, ' ').trim() || 'Untitled';
}
