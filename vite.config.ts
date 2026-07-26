import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base must match the GitHub Pages subpath (https://<user>.github.io/chess-coach/).
// Override with BASE=/ for local-only or custom-domain builds.
const base = process.env.BASE ?? '/chess-coach/'

export default defineConfig({
  base,
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
