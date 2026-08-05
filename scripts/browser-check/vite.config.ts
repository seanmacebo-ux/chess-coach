import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** Standalone build of the record.ts check page. Separate config so the app's
 *  PWA plugin, base path and manifest stay out of it. */
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
})
