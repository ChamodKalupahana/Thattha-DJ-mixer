export interface MediaProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  thumb: string;
}

const THUMB_W = 320;
const THUMB_H = 180;

function defaultTitleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return base.replace(/[_]+/g, ' ').trim() || 'Untitled';
}

export { defaultTitleFromName };

/**
 * Fast, hardware-accelerated metadata + thumbnail via a hidden <video>. Never
 * loads FFmpeg. Audio-only files still load metadata (videoWidth is 0).
 */
export async function probeWithVideo(file: File): Promise<MediaProbe> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<MediaProbe>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;

      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve({ durationSec: 0, width: 0, height: 0, fps: 30, thumb: '' });
      };

      const timedOut = window.setTimeout(fail, 15000);

      video.onloadedmetadata = async () => {
        try {
          const width = video.videoWidth || 0;
          const height = video.videoHeight || 0;
          let duration = Number.isFinite(video.duration) ? video.duration : 0;
          if (!Number.isFinite(duration) || duration <= 0) duration = 0;
          if (duration === Infinity) duration = 0;

          let thumb = '';
          if (width > 0 && height > 0 && duration > 0) {
            try {
              thumb = await captureThumb(video, duration);
            } catch {
              thumb = '';
            }
          }

          window.clearTimeout(timedOut);
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(url);
          resolve({
            durationSec: duration,
            width,
            height,
            fps: 30,
            thumb,
          });
        } catch {
          fail();
        }
      };

      video.onerror = () => {
        window.clearTimeout(timedOut);
        fail();
      };

      // Kick decoding for the thumbnail; harmless for audio-only files.
      video.load();
    });
  } catch {
    URL.revokeObjectURL(url);
    return { durationSec: 0, width: 0, height: 0, fps: 30, thumb: '' };
  }
}

function captureThumb(video: HTMLVideoElement, duration: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(duration * 0.15, 0.5), 10);
    video.currentTime = target;
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = THUMB_W;
        canvas.height = THUMB_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no ctx'));

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(THUMB_W / vw, THUMB_H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch (err) {
        reject(err);
      }
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', () => reject(new Error('thumb seek failed')), { once: true });
  });
}