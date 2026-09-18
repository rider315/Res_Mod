import { z } from 'zod'
import { extractJSON } from '@/lib/json-repair'
import { FetchDeps, fetchPublicPage, PageWords, pinnedFetcher, textFromHtml } from '@/lib/apply/job-source'
import { employerDomain } from '@/lib/outreach/mail-domains'
import type { CompanyNote } from '@/lib/outreach/types'
import type { GenerateFn } from '@/lib/run-optimization'

/**
 * What a recruiter email may say about the company, read from the company's own
 * website.
 *
 * Chills once asked the model what it knew about a company: its sector, its tech
 * stack, its recent news. The model answered whether it knew or not, and an
 * invented piece of news would have reached a real recruiter under the
 * candidate's name. So nothing here comes from the model's memory:
 *   1. the site is the one the recruiter's own address points at, and the
 *      server reads it (lib/apply/job-source.ts: public addresses only);
 *   2. the model only picks out what that text says;
 *   3. each fact it picks is checked against the text, every number exactly,
 *      and dropped if the text doesn't back it.
 * A site that can't be read means an email that says nothing about the
 * company's work, as before.
 *
 * What was read is kept per domain for everyone (lib/db/company-research.ts):
 * it is public text, and one read serves every email to that company.
 * Server-only: it fetches.
 */

export const MAX_FACTS = 4
/** Enough of a site to see what the company does, and no more to pay for. */
const MAX_SITE_CHARS = 8_000
/** A home page shorter than this is mostly a script shell, so the about page is read too. */
const THIN_PAGE_CHARS = 800
/** Less than a posting the user asked for gets: the email waits on this. */
const SITE_TIMEOUT_MS = 8_000
const MIN_SITE_CHARS = 200

const ABOUT_PATHS = ['/about', '/about-us', '/company']

/** Only ever logged: the composer says what happened in its own words. */
const SITE_WORDS: PageWords = {
  unreachable: 'The company site could not be reached.',
  gone: 'The company site page does not exist.',
  refused: 'The company site refused the request.',
  unreadable: 'The company site could not be read.',
  notAPage: 'The company site did not return a web page.',
  nowhere: 'The company site redirected nowhere.',
  loops: 'The company site redirected too many times.',
}

export interface SiteText {
  /** The host the text came from, without "www.". */
  site: string
  text: string
}

/**
 * The readable text of a company's site: the home page, at the domain or at
 * www., and the about page too when the home page says little. Null when
 * nothing readable came back.
 */
export async function readCompanySite(domain: string, deps: FetchDeps = { fetchPage: pinnedFetcher(SITE_TIMEOUT_MS) }): Promise<SiteText | null> {
  let home: { url: URL; text: string } | null = null
  for (const address of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const page = await fetchPublicPage(address, deps, SITE_WORDS)
      home = { url: page.url, text: textFromHtml(page.html) }
      break
    } catch (err) {
      console.warn(`[research] ${address}:`, err instanceof Error ? err.message : err)
    }
  }
  if (!home) return null

  let text = home.text
  if (text.length < THIN_PAGE_CHARS) {
    for (const path of ABOUT_PATHS) {
      try {
        const about = textFromHtml((await fetchPublicPage(new URL(path, home.url).toString(), deps, SITE_WORDS)).html)
        if (about.length >= MIN_SITE_CHARS) {
          text = `${text}\n\n${about}`
          break
        }
      } catch {
        // Not every site has one; the next name is tried.
      }
    }
  }
  text = text.trim().slice(0, MAX_SITE_CHARS)
  return text.length >= MIN_SITE_CHARS ? { site: home.url.hostname.replace(/^www\./, ''), text } : null
}

// ─── What the model is asked, and the check on its answer ────────────────────

export const RESEARCH_SYSTEM_INSTRUCTION =
  'You pick out facts about a company from text on its own website, and never add anything the text does not say. Respond with only a JSON object.'

export function buildResearchPrompt(site: string, siteText: string): string {
  return `## TEXT FROM ${site}
${siteText}

## TASK
List up to ${MAX_FACTS} facts about this company that a job applicant could mention to one of its recruiters: what it builds or sells, who for, its products, its customers, its scale or its mission.
- Only what the text above says, in its own words and with its own numbers.
- One short sentence each, under 25 words, without the company's name.
- Skip navigation, cookie notices, legal text, job listings, and slogans that say nothing specific.
- If the text says nothing specific about the company, return an empty list.

## OUTPUT FORMAT
{ "company": "<the company's name as the text gives it, or an empty string>", "facts": ["<fact>"] }`
}

/** Words too common to show that a fact came from the page. */
const COMMON = new Set([
  'that', 'this', 'with', 'from', 'their', 'they', 'them', 'have', 'which', 'into', 'more', 'than', 'also',
  'over', 'about', 'your', 'what', 'when', 'where', 'while', 'each', 'every', 'such', 'other', 'most', 'many',
  'some', 'these', 'those', 'will', 'been', 'were', 'being', 'company', 'companies', 'help', 'helps',
  'provide', 'provides', 'offer', 'offers', 'based', 'across', 'through', 'using', 'uses', 'including',
])

