/**
 * Where a freshly cut extension key is allowed to be sent.
 *
 * The connect page is reached with a `redirect_uri` chosen by whoever opened
 * it, and it hands a working key to that address. So this is the whole security
 * of the flow: anybody can send a user to
 * `/extension/connect?redirect_uri=https://evil.example`, and if the page obeys,
 * one click gives away the account.
 *
 * Only Chrome's own extension callback host is accepted. `chrome.identity`
 * serves `https://<extension-id>.chromiumapp.org/` to the extension that asked
 * and to nothing else, so a key sent there cannot leave the browser. Extension
 * ids are exactly 32 letters a–p.
 *
 * Client-safe: no imports, so the page and its button agree on one rule.
 */

const CALLBACK_HOST = /^[a-p]{32}\.chromiumapp\.org$/

export interface ConnectTarget {
  redirectUri: string
  /** The extension asking, taken from the host rather than from a parameter it could claim. */
  extensionId: string
  state: string
}

/**
 * The target to send a key to, or null when the address is not one.
 *
 * An allowlist in CHILLS_EXTENSION_IDS narrows it further to the builds you
 * publish; unset, any Chrome extension may ask, and the user's own click on a
 * page that names the id is what authorises it.
 */
export function connectTarget(
  redirectUri: string | undefined,
  state: string | undefined,
  allowed: string[] = []
): ConnectTarget | null {
  if (!redirectUri || !state) return null
  if (state.length < 16 || state.length > 128 || !/^[A-Za-z0-9._-]+$/.test(state)) return null

  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!CALLBACK_HOST.test(url.hostname)) return null
  // A callback carrying its own query or fragment is not one Chrome minted.
  if (url.search || url.hash) return null

  const extensionId = url.hostname.split('.')[0]
  if (allowed.length > 0 && !allowed.includes(extensionId)) return null

  return { redirectUri: url.toString(), extensionId, state }
}

/** The ids this deployment will hand keys to. Empty means "any Chrome extension". */
export function allowedExtensionIds(raw: string | undefined = process.env.CHILLS_EXTENSION_IDS): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => CALLBACK_HOST.test(`${id}.chromiumapp.org`))
}

/** The address the key is actually delivered to, with the token in the fragment. */
export function deliveryUrl(target: ConnectTarget, token: string): string {
  // The fragment, never the query: a fragment is not sent to a server, does not
  // reach a proxy log, and is not kept in history the way a query string is.
  const params = new URLSearchParams({ token, state: target.state })
  return `${target.redirectUri}#${params.toString()}`
}
