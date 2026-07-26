// Copies the Stockfish single-threaded "lite" build into public/sf/.
//
// Why this build specifically:
//   stockfish-18.wasm         113MB  threaded  — needs COOP/COEP headers, dead on GitHub Pages
//   stockfish-18-lite.wasm    7.1MB  threaded  — still needs the headers
//   stockfish-18-lite-single  7.3MB  single    — no headers, no SharedArrayBuffer, works anywhere
//
// Single-threaded costs search speed, which matters for deep analysis but not
// for playing a 1500-strength opponent. Correct trade for a phone PWA.

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'stockfish', 'bin')
const to = join(root, 'public', 'sf')

const FILES = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']

await mkdir(to, { recursive: true })

for (const f of FILES) {
  const src = join(from, f)
  const dst = join(to, f)
  try {
    const a = await stat(src)
    const b = await stat(dst).catch(() => null)
    if (b && b.size === a.size) {
      console.log(`sf: ${f} already current (${(a.size / 1e6).toFixed(1)}MB)`)
      continue
    }
    await copyFile(src, dst)
    console.log(`sf: copied ${f} (${(a.size / 1e6).toFixed(1)}MB)`)
  } catch (err) {
    console.error(`sf: FAILED ${f} — ${err.message}`)
    process.exitCode = 1
  }
}