const wordsOf = (text: string) => (text.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []).filter((word) => !COMMON.has(word))
/** "2,000" and "2000" are the same number, and so are "1.5" and "1,5". */
const numbersOf = (text: string) => (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((number) => number.replace(/[,.]/g, ''))

/**
 * Whether the site's own text backs a fact: every number in it appears there,
 * and most of its words do. The model may shorten what the site says; it may
 * not add to it.
 */
export function backedBy(fact: string, siteText: string): boolean {
  const site = siteText.toLowerCase()
  const siteNumbers = new Set(numbersOf(siteText))
  if (numbersOf(fact).some((number) => !siteNumbers.has(number))) return false
  const words = wordsOf(fact)
  if (words.length < 2) return false
  // The start of each word is enough to match "payments" to "payment" and "builds" to "build".
  const found = words.filter((word) => site.includes(word.slice(0, Math.max(4, word.length - 2))))
  return found.length / words.length >= 0.7
}

const ReplySchema = z.object({
  company: z.string().trim().max(120).catch(''),
  facts: z.array(z.unknown()).catch([]),
})

/** The model's answer, kept to the facts the site backs. Never throws: an answer that can't be read has none. */
export function parseResearch(reply: string, siteText: string): { company: string; facts: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(extractJSON(reply) ?? reply)
  } catch {
    return { company: '', facts: [] }
  }
  const parsed = ReplySchema.safeParse(raw)
  if (!parsed.success) return { company: '', facts: [] }

  const seen = new Set<string>()
  const facts = parsed.data.facts
    .map((fact) => (typeof fact === 'string' ? fact.replace(/\s+/g, ' ').trim() : ''))
    .filter((fact) => fact.length >= 12 && fact.length <= 240 && !/[<>[\]{}]/.test(fact))
    .filter((fact) => backedBy(fact, siteText))
    .filter((fact) => {
      const key = fact.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_FACTS)
  // The name is kept only as the text itself writes it.
  const company = parsed.data.company && siteText.toLowerCase().includes(parsed.data.company.toLowerCase()) ? parsed.data.company : ''
  return { company, facts }
}

// ─── Reading a company, once ─────────────────────────────────────────────────

export type ResearchStatus = 'found' | 'nothing' | 'unreachable'

export interface StoredResearch {
  site: string
  company: string
  facts: string[]
  status: ResearchStatus
  readAt: Date
}

/** Where what was read is kept. Both methods may fail; a failure is a miss, never an error. */
export interface ResearchStore {
  load(domain: string): Promise<StoredResearch | null>
  save(domain: string, entry: Omit<StoredResearch, 'readAt'>): Promise<void>
}

/** Sites change slowly, and a site that failed may be back tomorrow. */
const KEEP_FOUND_MS = 30 * 24 * 60 * 60 * 1000
const KEEP_MISS_MS = 2 * 24 * 60 * 60 * 1000

function noteFor(entry: Omit<StoredResearch, 'readAt'>): CompanyNote {
  if (entry.status === 'found' && entry.facts.length > 0) {
    return { status: 'found', site: entry.site, company: entry.company, facts: entry.facts }
  }
  return { status: entry.status === 'found' ? 'nothing' : entry.status, site: entry.site }
}

/**
 * What an email to this recruiter may say about their company. Reads the site
 * the address points at, unless it was read recently, and never throws: when
 * anything goes wrong the email is simply written without it.
 */
export async function researchCompany(
  email: string,
  generate: GenerateFn,
  store: ResearchStore,
  deps?: FetchDeps,
  now = new Date()
): Promise<CompanyNote> {
  const domain = employerDomain(email)
  if (!domain) return { status: 'personal' }

  const stored = await store.load(domain).catch(() => null)
  if (stored) {
    const age = now.getTime() - stored.readAt.getTime()
    if (age < (stored.status === 'found' ? KEEP_FOUND_MS : KEEP_MISS_MS)) return noteFor(stored)
  }

  const site = await readCompanySite(domain, deps).catch(() => null)
  if (!site) {
    const entry = { site: domain, company: '', facts: [], status: 'unreachable' as const }
    await store.save(domain, entry).catch(() => undefined)
    return noteFor(entry)
  }

  let reply: string
  try {
    reply = await generate({
      systemInstruction: RESEARCH_SYSTEM_INSTRUCTION,
      prompt: buildResearchPrompt(site.site, site.text),
      temperature: 0,
    })
  } catch (err) {
    // Not remembered: the site was fine, the AI wasn't, and it may be back in a minute.
    console.warn(`[research] ${domain}: the AI could not read the site:`, err instanceof Error ? err.message : err)
    return { status: 'skipped' }
  }

  const { company, facts } = parseResearch(reply, site.text)
  const entry = { site: site.site, company, facts, status: facts.length > 0 ? ('found' as const) : ('nothing' as const) }
  await store.save(domain, entry).catch(() => undefined)
  return noteFor(entry)
}
