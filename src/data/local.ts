/**
 * localStorage that cannot take the app down with it.
 *
 * `localStorage.getItem` is not a safe read. In a browser with site data
 * blocked — Safari private browsing, an embedded webview, Chrome with
 * third-party cookies disabled inside an iframe, any locked-down corporate
 * profile — merely TOUCHING window.localStorage throws a SecurityError.
 *
 * Most of this codebase already knew that and wrapped every call. Six sites
 * did not, and two of them ran at App boot: loadColourMode() during the very
 * first useState, and the effect that writes the colour mode straight after.
 * On a device where storage throws, the app was a white screen — not a
 * degraded app, no app — and the cause would have been a preference nobody
 * would think to suspect.
 *
 * This exists so that the guard is not something each call site has to
 * remember. A read that fails returns null, which every caller here already
 * handles because it is also what a first run looks like; a write that fails
 * is dropped, and the preference simply does not persist. Neither is worth
 * an error message: someone browsing privately has asked for exactly this.
 */

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked or full — the preference just will not survive */
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to do: if it cannot be written it cannot have been stored */
  }
}
