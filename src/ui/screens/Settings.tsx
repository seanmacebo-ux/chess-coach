/**
 * Settings — sign-in, appearance, training preferences, and sync status.
 *
 * The appearance section leads with a LIVE BOARD rather than swatches. Picking
 * a set from 44px chips is guesswork: a chip shows two colours and a hint of
 * grain, and tells you nothing about what a knight looks like standing on it.
 * The preview is the same generator the real board uses, so what you see is
 * exactly what you get.
 *
 * The sign-in copy is deliberately explicit about what syncing does and does
 * not do. The app works fully signed out; an account exists so one profile
 * follows you across devices and a cleared cache stops wiping your history.
 */

import { useCallback, useEffect, useState } from 'react'
import { currentAuth, sendMagicLink, signOut, type AuthState } from '../../data/supabase'
import { syncNow, type SyncResult } from '../../data/sync'
import { loadPrefs, savePrefs, PUZZLE_COUNTS, type Prefs } from '../../data/settings'
import {
  describeImport,
  fetchChessComProfile,
  fetchRecentGames,
  importGames,
} from '../../data/chesscom'
import { saveProfile } from '../../data/db'
import {
  SECTION_IDS,
  SECTION_NAME,
  explainSection,
  getSectionRatings,
  seedSections,
  type SectionId,
  type SectionRating,
} from '../../coach/rating'
import { ThemePreview } from '../ThemePreview'
import {
  BACKGROUNDS,
  BOARD_GROUPS,
  PIECE_SETS,
  boardBackground,
  pieceSrc,
  resolveTheme,
  type ThemeChoice,
} from '../../theme/theme'

export type ColourMode = 'system' | 'light' | 'dark'

export interface SettingsProps {
  theme: ThemeChoice
  onTheme: (t: ThemeChoice) => void
  colourMode: ColourMode
  onColourMode: (m: ColourMode) => void
}

