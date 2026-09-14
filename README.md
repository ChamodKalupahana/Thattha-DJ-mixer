# DJ Mixer

Client-side video stitcher for a non-technical Sinhala speaker. Import Sinhala music
videos/karaoke/audio into the browser, chain clips with in/out points and per-pair
transitions, preview with a live crossfade, and export one seamless MP4 (or MP3).
Everything runs locally — no backend, no uploads; FFmpeg runs in the browser via
`ffmpeg.wasm` and everything is stored in IndexedDB.

## Development

- `npm install`
- `npm run dev` — Vite dev server (adds COOP/COEP headers so the multi-threaded
  FFmpeg core can run).
- `npm run typecheck` — `tsc -b --noEmit`
- `npm run build` — production build into `dist/`
- `npm run preview` — serve `dist/` locally with the same COOP/COEP headers.

## Deployment (Firebase Hosting)

```sh
npm run build
firebase login
firebase deploy --only hosting
```

`firebase.json` sets `application/wasm` MIME, immutable caching for hashed assets,
and COOP/COEP on the document so Chrome/Edge expose `SharedArrayBuffer` (the
multi-threaded FFmpeg core). Safari/browsers without `SharedArrayBuffer` fall back
to the single-threaded core automatically. Vercel/Netlify work too — the only
requirements are `application/wasm` headers, COOP/COEP, and static hosting.

## Notes

- Data lives in this browser only. Use the in-app **Backup** button regularly and
  **Restore** on the next machine to move your library.
- Sinhala strings in `src/i18n/si.ts` are best-effort drafts and should be reviewed
  by a native speaker before release.
- Rendering is CPU-bound: a 5-song 720p mix takes roughly 2× realtime on a mid
  laptop. Leave the tab open and visible while rendering.