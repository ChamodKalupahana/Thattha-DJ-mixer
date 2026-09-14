import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useI18n } from '../i18n';
import { formatBytes } from '../lib/util';
import { Button, Modal } from './common';
import { RenderError, renderMix } from '../ffmpeg/render';
import type { RenderFormat, RenderProgress, RenderQuality, RenderResult } from '../ffmpeg/render';
import type { Mix } from '../db/types';

export default function RenderModal({ mix, onClose }: { mix: Mix; onClose: () => void }) {
  const { getVideo, getFileBlob, addOutput, pushToast } = useStore();
  const { t } = useI18n();
  const [quality, setQuality] = useState<RenderQuality>('fast');
  const [format, setFormat] = useState<RenderFormat>('video');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<RenderProgress>({ phase: 'stitch', fraction: 0 });
  const [error, setError] = useState('');
  const [result, setResult] = useState<RenderResult | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoDownloadedRef = useRef(false);

  const releaseWakeLock = (): void => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  useEffect(() => releaseWakeLock, []);

  const triggerDownload = (name: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    if (status === 'done' && result && !autoDownloadedRef.current) {
      autoDownloadedRef.current = true;
      triggerDownload(result.name, result.blob);
    }
  }, [status, result]);

  const start = async () => {
    setStatus('rendering');
    setProgress({ phase: 'stitch', fraction: 0 });
    if (navigator.wakeLock) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch {
        /* best-effort; the warning notice covers unsupported browsers */
      }
    }
    try {
      const res = await renderMix({
        mix,
        getBlob: getFileBlob,
        getVideo,
        quality,
        format,
        onProgress: (p) => setProgress(p),
      });
      const out = await addOutput({
        mixId: mix.id,
        title: res.name,
        mime: res.mime,
        blob: res.blob,
      });
      releaseWakeLock();
      setResult(res);
      setSavedTitle(out.title);
      setStatus('done');
      pushToast('success', t('preSaving'));
    } catch (e) {
      releaseWakeLock();
      if (e instanceof RenderError) {
        const msg =
          e.code === 'oom'
            ? t('renderErrorOom')
            : e.code === 'big'
              ? t('renderErrorBig')
              : e.code === 'unsupported'
                ? t('renderErrorUnsupported')
                : t('renderError', { reason: String(e.message) });
        setError(msg);
      } else {
        setError(t('renderError', { reason: String((e && (e as Error).message) || e) }));
      }
      setStatus('error');
    }
  };

  const download = () => {
    if (!result) return;
    triggerDownload(result.name, result.blob);
  };

  const reset = () => {
    setStatus('idle');
    setResult(null);
    setSavedTitle('');
  };

  return (
    <Modal title={t('renderTitle')} onClose={onClose} wide>
      {quality === 'fast' && <div className="notice accent">{t('renderSizeWarning')}</div>}
      <div className="notice">{t('displaySleepWarning')}</div>

      {(status === 'idle' || status === 'error') && (
        <>
          <div className="field">
            <div className="field-label">{t('quality')}</div>
            <div className="option-grid">
              <div
                className={'radio-card' + (quality === 'fast' ? ' active' : '')}
                onClick={() => setQuality('fast')}
              >
                <div className="rc-title">{t('qualityFast')}</div>
                <div className="rc-hint">{t('qualityFastHint')}</div>
              </div>
              <div
                className={'radio-card' + (quality === 'good' ? ' active' : '')}
                onClick={() => setQuality('good')}
              >
                <div className="rc-title">{t('qualityGood')}</div>
                <div className="rc-hint">{t('qualityGoodHint')}</div>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-label">{t('format')}</div>
            <div className="option-grid">
              <div
                className={'radio-card' + (format === 'video' ? ' active' : '')}
                onClick={() => setFormat('video')}
              >
                <div className="rc-title">{t('formatVideo')}</div>
              </div>
              <div
                className={'radio-card' + (format === 'audio' ? ' active' : '')}
                onClick={() => setFormat('audio')}
              >
                <div className="rc-title">{t('formatAudioOnly')}</div>
              </div>
            </div>
          </div>

          {status === 'error' && (
            <div className="error-line">{t('renderError', { reason: error })}</div>
          )}

          <div style={{ marginTop: 16 }}>
            <Button variant="primary" className="lg" disabled={mix.clips.length === 0} onClick={start}>
              {t('renderButton')}
            </Button>
          </div>
        </>
      )}

      {status === 'rendering' && (
        <div className="render-progress">
          <div className="render-phase">
            {progress.phase === 'prepare' ? t('renderPhasePrepare') : t('renderPhaseStitch')}
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            {t('renderProgress', { pct: Math.round(progress.fraction * 100) })}
          </div>
        </div>
      )}

      {status === 'done' && result && (
        <>
          <div className="render-result">
            <div className="rr-info">
              <div className="rr-title">{savedTitle}</div>
              <div className="rr-meta">{formatBytes(result.blob.size)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="primary" onClick={download}>
              {t('download')}
            </Button>
            <Button variant="ghost" onClick={reset}>
              {t('renderAgain')}
            </Button>
            <Button onClick={onClose}>{t('closeModal')}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
