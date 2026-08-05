/**
 * Build and run the record.ts browser check.
 *
 * The recorder writes through Dexie, so it needs a real IndexedDB — faking one
 * would test the fake. And reaching the same three lines through the UI means
 * playing a full game against the engine, which takes twenty minutes and tests
 * the bot's move choice far more than it tests the save. So: build the check
 * page, serve it, drive it with Playwright, exit on what it printed.
 *
 * Usage:  npm run check:record
 */

import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4199
const CONFIG = 'scripts/browser-check/vite.config.ts'

const build = spawnSync('npx', ['vite', 'build', '--config', CONFIG], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const server = spawn('npx', ['vite', 'preview', '--config', CONFIG, '--port', String(PORT)], {
  stdio: 'ignore',
})

// Chromium is preinstalled in this environment; fall back to Playwright's own
// resolution anywhere else rather than hard-failing on a missing path.
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'

let code = 1
let browser
try {
  await new Promise((r) => setTimeout(r, 3000))
  browser = await chromium.launch({ executablePath })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => /OK|FAILED/.test(document.getElementById('out')?.textContent ?? ''),
    null,
    { timeout: 30_000 },
  )

  const text = (await page.locator('#out').textContent()) ?? ''
  console.log(text)
  if (errors.length) console.log('page errors:', errors)
  code = /\bOK\s*$/.test(text.trim()) && errors.length === 0 ? 0 : 1
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
} finally {
  await browser?.close()
  server.kill()
}

console.log(code === 0 ? '\n✓ recordFinishedGame saves, rates, and skips analysis correctly' : '\n✗ check failed')
process.exit(code)
