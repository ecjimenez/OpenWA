import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single source of truth for the version shown in the dashboard: the ROOT package.json, which is
// what a release bumps and what `npm run check:versions` gates. Resolved relative to this config
// file (not process.cwd()), because the dashboard is normally built from inside `dashboard/` — where
// cwd-relative resolution picks up `dashboard/package.json` instead. That file is not touched by a
// release, so the Login screen kept rendering whatever version it happened to be pinned at while the
// gateway moved on. The sidebar hid the drift by replacing the build-time value with the live
// version from the API (see Layout.tsx); the Login screen has no session yet, so it shows this
// constant verbatim. APP_VERSION env still overrides if explicitly provided.
const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  appType: 'spa', // Enable SPA fallback for client-side routing
  resolve: {
    // The login animation has no expressions, so use Lottie's expression-free player. This avoids
    // shipping the full player's eval-based expression runtime to an unauthenticated screen.
    alias: {
      // The lottie-web alias below makes Vite resolve lottie-react through its CJS build, whose
      // interop wraps the component in an extra `default` — `import Lottie` then receives the
      // exports object and React throws #130. Pinning the ESM build restores the real component.
      'lottie-react': 'lottie-react/build/index.es.js',
      'lottie-web': 'lottie-web/build/player/lottie_light.js',
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkgVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 2886,
    proxy: {
      '/api': {
        target: 'http://localhost:2785',
        changeOrigin: true,
        secure: false,
      },
      // Proxy the WebSocket (socket.io) transport so the dashboard's real-time
      // chats/sessions streams work against the dev backend.
      '/socket.io': {
        target: 'http://localhost:2785',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
