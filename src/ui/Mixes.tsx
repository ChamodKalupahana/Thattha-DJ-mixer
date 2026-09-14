import { useState } from 'react';
import { useStore } from '../state/store';
import { useI18n } from '../i18n';
import { formatBytes, formatDuration } from '../lib/util';
import { Button, ConfirmDialog } from './common';

export default function Mixes({ onOpenMix }: { onOpenMix: (mixId: string) => void }) {
  const { mixes, outputs, getVideo, deleteMix, deleteOutput } = useStore();
  const { t } = useI18n();
  const [confirmDeleteMix, setConfirmDeleteMix] = useState<string | null>(null);
  const [confirmDeleteOutput, setConfirmDeleteOutput] = useState<string | null>(null);

  const downloadOutput = (out: { title: string; blob: Blob }) => {
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.title || 'mix.mp4';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pendingMix = confirmDeleteMix ? mixes.find((m) => m.id === confirmDeleteMix) : undefined;
  const pendingOutput = confirmDeleteOutput
    ? outputs.find((o) => o.id === confirmDeleteOutput)
    : undefined;

  return (
    <div>
      <div className="section-header">
        <h2>{t('tabMixes')}</h2>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 12 }}>My mixes</h3>
      {mixes.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>No mixes yet</div>
      ) : (
        <div className="mixes-list" style={{ marginBottom: 24 }}>
          {mixes.map((mix) => {
            let total = 0;
            for (const c of mix.clips) {
              const vid = getVideo(c.videoId);
              if (!vid) continue;
              total += c.out - c.in;
            }
            const title = mix.title || t('untitled');
            return (
              <div key={mix.id} className="mix-row">
                <div className="mr-title">{title}</div>
                <div className="mr-meta">
                  {mix.clips.length} clips · {formatDuration(total)}
                </div>
                <div className="mr-actions">
                  <Button variant="primary" className="sm" onClick={() => onOpenMix(mix.id)}>
                    {t('openMix')}
                  </Button>
                  <Button variant="ghost" className="sm" onClick={() => onOpenMix(mix.id)}>
                    {t('continueEditing')}
                  </Button>
                  <Button
                    variant="danger"
                    className="sm"
                    onClick={() => setConfirmDeleteMix(mix.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={{ fontSize: 15, marginBottom: 12 }}>{t('myMixOutputs')}</h3>
      {outputs.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>No rendered mixes yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {outputs.map((out) => (
            <div key={out.id} className="output-row">
              <div className="or-info">
                <div className="or-title">{out.title}</div>
                <div className="or-meta">
                  {formatBytes(out.size)} · {out.mime}
                </div>
              </div>
              <Button className="sm" onClick={() => downloadOutput(out)}>
                {t('reDownload')}
              </Button>
              <Button
                variant="danger"
                className="sm"
                onClick={() => setConfirmDeleteOutput(out.id)}
              >
                {t('deleteOutput')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {pendingMix && (
        <ConfirmDialog
          title={t('deleteMixConfirm', { title: pendingMix.title || t('untitled') })}
          message={t('deleteMixConfirm', { title: pendingMix.title || t('untitled') })}
          confirmLabel="Delete"
          cancelLabel={t('cancel')}
          danger
          onCancel={() => setConfirmDeleteMix(null)}
          onConfirm={() => {
            deleteMix(pendingMix.id);
            setConfirmDeleteMix(null);
          }}
        />
      )}

      {pendingOutput && (
        <ConfirmDialog
          title={t('deleteOutput')}
          message={t('deleteOutput')}
          confirmLabel={t('deleteOutput')}
          cancelLabel={t('cancel')}
          danger
          onCancel={() => setConfirmDeleteOutput(null)}
          onConfirm={() => {
            deleteOutput(pendingOutput.id);
            setConfirmDeleteOutput(null);
          }}
        />
      )}
    </div>
  );
}
