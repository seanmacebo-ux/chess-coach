/**
 * Screenshot a screen of the app.
 *
 * Design work needs to look at the thing. Describing a layout in prose and
 * hoping is how you end up with a drill whose question and answer ask
 * different things for months without anyone noticing.
 *
 * Usage: tsx scripts/shot.ts <screen> [outfile]
 *   screens: learn, threat, scan, candidates, play, today, history, settings
 */

import { openApp, settle } from './lib/browser'

const SCREEN = process.argv[2] ?? 'learn'
const OUT = process.argv[3] ?? `/tmp/${SCREEN}.png`

const TABS: Record<string, string> = {
  today: 'Today',
  play: 'Play',
  learn: 'Learn',
  endings: 'Endings',
  history: 'History',
  settings: 'Settings',
}

async function main(): Promise<void> {
  const s = await openApp({ prefs: { liveGrading: true } })
  try {
    const { page } = s

    if (TABS[SCREEN]) {
      await page.getByRole('button', { name: TABS[SCREEN]! }).click()
      await page.waitForTimeout(1200)
    } else if (SCREEN === 'threat' || SCREEN === 'scan' || SCREEN === 'candidates') {
      await page.getByRole('button', { name: 'Learn' }).click()
      await page.waitForTimeout(600)

      const pillar = SCREEN === 'candidates' ? 'Tactics' : SCREEN === 'scan' ? 'Position' : 'Strategy'
      await page.getByRole('button', { name: new RegExp(pillar) }).first().click()
      await page.waitForTimeout(400)

      const label =
        SCREEN === 'threat'
          ? 'Read the threat'
          : SCREEN === 'scan'
            ? 'Spot the loose piece'
            : 'Candidate moves'
      const card = page.locator('.card', { hasText: label }).first()
      await card.getByRole('button', { name: 'Train' }).click()

      // Building a threat set runs the engine twice per position.
      await page.waitForSelector('.chips', { timeout: 180_000 })
      await page.waitForTimeout(800)
      await settle(page).catch(() => undefined)
    } else if (SCREEN === 'play') {
      await page.getByRole('button', { name: 'Play' }).click()
      await page.waitForSelector('.dot.ready', { timeout: 60_000 })
      await settle(page)
    }

    await page.screenshot({ path: OUT, fullPage: true })
    console.log(`wrote ${OUT}`)
  } finally {
    await s.close()
  }
}

await main()
