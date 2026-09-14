import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as db from '../db/db';
import type { Lang, Mix, MixOutput, VideoInfo } from '../db/types';
import { importOneFile, isImportable, MAX_FILE_SIZE, type ImportStage } from '../lib/importManager';
import { newId } from '../lib/util';
import { unloadFFmpeg } from '../ffmpeg/instance';

export interface ImportJob {
  id: string;
  name: string;
  status: 'queued' | 'probing' | 'analyzing' | 'done' | 'error';
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface AddFilesResult {
  imported: number;
  failed: number;
  skipped: number;
  tooBig: number;
}

export interface StoreValue {
  ready: boolean;
  videos: VideoInfo[];
  mixes: Mix[];
  outputs: MixOutput[];
  lang: Lang;
  setLang: (l: Lang) => void;
  importQueue: ImportJob[];
  addFiles: (files: FileList | File[]) => Promise<AddFilesResult>;
  renameVideo: (id: string, title: string) => Promise<void>;
  deleteVideo: (id: string) => Promise<boolean>;
  saveMix: (mix: Mix) => Promise<void>;
  deleteMix: (id: string) => Promise<void>;
  addOutput: (o: {
    mixId: string | null;
    title: string;
    mime: string;
    blob: Blob;
  }) => Promise<MixOutput>;
  deleteOutput: (id: string) => Promise<void>;
  getFileBlob: (videoId: string) => Promise<Blob | undefined>;
  getVideo: (videoId: string) => VideoInfo | undefined;
  refresh: () => Promise<void>;
  toasts: Toast[];
  pushToast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [outputs, setOutputs] = useState<MixOutput[]>([]);
  const [lang, setLangState] = useState<Lang>('en');
  const [importQueue, setImportQueue] = useState<ImportJob[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refresh = useCallback(async () => {
    const [vs, ms, os, settings] = await Promise.all([
      db.getAllRecords('videos'),
      db.getAllRecords('mixes'),
      db.getAllRecords('outputs'),
      db.getRecord('settings', 'default'),
    ]);
    setVideos(vs.sort((a, b) => b.addedAt - a.addedAt));
    setMixes(ms.sort((a, b) => b.updatedAt - a.updatedAt));
    setOutputs(os.sort((a, b) => b.createdAt - a.createdAt));
    if (settings) setLangState(settings.lang);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    await db.putRecord('settings', 'default', { lang: l });
  }, []);

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = newId();
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]): Promise<AddFilesResult> => {
      const arr = Array.from(files);
      let tooBig = 0;
      const valid = arr.filter((f) => {
        if (f.size > MAX_FILE_SIZE) {
          tooBig++;
          return false;
        }
        return isImportable(f);
      });
      const skipped = arr.length - valid.length - tooBig;

      if (valid.length === 0) {
        return { imported: 0, failed: 0, skipped, tooBig };
      }

      const jobs: ImportJob[] = valid.map((f) => ({
        id: newId(),
        name: f.name,
        status: 'queued',
      }));
      setImportQueue((q) => [...q, ...jobs]);

      let imported = 0;
      let failed = 0;
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        const job = jobs[i];
        const mark = (status: ImportJob['status']) =>
          setImportQueue((q) => q.map((j) => (j.id === job.id ? { ...j, status } : j)));
        mark('probing');
        try {
          await importOneFile(file, (stage: ImportStage) =>
            mark(stage === 'probing' ? 'probing' : 'analyzing'),
          );
          imported++;
          mark('done');
        } catch (err) {
          failed++;
          mark('error');
          console.error('[import] failed:', file.name, err);
        }
      }

      setImportQueue((q) => q.filter((j) => !jobs.some((jb) => jb.id === j.id)));
      if (imported > 0) await refresh();
      await unloadFFmpeg();
      return { imported, failed, skipped, tooBig };
    },
    [refresh],
  );

  const renameVideo = useCallback(async (id: string, title: string) => {
    const v = videos.find((x) => x.id === id);
    if (!v) return;
    const next = { ...v, title };
    await db.putRecord('videos', id, next);
    setVideos((vs) => vs.map((x) => (x.id === id ? next : x)));
  }, [videos]);

  const deleteVideo = useCallback(
    async (id: string): Promise<boolean> => {
      await db.deleteRecord('files', id);
      await db.deleteRecord('videos', id);
      let changed = false;
      const nextMixes = mixes.map((m) => {
        if (!m.clips.some((c) => c.videoId === id)) return m;
        changed = true;
        const clips = m.clips.filter((c) => c.videoId !== id);
        let ti = 0;
        const transitions = [];
        for (let k = 0; k < clips.length - 1; k++) {
          transitions.push(m.transitions[ti] ?? { type: 'smooth' as const, dur: 5 });
          ti++;
        }
        return { ...m, clips, transitions, updatedAt: Date.now() };
      });
      if (changed) {
        setMixes(nextMixes);
        for (const m of nextMixes) await db.putRecord('mixes', m.id, m);
      }
      setVideos((vs) => vs.filter((x) => x.id !== id));
      return true;
    },
    [mixes],
  );

  const saveMix = useCallback(async (mix: Mix) => {
    const now = Date.now();
    const next = { ...mix, updatedAt: now, createdAt: mix.createdAt || now };
    await db.putRecord('mixes', next.id, next);
    setMixes((ms) => {
      const exists = ms.some((x) => x.id === next.id);
      const list = exists ? ms.map((x) => (x.id === next.id ? next : x)) : [...ms, next];
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const deleteMix = useCallback(async (id: string) => {
    await db.deleteRecord('mixes', id);
    setMixes((ms) => ms.filter((x) => x.id !== id));
  }, []);

  const addOutput = useCallback(
    async (o: { mixId: string | null; title: string; mime: string; blob: Blob }) => {
      const out: MixOutput = {
        id: newId(),
        mixId: o.mixId,
        title: o.title,
        mime: o.mime,
        size: o.blob.size,
        blob: o.blob,
        createdAt: Date.now(),
      };
      await db.putRecord('outputs', out.id, out);
      setOutputs((os) => [out, ...os]);
      return out;
    },
    [],
  );

  const deleteOutput = useCallback(async (id: string) => {
    await db.deleteRecord('outputs', id);
    setOutputs((os) => os.filter((x) => x.id !== id));
  }, []);

  const getFileBlob = useCallback(async (videoId: string) => {
    const rec = await db.getRecord('files', videoId);
    return rec?.blob;
  }, []);

  const getVideo = useCallback(
    (videoId: string) => videos.find((v) => v.id === videoId),
    [videos],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      videos,
      mixes,
      outputs,
      lang,
      setLang,
      importQueue,
      addFiles,
      renameVideo,
      deleteVideo,
      saveMix,
      deleteMix,
      addOutput,
      deleteOutput,
      getFileBlob,
      getVideo,
      refresh,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      ready, videos, mixes, outputs, lang, setLang, importQueue, addFiles,
      renameVideo, deleteVideo, saveMix, deleteMix, addOutput, deleteOutput,
      getFileBlob, getVideo, refresh, toasts, pushToast, dismissToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
