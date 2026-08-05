import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/*
 * Build stamp.
 *
 * This app is an offline-first PWA, which means the service worker will
 * happily serve a build from last week and nothing on screen says so. "I can't
 * see the new design" is then unanswerable from either end — Sean cannot tell
 * me what he is looking at and I cannot tell him whether it is current.
 *
 * So the commit and the build time go into the bundle and get shown in
 * Settings. Not decoration: it turns "is it live?" from a guess into a string
 * he can read out.
 */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// base must match the GitHub Pages subpath (https://<user>.github.io/chess-coach/).
// Override with BASE=/ for local-only or custom-domain builds.
const base = process.env.BASE ?? '/chess-coach/'

export default defineConfig({
  base,
  define: {
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Chess Coach',
        short_name: 'Coach',
        description: 'Daily chess training — adaptive ladder, human-like opponents, simulation.',
        theme_color: '#1c1a17',
        background_color: '#1c1a17',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        // SVG only — scales to every launcher size and needs no binary assets
        // in the repo. Add PNG fallbacks if an older Android target shows up.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The wasm binary is 7.3MB — well over workbox's 2MB default cap.
        // It must be precached or the app can't play a move offline.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Deliberately NOT precaching puzzles/: all nine bands is ~4.5MB and
        // you only ever need the two or three around your rating. They're
        // cached on first use instead — see runtimeCaching below.
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        globIgnores: ['**/puzzles/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/puzzles/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'puzzle-bands',
              // Puzzle files are immutable once built; a year is fine.
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Vite 8 takes the function form only. Split the two chess libraries
        // into their own chunks so app changes don't bust their cache entry.
        manualChunks(id: string) {
          if (id.includes('node_modules/chessground')) return 'board'
          if (id.includes('node_modules/chess.js')) return 'rules'
          return undefined
        },
      },
    },
  },
})
