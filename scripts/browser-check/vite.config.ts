import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** Standalone build of the record.ts check page. Separate config so the app's
 *  PWA plugin, base path and manifest stay out of it. */
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  /*
   * Serve the app's public/ — the check needs public/sf/, because the engine
   * worker is fetched by URL at runtime rather than bundled. Without this the
   * worker request fell through to index.html and the page died on
   * "Unexpected token '<'", which looked exactly like a bug in the code under
   * test and was not.
   */
  publicDir: resolve(import.meta.dirname, '../../public'),
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
})
