import { readJobPosting } from './extract.js'

/**
 * The extension's one privileged place.
 *
 * Every call to Chills is made from here, never from a content script. A
 * content script runs inside the page it is reading, so its fetches carry the
 * page's origin and are subject to that page's CORS — and, worse, a hostile
 * page shares the context the token would be handled in. The service worker
 * shares nothing with the page: it asks the page for text, and nothing else
 * crosses the line.
 *
 * The token lives in chrome.storage.local, which is per-profile and not
 * readable by a page.
 */

const DEFAULT_BASE = 'https://chills.pro'

// ── Stored state ────────────────────────────────────────────────────────────

const store = {
  async get(keys) {
    return chrome.storage.local.get(keys)
  },
  async set(values) {
    return chrome.storage.local.set(values)
  },
  async clear(keys) {
    return chrome.storage.local.remove(keys)
  },
}

async function baseUrl() {
  const { baseUrl } = await store.get('baseUrl')
  return (baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
}

async function token() {
  const { token } = await store.get('token')
  return token || null
}

// ── Talking to Chills ───────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * One request to Chills, with the account's key on it.
 *
 * A 401 is special: it means the key was revoked or the account is gone, and
 * the only useful answer is to forget it and ask to connect again. Leaving a
 * dead key in storage makes every later action fail for no stated reason.
 */
async function api(path, { method = 'GET', body, signal } = {}) {
  const key = await token()
  if (!key) throw new ApiError('Not connected', 401)

  const res = await fetch(`${await baseUrl()}${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    await store.clear('token')
    throw new ApiError('Chills has been disconnected. Connect it again.', 401)
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? `Chills answered ${res.status}.`, res.status)
  return data
}

// ── Connecting ──────────────────────────────────────────────────────────────

const randomState = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c])
}

/**
 * Hand the sign-in to Chrome.
 *
 * launchWebAuthFlow opens the connect page in a window the extension cannot
 * read, and only tells the extension the address it finally landed on. So the
 * user's Google password is never near this code, and the key arrives in a URL
 * fragment that Chrome hands only to the extension that asked.
 */
async function connect() {
  const redirectUri = chrome.identity.getRedirectURL()
  const state = randomState()
  const url = new URL('/extension/connect', await baseUrl())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('label', 'Chrome extension')

  const landed = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })
  if (!landed) throw new Error('Connecting was cancelled.')

  const fragment = new URLSearchParams(new URL(landed).hash.slice(1))
  const got = fragment.get('token')
  // The state proves this answer belongs to the request just made, and not to
  // an older window or a page that guessed the callback address.
  if (fragment.get('state') !== state) throw new Error('That reply did not match the request. Try connecting again.')
  if (!got) throw new Error('Chills did not send a key back.')

  await store.set({ token: got })
  return api('/api/extension/session')
}

async function disconnect() {
  await store.clear('token')
  return { ok: true }
}

// ── Reading the page ────────────────────────────────────────────────────────

/**
 * Ask the tab for its job posting.
 *
 * The extractor is injected on demand rather than declared as a content script,
 * so nothing of this extension runs on any page until the user opens the panel
 * and asks. On a site outside the manifest's hosts this needs permission, and
 * the panel asks for that site alone.
 */
async function readTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: readJobPosting,
  })
  return result?.result ?? { ok: false, reason: 'That page could not be read.' }
}

async function hasAccess(url) {
  try {
    return await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] })
  } catch {
    return false
  }
}

async function requestAccess(url) {
  try {
    return await chrome.permissions.request({ origins: [new URL(url).origin + '/*'] })
  } catch {
    return false
  }
}

// ── Message routing ─────────────────────────────────────────────────────────

const HANDLERS = {
  session: () => api('/api/extension/session'),
  connect,
  disconnect,

  async read({ tabId, url }) {
    if (!(await hasAccess(url))) return { ok: false, needsPermission: true, origin: new URL(url).origin }
    return readTab(tabId)
  },

  async grant({ url }) {
    return { granted: await requestAccess(url) }
  },

  capture: ({ job }) => api('/api/extension/capture', { method: 'POST', body: job }),
  savedFor: ({ url }) => api(`/api/extension/capture?url=${encodeURIComponent(url)}`),
  jobs: () => api('/api/extension/capture'),
  setStatus: ({ id, status }) => api('/api/extension/capture', { method: 'PATCH', body: { id, status } }),
  forget: ({ id }) => api(`/api/extension/capture?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  score: ({ resumeId, jobDescription, jobId }) =>
    api('/api/extension/score', { method: 'POST', body: { resumeId, jobDescription, jobId } }),

  /**
   * Hand the job to the app, where the review screens live.
   *
   * `jobs` carries no job of its own: it opens the list of everything saved,
   * which is what the panel's own Saved jobs button wants. The other two carry
   * one, and the app opens the screen that was asked for with the posting
   * already in it.
   */
  async openInChills({ jobId, where }) {
    const path =
      where === 'jobs'
        ? '/dashboard?open=jobs'
        : where === 'outreach'
          ? `/dashboard?open=outreach&job=${encodeURIComponent(jobId)}`
          : `/dashboard?open=tailor&job=${encodeURIComponent(jobId)}`
    await chrome.tabs.create({ url: `${await baseUrl()}${path}` })
    return { ok: true }
  },

  async setBaseUrl({ url }) {
    await store.set({ baseUrl: url || DEFAULT_BASE })
    return { ok: true }
  },
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.kind]
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown request: ${message?.kind}` })
    return false
  }
  Promise.resolve(handler(message.payload ?? {}))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message ?? String(err), status: err?.status ?? 0 }))
  // Keeps the message channel open for the promise above.
  return true
})

// Clicking the toolbar icon opens the panel rather than a popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