export function Settings({ theme, onTheme, colourMode, onColourMode }: SettingsProps) {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())

  /* --------------------------------------------------- calibration */
  const [ccUser, setCcUser] = useState('')
  const [ccBusy, setCcBusy] = useState(false)
  const [ccError, setCcError] = useState<string | null>(null)
  const [ccNote, setCcNote] = useState<string | null>(null)
  const [gamesBusy, setGamesBusy] = useState(false)
  const [gamesNote, setGamesNote] = useState<string | null>(null)
  const [sectionRatings, setSectionRatings] = useState<Record<SectionId, SectionRating> | null>(
    null,
  )

  useEffect(() => {
    void currentAuth().then(setAuth)
    void getSectionRatings().then(setSectionRatings)
  }, [])

  /**
   * Pull a real playing strength off chess.com and calibrate against it.
   *
   * Seeding is deliberately non-destructive: `seedSections` leaves any section
   * that already carries attempts alone, because an imported number is an
   * assumption and the attempts are a measurement. Overwriting the second with
   * the first would throw away the better evidence.
   *
   * The global profile rating is set too, since it is what the puzzle picker
   * and the opening filter still read.
   */
  /**
   * Pull the games themselves, not just the number.
   *
   * This is the one that matters. Everything the coach knew came from games
   * against its own bots, and those do not play like the people you actually
   * lose to — so the weakness profile, the ladder ordering and every
   * recommendation downstream were learned from a synthetic opponent. Real
   * games make the coaching about your chess.
   *
   * Games arrive un-analysed and are reviewed on demand from History: the
   * import is instant, an engine pass over twenty games is not, and making you
   * wait for all of them before seeing any would be the wrong trade.
   */
  const importMyGames = useCallback(async () => {
    setGamesBusy(true)
    setGamesNote(null)
    setCcError(null)
    try {
      const games = await fetchRecentGames(ccUser, { max: 20 })
      if (games.length === 0) {
        setGamesNote('No rated standard games found on that account.')
        return
      }
      const { added, skipped } = await importGames(games)
      setGamesNote(
        `${added} game${added === 1 ? '' : 's'} imported${
          skipped > 0 ? `, ${skipped} already had` : ''
        }. Open History and hit Review on any of them — that runs the engine over your moves and shows what you should have played.`,
      )
    } catch (err) {
      setCcError(err instanceof Error ? err.message : String(err))
    } finally {
      setGamesBusy(false)
    }
  }, [ccUser])

  const importRating = useCallback(async () => {
    setCcBusy(true)
    setCcError(null)
    setCcNote(null)
    try {
      const found = await fetchChessComProfile(ccUser)
      if (!found.calibration) {
        setCcError(describeImport(found))
        return
      }
      const rating = found.calibration.rating
      await saveProfile({ rating })
      const seeded = await seedSections(rating)
      setSectionRatings(await getSectionRatings())
      setCcNote(
        `${describeImport(found)} ${
          seeded.length === 0
            ? 'Every section already has training behind it, so none were reset — those numbers are measurements now, not guesses.'
            : `${seeded.length} section${seeded.length === 1 ? '' : 's'} set to ${rating}.`
        }`,
      )
    } catch (err) {
      setCcError(err instanceof Error ? err.message : String(err))
    } finally {
      setCcBusy(false)
    }
  }, [ccUser])

  const patchPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  const signIn = useCallback(async () => {
    if (!email.includes('@')) {
      setMsg('That does not look like an email address.')
      return
    }
    setBusy(true)
    setMsg(null)
    const res = await sendMagicLink(email.trim())
    setBusy(false)
    if (res.ok) setSent(true)
    else setMsg(res.error ?? 'Could not send the link.')
  }, [email])

  const doSync = useCallback(async () => {
    setBusy(true)
    const res = await syncNow()
    setSync(res)
    setBusy(false)
  }, [])

  const doSignOut = useCallback(async () => {
    await signOut()
    setAuth(await currentAuth())
    setSync(null)
  }, [])

  const resolved = resolveTheme(theme)

  return (
    <div className="stack">
      {/* --------------------------------------------------- account */}
      <div className="card stack">
        <span className="small muted">Your progress</span>

        {auth?.signedIn ? (
          <>
            <div>
              Signed in as <strong>{auth.email}</strong>
            </div>
            <div className="small muted">
              Your games, mistakes and tier progress sync to the cloud. Sign in with this same
              email on another machine and it picks up exactly where you left off.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" style={{ flex: 1 }} disabled={busy} onClick={doSync}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="ghost" onClick={doSignOut}>
                Sign out
              </button>
            </div>
            {sync && (
              <div className="small muted">
                {sync.ok
                  ? `Sent ${sync.pushed} records, received ${sync.pulled}.`
                  : `Sync failed: ${sync.error}. Your data is safe on this device — nothing was lost.`}
              </div>
            )}
          </>
        ) : sent ? (
          <>
            <div>
              <strong>Check your email.</strong>
            </div>
            <div className="small muted">
              Sent a sign-in link to {email}. Click it on this device and you're in — no password
              to remember or lose.
            </div>
          </>
        ) : (
          <>
            <div className="small muted">
              Right now everything is stored only on this device. Clear your browser and it's
              gone. Add an email and your history follows you between your phone and your work
              machine.
            </div>
            <label className="field">
              Email
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy} onClick={signIn}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <div className="small muted">
              No password. The app works completely fine without this — signing in only adds
              backup and syncing.
            </div>
          </>
        )}
        {msg && (
          <div className="small" style={{ color: 'var(--danger)' }}>
            {msg}
          </div>
        )}
      </div>

      {/* --------------------------------------------------- calibration */}
      <div className="card stack">
        <span className="small muted">Your rating</span>

        <div className="small">
          Every section below carries its own rating, and they all start from one number. Getting
          that number right matters more than it looks: it decides how hard your puzzles are, which
          openings you are shown, and which endgames unlock. Importing it from chess.com beats
          guessing.
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="field"
            style={{ flex: 1 }}
            placeholder="chess.com username"
            value={ccUser}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCcUser(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void importRating()
            }}
          />
          <button className="primary" disabled={ccBusy} onClick={() => void importRating()}>
            {ccBusy ? 'Checking…' : 'Rating'}
          </button>
        </div>

        {ccError && (
          <div className="small" style={{ color: 'var(--danger)' }}>
            {ccError}
          </div>
        )}
        {ccNote && <div className="small">{ccNote}</div>}

        {/*
          Two separate imports on purpose. The rating is one number and
          calibrates the whole app in a second; the games are the actual
          coaching material and cost a network round-trip per month of
          history. Bundling them would make the fast, always-useful one wait
          for the slow one.
        */}
        <div className="row" style={{ gap: 8 }}>
          <button
            className="ghost"
            style={{ flex: 1 }}
            disabled={gamesBusy || ccUser.trim() === ''}
            onClick={() => void importMyGames()}
          >
            {gamesBusy ? 'Fetching games…' : 'Import my last 20 games'}
          </button>
        </div>
        {gamesNote && <div className="small">{gamesNote}</div>}
        <div className="small muted">
          Your real games are what the coach should be learning from — the bots here do not play
          like the people you actually lose to. Imported games appear in History with a Review
          button.
        </div>

        {/*
          The ratings are listed here as well as in Learn, because this is the
          screen where you change the number they came from — seeing what the
          import actually did to each section, immediately and in place, is the
          difference between a setting and a leap of faith.
        */}
        {sectionRatings && (
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {SECTION_IDS.map((id) => {
              const r = sectionRatings[id]
              if (!r) return null
              return (
                <div key={id} className="row spread hist-row">
                  <span className="small" style={{ textTransform: 'capitalize' }}>
                    {SECTION_NAME[id]}
                  </span>
                  <span
                    className="small"
                    style={{ color: r.provisional ? 'var(--muted)' : 'var(--text)' }}
                    title={explainSection(r).what}
                  >
                    {r.rating}
                    {r.provisional ? ' · not rated yet' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------- training */}
      <div className="card stack">
        <span className="small muted">Training</span>

        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Puzzles per session
          </div>
          <div className="chips">
            {PUZZLE_COUNTS.map((n) => (
              <button
                key={n}
                className="chip"
                aria-pressed={prefs.puzzlesPerDay === n}
                onClick={() => patchPrefs({ puzzlesPerDay: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Three tries on each. A miss costs points, a nudge costs more — so the score reflects
            what you actually saw rather than how many you eventually got through.
          </div>
        </div>

        <label className="row spread" style={{ gap: 12, cursor: 'pointer' }}>
          <span style={{ flex: 1 }}>
            <div>Blunder check</div>
            <div className="small muted">
              Before your move plays, get asked whether anything is hanging. Training wheels for
              the habit that actually costs games.
            </div>
          </span>
          <input
            type="checkbox"
            checked={prefs.blunderCheck}
            onChange={(e) => patchPrefs({ blunderCheck: e.target.checked })}
          />
        </label>

        <label className="row spread" style={{ gap: 12, cursor: 'pointer' }}>
          <span style={{ flex: 1 }}>
            <div>Board coordinates</div>
            <div className="small muted">Files and ranks around the edge.</div>
          </span>
          <input
            type="checkbox"
            checked={prefs.showCoordinates}
            onChange={(e) => patchPrefs({ showCoordinates: e.target.checked })}
          />
        </label>
      </div>

      {/* ------------------------------------------------ appearance */}
      <div className="card stack">
        <span className="small muted">Appearance</span>

        {/* The example, before any of the pickers. */}
        <ThemePreview board={resolved.board} pieces={resolved.pieces} />

        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Light or dark
          </div>
          <div className="chips">
            {(['system', 'light', 'dark'] as ColourMode[]).map((m) => (
              <button
                key={m}
                className="chip"
                aria-pressed={colourMode === m}
                onClick={() => onColourMode(m)}
              >
                {m === 'system' ? 'Match device' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        {/* Boards, grouped by material rather than one undifferentiated wall. */}
        <div className="stack" style={{ gap: 8 }}>
          <div className="small">Board</div>
          {BOARD_GROUPS.map((g) => (
            <div key={g.finish} className="swatch-group">
              <div className="small muted">{g.label}</div>
              <div className="chips">
                {g.themes.map((t) => (
                  <button
                    key={t.id}
                    className="swatch"
                    aria-pressed={theme.board === t.id}
                    aria-label={`${t.name} board, ${g.label.toLowerCase()} finish`}
                    title={`${t.name} — ${g.label}`}
                    // 2x2 rather than the full 8x8: at 32px a whole board is
                    // mush and every material looks identical.
                    style={{ backgroundImage: boardBackground(t, 2) }}
                    onClick={() => onTheme({ ...theme, board: t.id })}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="small muted">
            <strong style={{ color: 'var(--text)' }}>{resolved.board.name}</strong> —{' '}
            {BOARD_GROUPS.find((g) => g.finish === resolved.board.finish)?.label} finish. Every
            material is generated in the browser, so switching costs nothing and none of it is
            downloaded.
          </div>
        </div>

        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Pieces
          </div>
          <div className="chips">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                className="pieceswatch"
                aria-pressed={theme.pieces === p.id}
                aria-label={`${p.name} pieces`}
                title={p.blurb}
                onClick={() => onTheme({ ...theme, pieces: p.id })}
              >
                <img src={pieceSrc(p, 'wN')} alt="" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            <strong style={{ color: 'var(--text)' }}>{resolved.pieces.name}</strong> —{' '}
            {resolved.pieces.blurb}
          </div>
          <div className="small muted" style={{ marginTop: 2, fontStyle: 'italic' }}>
            {resolved.pieces.credit}
          </div>
        </div>

        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Background
          </div>
          {(['Neutral', 'Colour', 'Nature', 'Chess'] as const).map((g) => (
            <div key={g} style={{ marginBottom: 8 }}>
              <div className="small muted" style={{ marginBottom: 4 }}>
                {g}
              </div>
              <div className="chips">
                {BACKGROUNDS.filter((b) => b.group === g).map((b) => (
                  <button
                    key={b.id}
                    className="bgswatch"
                    aria-pressed={theme.background === b.id}
                    aria-label={`${b.name} background`}
                    title={b.name}
                    style={{ background: b.css }}
                    onClick={() => onTheme({ ...theme, background: b.id })}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="small muted">
            All drawn in CSS rather than downloaded — nothing to fetch, and every one works in
            both light and dark.
          </div>
        </div>
      </div>
    </div>
  )
}
