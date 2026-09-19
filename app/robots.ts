import type { MetadataRoute } from 'next'
import { absolute, PRIVATE_PATHS } from '@/lib/seo'

/**
 * What crawlers may read. Everything public is open; the signed-in app and the
 * API are not, because one holds a person's résumés and the other has nothing
 * to say to a crawler but costs a request to say it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS }],
    sitemap: absolute('/sitemap.xml'),
  }
}
