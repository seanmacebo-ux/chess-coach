/**
 * Supabase client.
 *
 * ON THE KEY BELOW BEING IN A PUBLIC REPO — this is deliberate, not an
 * accident, and the distinction matters:
 *
 *   publishable key   ships in the browser bundle by design. Anyone can read
 *                     it. It grants nothing on its own; Row Level Security
 *                     decides what the holder can actually see, and every
 *                     policy is scoped to auth.uid(). Safe to commit.
 *
 *   service_role key  bypasses RLS entirely. Full read/write on every row of
 *                     every table. NEVER put one in this file, in the client,
 *                     or anywhere in this repo.
 *
 * If a table is ever added without RLS enabled, the key above stops being
 * harmless and that table becomes world-readable. See the migration.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xflsyaartsmyjkejtfpn.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_FJnbQhuV_viiUxN7miEQ3w_x8i6MEkO'

let client: SupabaseClient | null = null

/**
 * Lazily constructed so the app boots without touching the network. Sync is
 * additive — the app is fully usable signed out and offline, and nothing here
 * is allowed to become a load-bearing dependency.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

export interface AuthState {
  signedIn: boolean
  email: string | null
  userId: string | null
}

export async function currentAuth(): Promise<AuthState> {
  try {
    const { data } = await getSupabase().auth.getSession()
    const user = data.session?.user
    return {
      signedIn: Boolean(user),
      email: user?.email ?? null,
      userId: user?.id ?? null,
    }
  } catch {
    // Offline, or Supabase unreachable. Not an error condition — the app
    // works signed out.
    return { signedIn: false, email: null, userId: null }
  }
}

/**
 * Send a magic link. No passwords: one fewer secret to lose, and the right
 * trade for an app whose data is a chess history rather than anything worth
 * attacking.
 */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function signOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut()
  } catch {
    /* already gone */
  }
}
