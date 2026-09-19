import type { MetadataRoute } from 'next'
import { absolute, PUBLIC_PAGES } from '@/lib/seo'
import { publishedWeeks } from '@/lib/db/directory'

/**
 * The public pages, so a crawler doesn't have to find them by following links.
 * The recruiter list changes every week and says so; the policy pages barely
 * change at all and say that too.
 *
 * Every published week is its own entry. That is the point of splitting them:
 * a crawler sees a publication adding pages rather than one page that keeps
 * being edited. A database it can't reach leaves the fixed pages in the sitemap
 * rather than serving none.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const fixed = PUBLIC_PAGES.map((page) => ({
    url: absolute(page.path),
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))

  let weeks: MetadataRoute.Sitemap = []
  try {
    weeks = (await publishedWeeks()).map((week) => ({
      url: absolute(`/recruiters/week/${week.batch}`),
      // A past week's contacts are still taken from, so the page keeps changing
      // for a while and then settles.
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))
  } catch (err) {
    console.warn('[sitemap] the published weeks could not be read:', err instanceof Error ? err.message : err)
  }

  return [...fixed, ...weeks]
}
