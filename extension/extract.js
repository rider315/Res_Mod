/**
 * Reading a job posting off whatever page the user is standing on.
 *
 * This file is injected into the page by chrome.scripting, so it must be a
 * single self-contained function with no imports and no reliance on anything
 * the extension has loaded. It returns plain data and never touches the page.
 *
 * Three strategies, in the order they deserve to be trusted:
 *
 *   1. schema.org JobPosting in a JSON-LD tag. Greenhouse, Lever, Workday,
 *      Indeed and most company career sites publish it because Google for Jobs
 *      reads it, which makes it the one source that is both structured and
 *      maintained by the site itself.
 *   2. A selector for a board we know. Fast and exact, and certain to rot —
 *      these class names change without warning, which is why they are second
 *      and not first.
 *   3. The page's own headings and its largest block of text. Ugly, but it is
 *      the difference between "works on any careers page" and "works on four
 *      sites until they redeploy".
 *
 * Whatever comes back is shown to the user before anything is done with it, so
 * a wrong guess costs a glance, not a bad tailoring.
 */

export function readJobPosting() {
  const clean = (value) =>
    String(value ?? '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  const fromHtml = (html) => {
    const holder = document.createElement('div')
    holder.innerHTML = String(html ?? '')
    return clean(holder.textContent)
  }

  const text = (selector) => {
    const node = document.querySelector(selector)
    return node ? clean(node.innerText || node.textContent) : ''
  }

  const meta = (property) =>
    clean(document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content'))

  // ── 1. JSON-LD ────────────────────────────────────────────────────────────
  const fromJsonLd = () => {
    const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')]
    for (const node of nodes) {
      let parsed
      try {
        parsed = JSON.parse(node.textContent || '{}')
      } catch {
        continue
      }
      // A page may publish a graph, a list, or the posting on its own.
      const candidates = []
      const walk = (value, depth = 0) => {
        if (!value || depth > 4) return
        if (Array.isArray(value)) return value.forEach((entry) => walk(entry, depth + 1))
        if (typeof value !== 'object') return
        const type = value['@type']
        const types = Array.isArray(type) ? type : [type]
        if (types.includes('JobPosting')) candidates.push(value)
        if (value['@graph']) walk(value['@graph'], depth + 1)
      }
      walk(parsed)

      for (const posting of candidates) {
        const description = fromHtml(posting.description)
        if (description.length < 120) continue
        const org = posting.hiringOrganization
        const place = [].concat(posting.jobLocation ?? [])[0]?.address ?? {}
        return {
          title: clean(posting.title),
          company: clean(typeof org === 'string' ? org : org?.name),
          location: clean([place.addressLocality, place.addressRegion].filter(Boolean).join(', ')),
          description,
          how: 'json-ld',
        }
      }
    }
    return null
  }

  // ── 2. Boards we know ─────────────────────────────────────────────────────
  const ADAPTERS = [
    {
      host: /(^|\.)linkedin\.com$/,
      read: () => ({
        title: text('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .top-card-layout__title'),
        company: text(
          '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link'
        ),
        location: text('.job-details-jobs-unified-top-card__primary-description-container, .topcard__flavor--bullet'),
        description: text('#job-details, .jobs-description__content, .show-more-less-html__markup'),
      }),
    },
    {
      host: /(^|\.)naukri\.com$/,
      read: () => ({
        title: text('[class*="jd-header-title"], .jd-header-title'),
        company: text('[class*="jd-header-comp-name"], .jd-header-comp-name'),
        location: text('[class*="loc"] [class*="location"], .location'),
        description: text('[class*="dang-inner-html"], .job-desc, .dang-inner-html'),
      }),
    },
    {
      host: /(^|\.)indeed\.com$/,
      read: () => ({
        title: text('[data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title'),
        company: text('[data-testid="inlineHeader-companyName"], [data-company-name]'),
        location: text('[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"]'),
        description: text('#jobDescriptionText'),
      }),
    },
    {
      host: /(^|\.)internshala\.com$/,
      read: () => ({
        title: text('.profile, .heading_4_5'),
        company: text('.company_name, .company-name'),
        location: text('#location_names, .location_link'),
        description: text('.internship_details, .detail_view'),
      }),
    },
    {
      host: /(^|\.)wellfound\.com$/,
      read: () => ({
        title: text('h1'),
        company: text('[class*="company"] h2, [class*="companyName"]'),
        location: text('[class*="location"]'),
        description: text('[class*="JobDescription"], [data-test="JobDescription"]'),
      }),
    },
  ]

  const fromAdapter = () => {
    const adapter = ADAPTERS.find((entry) => entry.host.test(location.hostname))
    if (!adapter) return null
    const found = adapter.read()
    if (!found.description || found.description.length < 200) return null
    return { ...found, how: 'adapter' }
  }

  // ── 3. Whatever the page looks like ───────────────────────────────────────
  const fromPage = () => {
    // The biggest run of prose on the page is nearly always the posting, as
    // long as the containers wrapping it are skipped.
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'NOSCRIPT'])
    let best = { node: null, length: 0 }
    const blocks = document.querySelectorAll('article, section, main, div[class*="descri"], div[id*="descri"], div')
    for (const node of blocks) {
      if (SKIP.has(node.tagName) || node.childElementCount > 120) continue
      const own = clean(node.innerText)
      // Prefer the smallest container that still holds the whole posting.
      if (own.length > best.length && own.length < 24_000 && own.split(/\s+/).length > 120) {
        best = { node, length: own.length }
      }
    }
    const description = best.node ? clean(best.node.innerText) : ''
    if (description.length < 200) return null
    return {
      title: text('h1') || meta('og:title') || clean(document.title),
      company: meta('og:site_name') || '',
      location: '',
      description,
      how: 'page',
    }
  }

  const found = fromJsonLd() || fromAdapter() || fromPage()
  const source = (() => {
    const host = location.hostname.replace(/^www\./, '')
    for (const name of ['linkedin', 'naukri', 'indeed', 'internshala', 'wellfound', 'glassdoor', 'greenhouse', 'lever']) {
      if (host.includes(name)) return name
    }
    return 'other'
  })()

  if (!found) {
    return { ok: false, source, url: location.href, reason: 'No job posting could be read from this page.' }
  }

  return {
    ok: true,
    source,
    // The query string on a board's job link is usually tracking, and it is what
    // makes the same posting look like a different one every time it is opened.
    url: location.origin + location.pathname + (new URLSearchParams(location.search).get('currentJobId') ? location.search : ''),
    title: found.title.slice(0, 200),
    company: found.company.slice(0, 200),
    location: found.location.slice(0, 200),
    description: found.description.slice(0, 20_000),
    how: found.how,
  }
}
