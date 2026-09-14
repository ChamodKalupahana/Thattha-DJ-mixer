import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { f32FromBase64, f32ToBase64 } from '../ffmpeg/util';
import { newId } from './util';
import type {
  Mix,
  MixOutput,
  Settings,
  VideoFile,
  VideoInfo,
} from '../db/types';

export interface BackupManifest {
  files: { id: string; oldId: string }[];
  videos: { id: string; oldId: string; waveformB64: string | null }[];
  mixes: Mix[];
  outputs: MixOutput[];
  settings: Settings;
}

function toVideoWire(v: VideoInfo): VideoInfo & { waveformB64: string | null } {
  return {
    ...v,
    waveformB64: v.waveform ? f32ToBase64(v.waveform) : null,
  };
}

function fromVideoWire(w: VideoInfo & { waveformB64?: string | null }): VideoInfo {
  const { waveformB64, ...rest } = w;
  return {
    ...rest,
    waveform: waveformB64 ? f32FromBase64(waveformB64) : null,
  };
}

export interface RestoreReport {
  videos: number;
  mixes: number;
}

export async function createBackup(options: {
  files: Map<string, Blob>;
  videos: VideoInfo[];
  mixes: Mix[];
  outputs: MixOutput[];
  settings: Settings;
}): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter('application/zip'), {
    bufferedWrite: true,
  });
  const json = (obj: unknown) => new TextReader(JSON.stringify(obj));

  for (const [id, blob] of options.files) {
    await zip.add(`files/${id}`, new BlobReader(blob), { level: 0 });
  }
  await zip.add('videos.json', json(options.videos.map(toVideoWire)));
  await zip.add('mixes.json', json(options.mixes));
  await zip.add('outputs.json', json(options.outputs));
  await zip.add('settings.json', json(options.settings));
  await zip.add('manifest.json', json({ version: 1 }));

  return zip.close();
}

export async function restoreBackup(file: Blob): Promise<RestoreReport> {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();

  const videoFileEntries = new Map<string, Blob>();
  const videosWire: (VideoInfo & { waveformB64?: string | null })[] = [];
  const mixes: Mix[] = [];
  const outputs: MixOutput[] = [];
  let settings: Settings = { lang: 'en' };
  let manifestOk = false;

  for (const entry of entries) {
    if (entry.directory) continue;
    const filename = entry.filename;
    if (filename.startsWith('files/')) {
      const oldId = filename.slice('files/'.length);
      const blob = await entry.getData(new BlobWriter());
      videoFileEntries.set(oldId, blob);
    } else if (filename === 'videos.json') {
      videosWire.push(...(JSON.parse(await entry.getData(new TextWriter())) as typeof videosWire));
    } else if (filename === 'mixes.json') {
      mixes.push(...(JSON.parse(await entry.getData(new TextWriter())) as Mix[]));
    } else if (filename === 'outputs.json') {
      outputs.push(...(JSON.parse(await entry.getData(new TextWriter())) as MixOutput[]));
    } else if (filename === 'settings.json') {
      settings = JSON.parse(await entry.getData(new TextWriter())) as Settings;
    } else if (filename === 'manifest.json') {
      manifestOk = true;
    }
  }
  await reader.close();

  if (!manifestOk) {
    throw new Error('not a DJ Mixer backup');
  }

  const oldVideoToNew = new Map<string, string>();
  const videoItems: { key: string; value: VideoInfo }[] = [];
  for (const wire of videosWire) {
    const id = newId();
    oldVideoToNew.set(wire.id, id);
    videoItems.push({
      key: id,
      value: { ...fromVideoWire(wire), id, addedAt: Date.now() },
    });
  }

  const fileItems: { key: string; value: VideoFile }[] = [];
  for (const [oldId, blob] of videoFileEntries) {
    const id = oldVideoToNew.get(oldId) ?? newId();
    fileItems.push({ key: id, value: { id, blob } });
  }

  const oldMixToNew = new Map<string, string>();
  const mixItems: { key: string; value: Mix }[] = mixes.map((m) => {
    const id = newId();
    oldMixToNew.set(m.id, id);
    const clips = m.clips.map((c) => ({
      ...c,
      videoId: oldVideoToNew.get(c.videoId) ?? c.videoId,
    }));
    return {
      key: id,
      value: {
        ...m,
        id,
        clips,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
  });

  const outputItems: { key: string; value: MixOutput }[] = outputs.map((o) => {
    const id = newId();
    return {
      key: id,
      value: {
        ...o,
        id,
        mixId: o.mixId ? (oldMixToNew.get(o.mixId) ?? null) : null,
        createdAt: Date.now(),
      },
    };
  });

  const db = await import('../db/db');
  if (fileItems.length) await db.putRecords('files', fileItems);
  if (videoItems.length) await db.putRecords('videos', videoItems);
  if (mixItems.length) await db.putRecords('mixes', mixItems);
  if (outputItems.length) await db.putRecords('outputs', outputItems);
  await db.putRecord('settings', 'default', settings);

  return { videos: videoItems.length, mixes: mixItems.length };
}