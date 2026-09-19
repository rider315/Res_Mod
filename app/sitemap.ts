import type { MetadataRoute } from 'next'
import { absolute, PUBLIC_PAGES } from '@/lib/seo'

/**
 * The public pages, so a crawler doesn't have to find them by following links.
 * The recruiter list changes every week and says so; the policy pages barely
 * change at all and say that too.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return PUBLIC_PAGES.map((page) => ({
    url: absolute(page.path),
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
