import { lookup } from 'node:dns/promises'
import { isPublicAddress } from '@/lib/net/public-address'

/**
 * Reading the job a Premium run is about, from the posting itself.
 *
 * The whole run — the role analysis, the tailored resume and the recruiter
 * email — is built from this text, so it has to be the employer's real words.
 * Nothing here asks a model what a company might be hiring for: a model asked
 * that invents openings, and the invention would reach a real recruiter in the
 * candidate's own name. The user points at a posting; the server reads it.
 *
 * The server only ever fetches a public address, over http(s), following each
 * redirect by hand and checking it again, so a link a user pastes can't be used
 * to reach a private network or a cloud metadata service. Server-only.
 */

export type JobSourceProblem = 'url' | 'blocked' | 'fetch' | 'type' | 'empty' | 'too_big'

export class JobSourceError extends Error {
  constructor(
    message: string,
    readonly kind: JobSourceProblem
  ) {
    super(message)
    this.name = 'JobSourceError'
  }
}

/** A posting long enough to tailor against; anything shorter is a landing page, not a job. */
export const MIN_POSTING_CHARS = 200
export const MAX_POSTING_CHARS = 20_000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 4
const TIMEOUT_MS = 20_000

const allowLocal = () => process.env.NODE_ENV !== 'production' && process.env.APPLY_FETCH_ALLOW_LOCAL === 'true'

/** The link as a URL, or a reason it can't be used. Only http and https; no credentials, no fragment games. */
export function normalizeJobUrl(raw: string): URL {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) throw new JobSourceError('Paste the link to the job posting.', 'url')
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new JobSourceError('That doesn’t look like a link. Copy the job posting’s address from your browser.', 'url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new JobSourceError('Job links must start with https://.', 'url')
  }
  if (url.username || url.password) {
    throw new JobSourceError('Remove the username and password from the link.', 'url')
  }
  return url
}

/** The address to connect to for a URL, after checking the server may reach it. */
export async function resolvePublicHost(url: URL): Promise<string> {
  const host = url.hostname.toLowerCase()
  if (allowLocal() && (host === 'localhost' || host === '127.0.0.1')) return '127.0.0.1'

  // A bare IP in the link is checked directly; a name is resolved and every answer checked.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    const bare = host.replace(/^\[|\]$/g, '')
    if (!isPublicAddress(bare)) throw new JobSourceError('That link points inside a private network, so it can’t be read.', 'blocked')
    return bare
  }

  let answers: Array<{ address: string }>
  try {
    answers = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new JobSourceError(`${host} couldn’t be found. Check the link.`, 'fetch')
  }
  if (answers.length === 0 || !answers.every(({ address }) => isPublicAddress(address))) {
    throw new JobSourceError('That link points inside a private network, so it can’t be read.', 'blocked')
  }
  return answers[0].address
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  middot: '·',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * The readable text of a page: the chrome removed, block elements kept apart so
 * a list of requirements doesn't run into one line, and entities decoded.
 */
export function textFromHtml(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  return decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table)\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface Posting {
  /** Where it was read from, after any redirects. */
  url: string
  title: string
  company: string
  location: string
  /** The posting's own words: what the run is built from. */
  text: string
  /** Whether it came from the page's own structured JobPosting data rather than its text. */
  structured: boolean
}

interface JsonLdJob {
  '@type'?: string | string[]
  title?: string
  description?: string
  hiringOrganization?: { name?: string } | string
  jobLocation?: unknown
  datePosted?: string
}

const typeOf = (node: JsonLdJob) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter(Boolean).map(String)

/** Every object inside a JSON-LD blob, however it is nested or graphed. */
function flatten(value: unknown, out: JsonLdJob[] = [], depth = 0): JsonLdJob[] {
  if (depth > 6 || value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out, depth + 1)
    return out
  }
  out.push(value as JsonLdJob)
  for (const item of Object.values(value as Record<string, unknown>)) flatten(item, out, depth + 1)
  return out
}

function placeName(location: unknown, depth = 0): string {
  if (depth > 4 || !location) return ''
  if (typeof location === 'string') return location
  if (Array.isArray(location)) return placeName(location[0], depth + 1)
  const node = location as Record<string, unknown>
  const address = node.address
  if (address && typeof address === 'object') {
    const parts = address as Record<string, unknown>
    return [parts.addressLocality, parts.addressRegion, parts.addressCountry]
      .map((part) => (typeof part === 'string' ? part : ''))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof node.name === 'string') return node.name
  return placeName(address, depth + 1)
}

