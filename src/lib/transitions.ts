import type { MixClipRef, ResolvedTransitions, TransitionSetting } from '../db/types';

/**
 * Resolve clip durations and per-join transition overlap lengths.
 *
 * Rule from the plan: a transition's duration is clamped to the shorter of
 * (A's remaining length, B's usable length). Left-to-right pass: each clip
 * owns a "start budget" (consumed by the transition on its left) and an "end
 * budget" (consumed by the transition on its right). Hard cuts always resolve
 * to overlap 0.
 */
export function resolveTransitions(
  clips: MixClipRef[],
  durations: number[],
  settings: TransitionSetting[],
): ResolvedTransitions {
  const n = clips.length;
  const overlaps: number[] = new Array(Math.max(0, n - 1)).fill(0);
  const d = durations.map((x) => Math.max(0, x));

  const startBudget = d.slice();
  const endBudget = d.slice();

  for (let i = 0; i < n - 1; i++) {
    const t = settings[i];
    if (!t || t.type === 'cut') {
      overlaps[i] = 0;
      continue;
    }
    let dur = Math.max(0, t.dur);
    dur = Math.min(dur, endBudget[i], startBudget[i + 1]);
    overlaps[i] = dur;
    endBudget[i] -= dur;
    startBudget[i + 1] -= dur;
  }

  const total = d.reduce((a, b) => a + b, 0) - overlaps.reduce((a, b) => a + b, 0);
  return { durations: d, overlaps, total };
}

export function transitionName(type: TransitionSetting['type']): string {
  switch (type) {
    case 'smooth':
      return 'fade';
    case 'cut':
      return 'cut';
    case 'fadeblack':
      return 'fadeblack';
    case 'slide':
      return 'slideleft';
  }
}

export const TRANSITION_DURATIONS = [2, 5, 8] as const;

export const TRANSITION_TYPES = ['smooth', 'cut', 'fadeblack', 'slide'] as const;