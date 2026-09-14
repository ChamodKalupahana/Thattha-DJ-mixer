import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useI18n } from '../i18n';
import type { Mix, MixClipRef, TransitionSetting, TransitionType, VideoInfo } from '../db/types';
import { TRANSITION_DURATIONS, TRANSITION_TYPES } from '../lib/transitions';
import { clamp, formatDuration } from '../lib/util';
import { Button, ConfirmDialog, EmptyState, Modal } from './common';
import Waveform from './Waveform';
import PreviewPlayer from './PreviewPlayer';
import RenderModal from './RenderModal';

const DEFAULT_TRANSITION: TransitionSetting = { type: 'smooth', dur: 5 };

function normalizeTransitions(
  clips: MixClipRef[],
  transitions: TransitionSetting[],
): TransitionSetting[] {
  const n = Math.max(0, clips.length - 1);
  const out: TransitionSetting[] = [];
  for (let i = 0; i < n; i++) {
    const s = transitions[i];
    out.push(s && s.type && typeof s.dur === 'number' ? s : { ...DEFAULT_TRANSITION });
  }
  return out;
}

const transitionLabelKey: Record<
  TransitionType,
  'transitionSmooth' | 'transitionCut' | 'transitionFadeBlack' | 'transitionSlide'
> = {
  smooth: 'transitionSmooth',
  cut: 'transitionCut',
  fadeblack: 'transitionFadeBlack',
  slide: 'transitionSlide',
};

const durLabelKey: Record<number, 'durShort' | 'durNormal' | 'durLong'> = {
  2: 'durShort',
  5: 'durNormal',
  8: 'durLong',
};

