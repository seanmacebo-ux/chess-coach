/**
 * Settings — sign-in, appearance, and the sync status.
 *
 * The sign-in copy is deliberately explicit about what syncing does and does
 * not do. The app works fully signed out; an account exists so one profile
 * follows you across devices and a cleared cache stops wiping your history.
 */

import { useCallback, useEffect, useState } from 'react'
import { currentAuth, sendMagicLink, signOut, type AuthState } from '../../data/supabase'
import { syncNow, type SyncResult } from '../../data/sync'
import { BOARD_THEMES, PIECE_SETS, boardBackground, type ThemeChoice } from '../../theme/theme'

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

  useEffect(() => {
    void currentAuth().then(setAuth)
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

      {/* ------------------------------------------------ appearance */}
      <div className="card stack">
        <span className="small muted">Appearance</span>

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

        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Board
          </div>
          <div className="chips">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                className="swatch"
                aria-pressed={theme.board === t.id}
                aria-label={`${t.name} board`}
                title={`${t.name} board`}
                style={{ backgroundImage: boardBackground(t) }}
                onClick={() => onTheme({ ...theme, board: t.id })}
              />
            ))}
          </div>
        </div>

        <div className="small muted">
          Pieces: {PIECE_SETS.find((p) => p.id === theme.pieces)?.credit ?? 'cburnett'}
        </div>
      </div>
    </div>
  )
}
