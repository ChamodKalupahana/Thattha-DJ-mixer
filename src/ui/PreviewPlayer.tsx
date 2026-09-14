import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { resolveTransitions } from '../lib/transitions';
import { clamp, formatDuration } from '../lib/util';
import { Button } from './common';
import type { TransitionSetting, VideoInfo } from '../db/types';

interface PreviewPlayerProps {
  clips: { videoId: string; in: number; out: number }[];
  videos: VideoInfo[];
  getBlob: (videoId: string) => Promise<Blob | undefined>;
  transitions: TransitionSetting[];
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onFinished?: () => void;
}

interface Cross {
  from: number;
  to: number;
  duration: number;
  start: number;
  type: TransitionSetting['type'];
}

interface PendingStart {
  k: number;
  within: number;
}

export default function PreviewPlayer({
  clips,
  videos,
  getBlob,
  transitions,
  playing,
  onPlayingChange,
  activeIndex,
  onActiveIndexChange,
  onFinished,
}: PreviewPlayerProps) {
  const { t } = useI18n();

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const urlsRef = useRef<string[]>([]);
  const clipsRef = useRef(clips);
  const transitionsRef = useRef(transitions);
  const overlapsRef = useRef<number[]>([]);
  const startsRef = useRef<number[]>([]);
  const totalRef = useRef(0);
  const idxRef = useRef(activeIndex);
  const activeIndexRef = useRef(activeIndex);
  const topRef = useRef(-1);
  const crossRef = useRef<Cross | null>(null);
  const blackRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingStart | null>(null);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    const ls = clips.map((c) => c.out - c.in);
    const res = resolveTransitions(clips, ls, transitions);
    overlapsRef.current = res.overlaps;
    clipsRef.current = clips;
    transitionsRef.current = transitions;
    const starts: number[] = [];
    let acc = 0;
    for (let k = 0; k < clips.length; k++) {
      starts.push(acc);
      acc += ls[k] - (k < clips.length - 1 ? res.overlaps[k] : 0);
    }
    startsRef.current = starts;
    totalRef.current = Math.max(0, acc);
  }, [clips, transitions]);

  const currentMixTime = (): number => {
    const clips = clipsRef.current;
    const i = idxRef.current;
    if (i < 0 || i >= clips.length) return 0;
    const el = videoRefs.current[i];
    if (!el || !Number.isFinite(el.currentTime)) return 0;
    const starts = startsRef.current;
    return clamp(Number(starts[i] ?? 0) + el.currentTime - clips[i].in, 0, totalRef.current);
  };

  const pauseAll = useCallback(() => {
    for (const el of videoRefs.current) {
      if (el && !el.paused) el.pause();
    }
  }, []);

  const applyLayers = useCallback(() => {
    const n = clipsRef.current.length;
    const bottom = idxRef.current;
    const top = topRef.current;
    for (let i = 0; i < n; i++) {
      const el = videoRefs.current[i];
      if (!el) continue;
      el.style.display = i === bottom || i === top ? 'block' : 'none';
      el.style.zIndex = i === top ? '2' : '1';
      el.style.opacity = '1';
      el.style.transform = '';
    }
  }, []);

  const finish = useCallback(() => {
    pauseAll();
    if (onFinished) onFinished();
    onPlayingChange(false);
    pendingRef.current = { k: 0, within: 0 };
    setPos(totalRef.current);
  }, [pauseAll, onFinished, onPlayingChange]);

  const applyCross = useCallback((cross: Cross, p: number) => {
    const fromEl = videoRefs.current[cross.from];
    const toEl = videoRefs.current[cross.to];
    switch (cross.type) {
      case 'smooth':
      case 'cut':
        if (fromEl) fromEl.style.opacity = String(1 - p);
        if (toEl) toEl.style.opacity = String(p);
        break;
      case 'fadeblack': {
        if (fromEl) fromEl.style.opacity = String(1 - p);
        if (toEl) toEl.style.opacity = String(p);
        const bp = p < 0.5 ? p * 2 : (1 - p) * 2;
        if (blackRef.current) blackRef.current.style.opacity = String(bp);
        break;
      }
      case 'slide':
        if (fromEl) {
          fromEl.style.opacity = String(1 - p);
          fromEl.style.transform = `translateX(${-30 * p}px)`;
        }
        if (toEl) {
          toEl.style.opacity = String(p);
          toEl.style.transform = `translateX(${30 * (1 - p)}px)`;
        }
        break;
    }
  }, []);

  const startCross = useCallback(
    (from: number, to: number, overlap: number) => {
      const type = transitionsRef.current[from]?.type ?? 'smooth';
      const duration = Math.max(0.04, overlap);
      const nel = videoRefs.current[to];
      const clips = clipsRef.current;
      if (nel && clips[to]) {
        try {
          nel.currentTime = clips[to].in;
        } catch {
          /* element not ready yet */
        }
        nel.play();
      }
      topRef.current = to;
      crossRef.current = { from, to, duration, start: performance.now(), type };
      applyLayers();
    },
    [applyLayers],
  );

  const tick = useCallback(() => {
    const clips = clipsRef.current;
    const n = clips.length;
    if (n === 0) {
      finish();
      return;
    }
    const cross = crossRef.current;
    const now = performance.now();
    if (!cross) {
      const i = idxRef.current;
      const el = videoRefs.current[i];
      if (!el) {
        finish();
        return;
      }
      const out = clips[i].out;
      const overlap = i < overlapsRef.current.length ? overlapsRef.current[i] : 0;
      if (el.currentTime >= out - overlap && i + 1 < n) {
        startCross(i, i + 1, overlap);
        setPos(currentMixTime());
        return;
      }
      if (el.currentTime >= out && i + 1 >= n) {
        finish();
        return;
      }
    } else {
      const p = Math.min(1, (now - cross.start) / cross.duration);
      applyCross(cross, p);
      if (p >= 1) {
        const to = cross.to;
        crossRef.current = null;
        topRef.current = -1;
        idxRef.current = to;
        const nel = videoRefs.current[to];
        if (nel && nel.paused) nel.play();
        applyLayers();
        onActiveIndexChange(to);
      }
    }
    setPos(currentMixTime());
  }, [applyCross, applyLayers, finish, onActiveIndexChange, startCross]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [playing, tick]);

  useEffect(() => {
    if (playing) {
      pauseAll();
      crossRef.current = null;
      topRef.current = -1;
      const pend = pendingRef.current;
      const k = pend ? pend.k : activeIndexRef.current;
      idxRef.current = k;
      const el = videoRefs.current[k];
      const c = clipsRef.current[k];
      if (el && c) {
        try {
          el.currentTime = pend ? c.in + pend.within : c.in;
        } catch {
          /* element not ready yet */
        }
        el.play();
      }
      pendingRef.current = null;
      applyLayers();
      setPos(currentMixTime());
    } else {
      pauseAll();
      applyLayers();
    }
  }, [playing, pauseAll, applyLayers]);

  const seekTo = useCallback(
    (target: number, resume: boolean) => {
      const clips = clipsRef.current;
      const n = clips.length;
      if (n === 0) return;
      const t = clamp(target, 0, totalRef.current);
      const starts = startsRef.current;
      let k = n - 1;
      for (let i = 0; i < n; i++) {
        if (t < starts[i] + (clips[i].out - clips[i].in)) {
          k = i;
          break;
        }
      }
      const within = clamp(t - starts[k], 0, clips[k].out - clips[k].in);
      crossRef.current = null;
      topRef.current = -1;
      idxRef.current = k;
      pendingRef.current = { k, within };
      pauseAll();
      const el = videoRefs.current[k];
      if (el) {
        try {
          el.currentTime = clips[k].in + within;
        } catch {
          /* element not ready yet */
        }
        if (resume) el.play();
      }
      applyLayers();
      onActiveIndexChange(k);
      setPos(t);
    },
    [applyLayers, onActiveIndexChange, pauseAll],
  );

  const playFromStart = useCallback(() => {
    pendingRef.current = { k: 0, within: 0 };
    setPos(0);
    onActiveIndexChange(0);
    onPlayingChange(true);
  }, [onActiveIndexChange, onPlayingChange]);

  const step = useCallback(
    (d: number) => {
      seekTo(currentMixTime() + d, playing);
    },
    [playing, seekTo],
  );

  const videoIdsKey = clips.map((c) => c.videoId).join('|');

  useEffect(() => {
    let cancelled = false;
    const loaded: string[] = [];
    (async () => {
      const els = videoRefs.current;
      for (let i = 0; i < clips.length; i++) {
        if (cancelled) return;
        const blob = await getBlob(clips[i].videoId);
        if (cancelled) return;
        if (!blob) {
          loaded[i] = '';
          continue;
        }
        const u = URL.createObjectURL(blob);
        loaded[i] = u;
        const el = els[i];
        if (el) el.src = u;
      }
      if (cancelled) return;
      for (const u of urlsRef.current) if (u) URL.revokeObjectURL(u);
      urlsRef.current = loaded;
      applyLayers();
    })();
    return () => {
      cancelled = true;
      for (const u of urlsRef.current) if (u) URL.revokeObjectURL(u);
      urlsRef.current = [];
    };
  }, [videoIdsKey, clips, getBlob, applyLayers]);

  const currentClip = clips[activeIndex];
  const currentVideo = currentClip
    ? videos.find((v) => v.id === currentClip.videoId)
    : undefined;
  const label = currentVideo?.title || (currentClip ? t('clipN', { n: activeIndex + 1 }) : '');

  return (
    <div>
      <div className="preview-box" style={{ background: '#000', aspectRatio: '16/9' }}>
        {clips.length === 0 ? (
          <div style={{ aspectRatio: '16/9', background: '#000' }} />
        ) : (
          clips.map((_, i) => (
            <video
              key={i}
              ref={(el) => {
                videoRefs.current[i] = el;
              }}
              playsInline
              preload="auto"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
                display: 'none',
              }}
            />
          ))
        )}
        <div
          ref={blackRef}
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      </div>
      <div className="preview-scrubber-row">
        <input
          className="preview-scrubber"
          type="range"
          min={0}
          max={Math.max(0.1, totalRef.current)}
          step={0.1}
          value={pos}
          aria-label="seek"
          onChange={(e) => seekTo(Number(e.target.value), playing)}
        />
        <span className="time">
          {formatDuration(pos)} / {formatDuration(totalRef.current)}
        </span>
      </div>
      <div className="preview-controls">
        <Button onClick={playFromStart}>{t('playFromStart')}</Button>
        <Button onClick={() => step(-1)}>{t('stepBack')}</Button>
        <Button variant="primary" onClick={() => onPlayingChange(!playing)}>
          {playing ? t('pause') : t('playSelection')}
        </Button>
        <Button onClick={() => step(1)}>{t('stepForward')}</Button>
      </div>
      <div
        style={{
          marginTop: 8,
          color: 'var(--text-dim)',
          fontSize: 13,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  );
}