export default function MixEditor({ mixId, onBack }: { mixId: string; onBack: () => void }) {
  const { videos, mixes, saveMix, deleteMix, getFileBlob, getVideo, pushToast } = useStore();
  const { t } = useI18n();

  const initial = mixes.find((m) => m.id === mixId) ?? null;
  const [working, setWorking] = useState<Mix | null>(initial);
  const workingRef = useRef<Mix | null>(initial);
  const [activeClip, setActiveClip] = useState(0);
  const [titleDraft, setTitleDraft] = useState(initial?.title ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [showRender, setShowRender] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chainPlaying, setChainPlaying] = useState(false);
  const [editTrans, setEditTrans] = useState<number | null>(null);
  const [transDraft, setTransDraft] = useState<TransitionSetting>(DEFAULT_TRANSITION);
  const dragFrom = useRef<number>(-1);

  const doSave = useCallback(
    async (mix: Mix) => {
      try {
        await saveMix(mix);
      } catch {
        pushToast('error', t('saveFailed'));
      }
    },
    [pushToast, saveMix, t],
  );

  const mutate = useCallback(
    (fn: (m: Mix) => Mix, opts?: { save?: boolean }) => {
      const base = workingRef.current;
      if (!base) return;
      const next = fn(base);
      workingRef.current = next;
      setWorking(next);
      if (opts?.save) doSave(next);
    },
    [doSave],
  );

  const appendClip = useCallback(
    (video: VideoInfo) => {
      const clip: MixClipRef = { videoId: video.id, in: 0, out: Math.max(0.1, video.durationSec) };
      mutate(
        (m) => {
          const clips = [...m.clips, clip];
          return { ...m, clips, transitions: normalizeTransitions(clips, m.transitions) };
        },
        { save: true },
      );
    },
    [mutate],
  );

  const removeClip = useCallback(
    (i: number) => {
      const base = workingRef.current;
      if (!base) return;
      const prev = activeClip;
      const clips = base.clips.filter((_, k) => k !== i);
      const next = Math.max(0, Math.min(clips.length - 1, i < prev ? prev - 1 : prev));
      setActiveClip(next);
      mutate(
        (m) => ({ ...m, clips, transitions: normalizeTransitions(clips, m.transitions) }),
        { save: true },
      );
    },
    [mutate, activeClip],
  );

  const reorder = useCallback(
    (to: number) => {
      const from = dragFrom.current;
      dragFrom.current = -1;
      if (from < 0 || from === to) return;
      const base = workingRef.current;
      if (!base) return;
      const clips = [...base.clips];
      const [m] = clips.splice(from, 1);
      clips.splice(to, 0, m);
      const transitions = clips.map(() => ({ ...DEFAULT_TRANSITION }));
      setActiveClip(to);
      mutate((m2) => ({ ...m2, clips, transitions }), { save: true });
    },
    [mutate],
  );

  const setTransition = useCallback(
    (i: number, s: TransitionSetting) => {
      mutate((m) => {
        const transitions = [...m.transitions];
        transitions[i] = s;
        return { ...m, transitions };
      }, { save: true });
    },
    [mutate],
  );

  const updateClip = useCallback(
    (i: number, patch: Partial<MixClipRef>) => {
      mutate((m) => {
        const clips = m.clips.map((c, k) => (k === i ? { ...c, ...patch } : c));
        return { ...m, clips };
      }, { save: true });
    },
    [mutate],
  );

  const commitTitle = useCallback(() => {
    mutate((m) => ({ ...m, title: titleDraft.trim() }), { save: true });
  }, [mutate, titleDraft]);

  const availableVideos = useMemo(() => {
    if (!working) return [];
    const used = new Set(working.clips.map((c) => c.videoId));
    return videos.filter((v) => !used.has(v.id));
  }, [videos, working]);

  if (!working) {
    return (
      <div>
        <EmptyState
          title={t('editMix')}
          hint={t('noClipsYet')}
          action={
            <Button onClick={onBack}>
              ← {t('editMix')}
            </Button>
          }
        />
      </div>
    );
  }

  const active = working.clips[activeClip];
  const activeVideo = active ? getVideo(active.videoId) : undefined;

  return (
    <div>
      <div className="mix-header">
        <button className="back" onClick={onBack}>
          ← {t('editMix')}
        </button>
        <input
          className="mix-title-input"
          value={titleDraft}
          placeholder={t('mixTitlePlaceholder')}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
        />
        <div className="spacer" />
        <Button variant="primary" onClick={() => setShowRender(true)}>
          {t('render')}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>

      <div className="chain">
        {working.clips.map((clip, i) => {
          const video = getVideo(clip.videoId);
          const trans = working.transitions[i - 1] ?? DEFAULT_TRANSITION;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <div className="chain-gap">
                  <button
                    className="transition-chip"
                    onClick={() => {
                      setEditTrans(i - 1);
                      setTransDraft({ ...trans });
                    }}
                  >
                    {t(transitionLabelKey[trans.type])} · {t(durLabelKey[trans.dur] ?? 'durNormal')}
                  </button>
                </div>
              )}
              <div
                className={'chain-clip' + (i === activeClip ? ' active' : '')}
                draggable
                onClick={() => setActiveClip(i)}
                onDragStart={(e) => {
                  dragFrom.current = i;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  reorder(i);
                }}
              >
                <div className="cc-thumb">
                  {video?.thumb ? (
                    <img src={video.thumb} alt="" />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--text-faint)',
                      }}
                    >
                      ♪
                    </div>
                  )}
                </div>
                <div className="cc-body">
                  <div className="cc-title">{video?.title || t('untitled')}</div>
                  <div className="cc-meta">{formatDuration(clip.out - clip.in)}</div>
                </div>
                <button
                  className="cc-remove"
                  title={t('removeClip')}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClip(i);
                  }}
                >
                  ×
                </button>
              </div>
            </Fragment>
          );
        })}
        <div className="chain-add">
          <Button variant="ghost" onClick={() => setShowPicker(true)}>
            {t('addClip')}
          </Button>
        </div>
      </div>

      {working.clips.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <PreviewPlayer
            clips={working.clips}
            videos={videos}
            getBlob={getFileBlob}
            transitions={working.transitions}
            playing={chainPlaying}
            onPlayingChange={setChainPlaying}
            activeIndex={activeClip}
            onActiveIndexChange={setActiveClip}
          />
        </div>
      )}

      {working.clips.length > 0 && (
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 14 }}>
          {t('dragHint')}
        </div>
      )}

      {working.clips.length === 0 ? (
        <EmptyState
          title={t('noClipsYet')}
          hint={t('noClipsHint')}
          action={
            <Button variant="primary" onClick={() => setShowPicker(true)}>
              {t('addClip')}
            </Button>
          }
        />
      ) : (
        active &&
        activeVideo && (
          <ClipEditor
            clip={active}
            video={activeVideo}
            getBlob={getFileBlob}
            onUpdate={(patch) => updateClip(activeClip, patch)}
          />
        )
      )}

      {showPicker && (
        <Modal
          wide
          title={t('pickClipsTitle')}
          onClose={() => setShowPicker(false)}
          footer={<Button onClick={() => setShowPicker(false)}>{t('ok')}</Button>}
        >
          {availableVideos.length === 0 ? (
            <div style={{ color: 'var(--text-dim)' }}>{t('noClipsYet')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {availableVideos.map((v) => (
                <button
                  key={v.id}
                  onClick={() => appendClip(v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'var(--text)',
                  }}
                >
                  {v.thumb ? (
                    <img
                      src={v.thumb}
                      alt=""
                      style={{ width: 72, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6 }}
                    />
                  ) : (
                    <div
                      style={{ width: 72, aspectRatio: '16/9', background: 'var(--bg-elevated)', borderRadius: 6 }}
                    />
                  )}
                  <span style={{ flex: 1 }}>{v.title || t('untitled')}</span>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
                    {formatDuration(v.durationSec)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {editTrans != null && working.transitions[editTrans] && (
        <Modal
          title={t('transition')}
          onClose={() => setEditTrans(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditTrans(null)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setTransition(editTrans, transDraft);
                  setEditTrans(null);
                }}
              >
                {t('ok')}
              </Button>
            </>
          }
        >
          <div className="field">
            <label>{t('transition')}</label>
            <div className="segmented">
              {TRANSITION_TYPES.map((ty) => (
                <button
                  key={ty}
                  className={'seg' + (transDraft.type === ty ? ' active' : '')}
                  onClick={() => setTransDraft((d) => ({ ...d, type: ty }))}
                >
                  {t(transitionLabelKey[ty])}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t('transition')}</label>
            <div className="segmented">
              {TRANSITION_DURATIONS.map((d) => (
                <button
                  key={d}
                  className={'seg' + (transDraft.dur === d ? ' active' : '')}
                  onClick={() => setTransDraft((x) => ({ ...x, dur: d }))}
                >
                  {t(durLabelKey[d])}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {showRender && <RenderModal mix={working} onClose={() => setShowRender(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete mix"
          message="Delete this mix?"
          confirmLabel="Delete"
          cancelLabel={t('cancel')}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteMix(mixId);
            onBack();
          }}
        />
      )}
    </div>
  );
}

function ClipEditor({
  clip,
  video,
  getBlob,
  onUpdate,
}: {
  clip: MixClipRef;
  video: VideoInfo;
  getBlob: (videoId: string) => Promise<Blob | undefined>;
  onUpdate: (patch: Partial<MixClipRef>) => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [current, setCurrent] = useState(clip.in);

  useEffect(() => {
    let cancelled = false;
    let u = '';
    (async () => {
      const blob = await getBlob(clip.videoId);
      if (!blob || cancelled) return;
      u = URL.createObjectURL(blob);
      if (!cancelled) setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [clip.videoId, getBlob]);

  const playFromStart = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = clip.in;
    setCurrent(clip.in);
    el.play();
  }, [clip.in]);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
  }, []);

  const restart = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = clip.in;
    setCurrent(clip.in);
  }, [clip.in]);

  const step = useCallback(
    (d: number) => {
      const el = videoRef.current;
      if (!el) return;
      const sec = clamp(el.currentTime + d, clip.in, clip.out);
      el.currentTime = sec;
      setCurrent(sec);
    },
    [clip.in, clip.out],
  );

  return (
    <div className="clip-editor">
      <div>
        <div className="preview-box">
          {url ? (
            <video
              ref={videoRef}
              src={url}
              playsInline
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  step(-1);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  step(1);
                }
              }}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                setCurrent(el.currentTime);
                if (el.currentTime >= clip.out) {
                  el.pause();
                  el.currentTime = clip.out;
                }
              }}
              onClick={() => {
                const el = videoRef.current;
                if (!el) return;
                if (el.paused) {
                  el.play().catch(() => {});
                } else {
                  el.pause();
                }
              }}
            />
          ) : (
            <div style={{ aspectRatio: '16/9' }} />
          )}
        </div>
        <div className="preview-controls">
          <Button onClick={playFromStart}>{t('playFromStart')}</Button>
          <Button onClick={pause}>{t('pause')}</Button>
          <Button onClick={restart}>{t('restart')}</Button>
          <Button onClick={() => step(-1)}>{t('stepBack')}</Button>
          <Button onClick={() => step(1)}>{t('stepForward')}</Button>
          <span className="time">
            {formatDuration(current)} / {formatDuration(clip.out)}
          </span>
        </div>
      </div>
      <div className="editor-panel">
        <h4>{t('editMix')}</h4>
        <div className="field">
          <label>{t('startHere')}</label>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
            {formatDuration(clip.in)}
          </div>
        </div>
        <div className="field">
          <label>{t('endHere')}</label>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
            {formatDuration(clip.out)}
          </div>
        </div>
        <div className="field">
          <label>
            {t('startHere')} – {t('endHere')}
          </label>
          <Waveform
            data={video.waveform}
            durationSec={video.durationSec}
            selection={{ in: clip.in, out: clip.out }}
            onSelectionChange={(sel) => (sel ? onUpdate({ in: sel.in, out: sel.out }) : null)}
            playhead={current}
          />
        </div>
      </div>
    </div>
  );
}
