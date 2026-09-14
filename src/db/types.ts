export type Lang = 'en' | 'si';

export type TransitionType = 'smooth' | 'cut' | 'fadeblack' | 'slide';

export interface TransitionSetting {
  type: TransitionType;
  dur: number;
}

export interface VideoFile {
  id: string;
  blob: Blob;
}

export interface VideoInfo {
  id: string;
  title: string;
  mime: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  waveform: Float32Array | null;
  waveformHz: number;
  thumb: string;
  addedAt: number;
}

export interface MixClipRef {
  videoId: string;
  in: number;
  out: number;
}

export interface Mix {
  id: string;
  title: string;
  clips: MixClipRef[];
  transitions: TransitionSetting[];
  createdAt: number;
  updatedAt: number;
}

export interface MixOutput {
  id: string;
  mixId: string | null;
  title: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

export interface Settings {
  lang: Lang;
}

export interface ResolvedTransitions {
  durations: number[];
  overlaps: number[];
  total: number;
}