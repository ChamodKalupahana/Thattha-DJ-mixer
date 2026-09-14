import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { clamp } from '../lib/util';

interface Selection {
  in: number;
  out: number;
}

export default function Waveform({
  data,
  durationSec,
  height = 96,
  selection,
  onSelectionChange,
  playhead,
  color = '#6c8cff',
}: {
  data: Float32Array | null;
  durationSec: number;
  height?: number;
  selection?: Selection | null;
  onSelectionChange?: (sel: Selection | null) => void;
  playhead?: number | null;
  color?: string;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragHandle, setDragHandle] = useState<'in' | 'out' | null>(null);

  const updateFromPointer = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el || durationSec <= 0 || !onSelectionChange || !selection) return;
      const rect = el.getBoundingClientRect();
      const seconds = clamp(((clientX - rect.left) / rect.width) * durationSec, 0, durationSec);
      let next: Selection;
      if (dragHandle === 'in') {
        next = { in: Math.min(seconds, selection.out - 0.1), out: selection.out };
      } else {
        next = { in: selection.in, out: Math.max(seconds, selection.in + 0.1) };
      }
      onSelectionChange(next);
    },
    [durationSec, onSelectionChange, selection, dragHandle],
  );

  useEffect(() => {
    if (!dragHandle) return;
    const move = (e: PointerEvent) => updateFromPointer(e.clientX);
    const up = () => setDragHandle(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragHandle, updateFromPointer]);

  const isEmpty = !data || data.length === 0 || durationSec <= 0;

  const barCount = Math.min(data ? data.length : 0, 180);

  return (
    <div ref={containerRef} className="waveform" style={{ height }}>
      {isEmpty ? (
        <div className="wf-empty">{t('previewUnavailable')}</div>
      ) : (
        <div className="wf-bars">
          {Array.from({ length: barCount }, (_, i) => {
            const v = data![i];
            const h = Math.max(4, (Number.isFinite(v) ? Math.abs(v) : 0) * 100);
            return (
              <div key={i} className="wf-bar" style={{ height: h + '%', background: color }} />
            );
          })}
        </div>
      )}
      {!isEmpty && selection && (
        <div
          className="wf-sel"
          style={{
            left: (selection.in / durationSec) * 100 + '%',
            width: ((selection.out - selection.in) / durationSec) * 100 + '%',
          }}
        />
      )}
      {!isEmpty && playhead != null && (
        <div
          className="wf-playhead"
          style={{ left: (playhead / durationSec) * 100 + '%' }}
        />
      )}
      {!isEmpty && onSelectionChange && selection && (
        <>
          <div
            className="wf-handle"
            style={{ left: (selection.in / durationSec) * 100 + '%', touchAction: 'none' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDragHandle('in');
            }}
          />
          <div
            className="wf-handle"
            style={{ left: (selection.out / durationSec) * 100 + '%', touchAction: 'none' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDragHandle('out');
            }}
          />
        </>
      )}
    </div>
  );
}
