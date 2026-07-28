/**
 * Browser check for Learn's navigation.
 *
 * Learn was four levels of accordion and is now a stack of screens. The checks
 * that matter are the ones an eyeball misses:
 *
 *   THE ACCORDIONS ARE ACTUALLY GONE. Easy to leave one behind in a rewrite,
 *   and one stray expand-in-place control reintroduces the ambiguity the whole
 *   change exists to remove.
 *
 *   THE SYSTEM BACK BUTTON GOES UP A LEVEL. This is the one that breaks
 *   silently. Push screens without history entries and everything looks
 *   perfect until someone installs the PWA, swipes back from three levels
 *   deep, and closes the app instead. A browser is the only place to find out.
 *
 *   THE QUICK ACTION DOES NOT NAVIGATE. The card navigates and carries a Train
 *   button; if the card swallowed the button's click you would end up reading
 *   about a category you asked to practise.
 *
 *   LEAVING GIVES THE HISTORY BACK. Go deep, switch tabs, and the pushed
 *   entries have to be released — otherwise back presses do nothing visible
 *   until you have undone your invisible depth.
 *
 * Run: npm run verify:learn   (with `npm run dev` already up)
 */

import { assert, assertEqual, openApp, runChecks, type Session } from './lib/browser'

const SHOT_DIR = process.env.SHOT_DIR ?? ''

async function heading(s: Session): Promise<string> {
  const h = s.page.locator('.screen-title')
  return (await h.count()) === 0 ? '' : ((await h.first().textContent()) ?? '').trim()
}

async function backLabel(s: Session): Promise<string> {
  const b = s.page.locator('button.back')
  return (await b.count()) === 0 ? '' : ((await b.first().textContent()) ?? '').replace('‹', '').trim()
}

async function shot(s: Session, name: string): Promise<void> {
  if (!SHOT_DIR) return
  await s.page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true })
}

async function main(): Promise<void> {
  const s = await openApp()
  const checks: Array<[string, () => void]> = []

  try {
    await s.page.getByRole('button', { name: 'Learn' }).click()
    await s.page.waitForSelector('.nav-card', { timeout: 30_000 })

    const rootCards = await s.page.locator('.nav-card').count()
    // aria-expanded is the signature of a control that grows in place.
    const expanders = await s.page.locator('[aria-expanded]').count()
    const rootHeading = await heading(s)
    await shot(s, 'learn-1-index')

    checks.push([
      'the index is a list of modules, not a list of accordions',
      () => {
        assert(rootCards >= 6, `expected the five pillars plus Ideas, saw ${rootCards} nav cards`)
        assertEqual(expanders, 0, 'expand-in-place controls still on the Learn index')
      },
    ])
    checks.push([
      'the index has no back control — it is the root',
      () => assertEqual(rootHeading, '', 'the root should not present itself as a pushed screen'),
    ])

    /* ------------------------------------------------- push one level */

    await s.page.locator('.nav-card', { hasText: 'Tactics' }).first().locator('.nav-main').click()
    await s.page.waitForSelector('.screen-title', { timeout: 10_000 })
    const pillarTitle = await heading(s)
    const pillarBack = await backLabel(s)
    await shot(s, 'learn-2-pillar')

    checks.push([
      'tapping a module opens its own screen',
      () => assertEqual(pillarTitle, 'Tactics', 'screen title after tapping Tactics'),
    ])
    checks.push([
      'back names where it goes',
      () => assertEqual(pillarBack, 'Learn', 'back label on the pillar screen'),
    ])

    /* ------------------------------------------------ push two levels */

    const firstCategory =
      (await s.page.locator('.nav-card .nav-title').nth(3).textContent())?.trim() ?? ''
    await s.page.locator('.nav-card', { hasText: firstCategory }).first().locator('.nav-main').click()
    await s.page.waitForSelector('.screen-title', { timeout: 10_000 })
    const catTitle = await heading(s)
    const catBack = await backLabel(s)
    await shot(s, 'learn-3-category')

    checks.push([
      'a category is a screen of its own, two levels deep',
      () => {
        assertEqual(catTitle, firstCategory, 'category screen title')
        assertEqual(catBack, 'Tactics', 'back label on the category screen')
      },
    ])

    /* ------------------------------------- the system back button pops */

    await s.page.goBack()
    await s.page.waitForTimeout(400)
    const afterHardwareBack = await heading(s)

    checks.push([
      'the system back button goes up one level, not out of the app',
      () =>
        assertEqual(
          afterHardwareBack,
          'Tactics',
          'the browser back button should return to the pillar screen',
        ),
    ])

    await s.page.goBack()
    await s.page.waitForTimeout(400)
    const afterSecondBack = await heading(s)

    checks.push([
      'a second system back returns to the index',
      () => assertEqual(afterSecondBack, '', 'should be back at the Learn root'),
    ])

    /* ------------------------------------------- the on-screen control */

    await s.page.locator('.nav-card', { hasText: 'Endgames' }).first().locator('.nav-main').click()
    await s.page.waitForSelector('.screen-title', { timeout: 10_000 })
    await s.page.locator('button.back').first().click()
    await s.page.waitForTimeout(400)
    const afterButtonBack = await heading(s)

    checks.push([
      'the on-screen back control does the same thing',
      () => assertEqual(afterButtonBack, '', 'should be back at the Learn root'),
    ])

    /* ------------------------------ the quick action must not navigate */

    await s.page.locator('.nav-card', { hasText: 'Tactics' }).first().locator('.nav-main').click()
    await s.page.waitForSelector('.screen-title', { timeout: 10_000 })
    const trainCard = s.page.locator('.nav-card').filter({ has: s.page.locator('.nav-action') }).first()
    const trainCardName = (await trainCard.locator('.nav-title').textContent())?.trim() ?? ''
    await trainCard.locator('.nav-action').click()
    await s.page.waitForTimeout(2500)
    const afterTrain = await heading(s)

    checks.push([
      'Train starts training rather than opening the card it sits on',
      () =>
        assert(
          afterTrain !== trainCardName,
          `tapping Train opened the "${afterTrain}" screen instead of starting a set`,
        ),
    ])

    /* --------------------------- leaving hands the history entries back */

    await s.page.getByRole('button', { name: 'Learn' }).click()
    await s.page.waitForSelector('.nav-card', { timeout: 10_000 })
    await s.page.locator('.nav-card', { hasText: 'Openings' }).first().locator('.nav-main').click()
    await s.page.waitForSelector('.screen-title', { timeout: 10_000 })
    const deepTitle = await heading(s)
    // Leave the screen entirely while still deep.
    await s.page.getByRole('button', { name: 'Today' }).click()
    await s.page.waitForTimeout(600)
    await s.page.getByRole('button', { name: 'Learn' }).click()
    await s.page.waitForSelector('.nav-card', { timeout: 10_000 })
    const afterReturn = await heading(s)

    checks.push([
      'coming back to Learn starts at the index rather than where you left off',
      () => {
        assertEqual(deepTitle, 'Openings', 'should have been deep before leaving')
        assertEqual(afterReturn, '', 'returning to Learn should show the index')
      },
    ])

    checks.push(['nothing threw in the page', () => assertEqual(s.errors, [], 'page errors')])

    const ok = await runChecks('Learn — click into it', checks)
    process.exitCode = ok ? 0 : 1
  } finally {
    await s.close()
  }
}

await main()