/**
 * Most job boards publish the posting as schema.org JobPosting in the page, which
 * is the employer's own text without the site's furniture around it. Preferred
 * when it is there.
 */
export function jobPostingFromHtml(html: string): Omit<Posting, 'url'> | null {
  const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const [, raw] of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.trim())
    } catch {
      continue
    }
    for (const node of flatten(parsed)) {
      if (!typeOf(node).includes('JobPosting') || typeof node.description !== 'string') continue
      const text = textFromHtml(node.description)
      if (text.length < MIN_POSTING_CHARS) continue
      const org = node.hiringOrganization
      return {
        title: typeof node.title === 'string' ? decodeEntities(node.title).trim().slice(0, 200) : '',
        company: (typeof org === 'string' ? org : org?.name ?? '').trim().slice(0, 160),
        location: placeName(node.jobLocation).trim().slice(0, 160),
        text: text.slice(0, MAX_POSTING_CHARS),
        structured: true,
      }
    }
  }
  return null
}

function pageTitle(html: string): string {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  // Job boards title pages "Platform Engineer at Northwind | Board".
  return decodeEntities(raw).replace(/\s+/g, ' ').trim().split(/\s+[|–—-]\s+/)[0].slice(0, 200)
}

/** One hop, with the body capped so a huge page can't be pulled into memory. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new JobSourceError('That page is too large to read.', 'too_big')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new JobSourceError('That page is too large to read.', 'too_big')
  return new TextDecoder('utf-8').decode(buffer)
}

/** Injected by the checks so they never touch the network or a resolver. */
export interface FetchDeps {
  fetchImpl?: typeof fetch
  resolveHost?: (url: URL) => Promise<string>
}

/**
 * Fetch a job posting, checking every hop. Redirects are followed by hand
 * because `redirect: "follow"` would send the request to an address that was
 * never checked.
 */
export async function fetchJobPosting(rawUrl: string, deps: FetchDeps = {}): Promise<Posting> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const resolveHost = deps.resolveHost ?? resolvePublicHost
  let url = normalizeJobUrl(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await resolveHost(url)
    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        redirect: 'manual',
        headers: {
          // Identifying, and asking for the page a reader would get.
          'User-Agent': 'ResMod/1.0 (+https://chills.pro; job posting reader)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new JobSourceError('That job posting couldn’t be reached. Check the link, or paste the job text instead.', 'fetch')
    }

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) throw new JobSourceError('That link goes nowhere. Paste the job text instead.', 'fetch')
      url = normalizeJobUrl(new URL(next, url).toString())
      continue
    }
    if (!response.ok) {
      const why =
        response.status === 404
          ? 'That posting is gone — it may have been filled.'
          : response.status === 403 || response.status === 401
            ? 'That site won’t let ResMod read the posting. Paste the job text instead.'
            : 'That job posting couldn’t be read. Paste the job text instead.'
      throw new JobSourceError(why, 'fetch')
    }

    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new JobSourceError('That link isn’t a web page. Paste the job text instead.', 'type')
    }

    const html = await readCapped(response)
    const structured = jobPostingFromHtml(html)
    if (structured) return { url: url.toString(), ...structured }

    const text = textFromHtml(html)
    if (text.length < MIN_POSTING_CHARS) {
      throw new JobSourceError(
        'There wasn’t enough text on that page — some job boards load the posting after the page opens. Paste the job text instead.',
        'empty'
      )
    }
    return {
      url: url.toString(),
      title: pageTitle(html),
      company: '',
      location: '',
      text: text.slice(0, MAX_POSTING_CHARS),
      structured: false,
    }
  }
  throw new JobSourceError('That link redirects too many times. Paste the job text instead.', 'fetch')
}

/** A posting the user pasted rather than linked. */
export function postingFromText(text: string, title = ''): Posting {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (clean.length < MIN_POSTING_CHARS) {
    throw new JobSourceError('Paste the whole job description, not just the title.', 'empty')
  }
  return { url: '', title: title.trim().slice(0, 200), company: '', location: '', text: clean.slice(0, MAX_POSTING_CHARS), structured: false }
}
