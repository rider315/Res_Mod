/**
 * What search engines are told about Chills.
 *
 * The structured data here is built from the same arrays the pages render, not
 * written out a second time. A page whose questions and answers drift from the
 * schema it publishes is worse than one publishing none: Google treats an answer
 * that isn't on the page as a reason to stop trusting the rest.
 *
 * Client-safe: no database, no fetch.
 */

import { supportEmail } from '@/lib/contact'

/** Where the site lives. APP_URL when set, else the production domain. */
export function siteUrl(): URL {
  try {
    return new URL(process.env.APP_URL?.trim() || 'https://chills.pro')
  } catch {
    return new URL('https://chills.pro')
  }
}

export const absolute = (path: string): string => new URL(path, siteUrl()).toString()

/** Every page a search engine should know about, and how often it changes. */
export const PUBLIC_PAGES: Array<{ path: string; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/recruiters', changeFrequency: 'daily', priority: 0.9 },
  { path: '/keyword-finder', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/shipping', changeFrequency: 'yearly', priority: 0.2 },
]

/**
 * Paths nothing should crawl: the signed-in app, which needs an account and
 * holds one person's résumés, and the API, which answers nothing useful to a
 * crawler and costs a request to say so.
 */
export const PRIVATE_PATHS = ['/dashboard', '/api/']

// ─── Structured data ─────────────────────────────────────────────────────────

/** Who publishes the site, so the name and mark can appear beside the results. */
export function organizationSchema() {
  const site = siteUrl().toString().replace(/\/$/, '')
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Chills',
    url: site,
    logo: `${site}/icon.svg`,
    description: 'Résumé tailoring and recruiter outreach for job seekers in India.',
    areaServed: 'IN',
    // Published so a search result can offer a way to write, rather than making
    // somebody find the Contact page to ask a question.
    email: supportEmail(),
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: supportEmail(),
        areaServed: 'IN',
        availableLanguage: ['en', 'hi'],
      },
    ],
  }
}

/** What the product is, and that there is a free way in. */
export function softwareSchema({ freePlanName = 'Free', priceFrom }: { freePlanName?: string; priceFrom: number }) {
  const site = siteUrl().toString().replace(/\/$/, '')
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Chills',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: site,
    description:
      'Tailor your résumé to any job description with every required ATS keyword covered, and email the recruiter from that same résumé.',
    offers: [
      { '@type': 'Offer', name: freePlanName, price: '0', priceCurrency: 'INR' },
      { '@type': 'Offer', name: 'Paid plans', price: String(priceFrom / 100), priceCurrency: 'INR' },
    ],
  }
}

/**
 * The questions and answers a page already shows. Pass the page's own array, so
 * the two can never say different things.
 */
export function faqSchema(entries: ReadonlyArray<readonly [string, string]>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map(([question, answer]) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }
}

/** A page in the site's hierarchy, so results show "Chills › Pricing" rather than a bare URL. */
export function breadcrumbSchema(trail: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: absolute(step.path),
    })),
  }
}
