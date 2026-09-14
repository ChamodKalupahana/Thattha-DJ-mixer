import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serve COOP/COEP headers in dev/preview so Chrome exposes SharedArrayBuffer
 * and the multi-threaded ffmpeg core can run locally. Firebase Hosting gets
 * the same headers via firebase.json for production.
 */
function crossOriginIsolation(): Plugin {
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  build: {
    // ffmpeg cores are ~25-31MB per file; silence the chunk-size warning.
    chunkSizeWarningLimit: 40000,
  },
});