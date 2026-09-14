import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useI18n } from '../i18n';
import { createBackup, restoreBackup } from '../lib/backup';
import { formatBytes, formatDuration } from '../lib/util';
import { MAX_FILE_SIZE } from '../lib/importManager';
import { Button, ConfirmDialog, EmptyState, Spinner } from './common';

export default function Library({ onNewMix }: { onNewMix: () => void }) {
  const {
    videos,
    mixes,
    outputs,
    lang,
    addFiles,
    renameVideo,
    deleteVideo,
    getFileBlob,
    refresh,
    pushToast,
  } = useStore();
  const { t } = useI18n();

  const [dragging, setDragging] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width:700px)').matches : false,
  );
  const [titleDraft, setTitleDraft] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width:700px)');
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const res = await addFiles(files);
      if (res.tooBig > 0) pushToast('error', t('fileTooBig', { size: formatBytes(MAX_FILE_SIZE) }));
      if (res.skipped > 0) pushToast('error', 'Some files were skipped (unsupported type)');
      if (res.failed > 0) pushToast('error', 'Some files failed to import');
      if (res.imported > 0) pushToast('success', `Imported ${res.imported} file(s)`);
    },
    [addFiles, pushToast, t],
  );

  const doBackup = useCallback(async () => {
    try {
      const files = new Map<string, Blob>();
      for (const v of videos) {
        const b = await getFileBlob(v.id);
        if (b) files.set(v.id, b);
      }
      const blob = await createBackup({ files, videos, mixes, outputs, settings: { lang } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dj-mixer-backup.zip';
      a.click();
      URL.revokeObjectURL(url);
      pushToast('success', t('backupDone'));
    } catch {
      pushToast('error', t('restoreFailed'));
    }
  }, [videos, mixes, outputs, lang, getFileBlob, pushToast, t]);

  const doRestore = useCallback(
    async (file: File) => {
      try {
        const r = await restoreBackup(file);
        pushToast('success', t('restoreDone', { v: r.videos, m: r.mixes }));
        await refresh();
      } catch {
        pushToast('error', t('restoreFailed'));
      }
    },
    [refresh, pushToast, t],
  );

  const confirmDelete = confirmDeleteId
    ? videos.find((v) => v.id === confirmDeleteId)
    : undefined;

  return (
    <div>
      <div className="section-header">
        <h2>{t('tabLibrary')}</h2>
        <div className="spacer" />
        <Button variant="primary" onClick={onNewMix}>
          {t('newMix')}
        </Button>
      </div>

      {videos.length >= 5 && <div className="notice" style={{ marginBottom: 16 }}>{t('evictionNudge')}</div>}
      {isNarrow && <div className="notice accent" style={{ marginBottom: 16 }}>{t('usePhoneWarning')}</div>}

      <label
        className={'dropzone' + (dragging ? ' dragging' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept="video/*,audio/*"
          className="hidden-file-input"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="dz-title">{t('addVideos')}</div>
        <div>{t('addVideosHint')}</div>
        <div>{t('dragDropHint')}</div>
      </label>

      {videos.length === 0 ? (
        <EmptyState title={t('noVideosYet')} />
      ) : (
        <div className="video-grid" style={{ marginTop: 18 }}>
          {videos.map((v) => {
            const draft = titleDraft[v.id];
            const value = draft !== undefined ? draft : v.title;
            const commit = () => {
              const trimmed = (draft ?? v.title).trim();
              if (draft !== undefined) {
                renameVideo(v.id, trimmed || v.title);
                setTitleDraft((d) => {
                  const next = { ...d };
                  delete next[v.id];
                  return next;
                });
              }
            };
            return (
              <div key={v.id} className="video-card">
                <div className="thumb">
                  {v.thumb ? (
                    <img src={v.thumb} alt="" />
                  ) : (
                    <div className="analyzing">
                      <Spinner />
                      <span>{t('analyzing')}</span>
                    </div>
                  )}
                  <span className="duration">{formatDuration(v.durationSec)}</span>
                </div>
                <div className="body">
                  <div className="title-row">
                    <input
                      className="text-input"
                      value={value}
                      onChange={(e) =>
                        setTitleDraft((d) => ({ ...d, [v.id]: e.target.value }))
                      }
                      onBlur={commit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                    <button
                      type="button"
                      className="icon-btn delete"
                      onClick={() => setConfirmDeleteId(v.id)}
                      aria-label={t('deleteVideo')}
                    >
                      ×
                    </button>
                  </div>
                  <div className="meta">
                    {formatDuration(v.durationSec)}
                    {v.width && v.height ? ` · ${v.width}×${v.height}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="backup-panel">
        <div className="card" style={{ padding: 18 }}>
          <h4>{t('backup')}</h4>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('backupNote')}</p>
          <Button onClick={doBackup}>{t('backup')}</Button>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h4>{t('restore')}</h4>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('restoreNote')}</p>
          <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('restoreMergesNote')}</p>
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden-file-input"
            ref={restoreInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doRestore(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => restoreInputRef.current?.click()}>{t('restore')}</Button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('deleteVideo')}
          message={t('deleteVideoConfirm', { title: confirmDelete.title })}
          confirmLabel={t('deleteVideo')}
          cancelLabel={t('cancel')}
          danger
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={async () => {
            await deleteVideo(confirmDelete.id);
            pushToast('success', t('deleteVideo'));
            setConfirmDeleteId(null);
          }}
        />
      )}
    </div>
  );
}
