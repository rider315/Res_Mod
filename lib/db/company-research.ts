import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import type { ResearchStatus, ResearchStore } from '@/lib/outreach/company-research'

/**
 * The shared record of company sites read for recruiter emails. A failed query
 * is a miss rather than an error: an email must never fail because its
 * company notes couldn't be looked up or kept.
 */
export const researchStore: ResearchStore = {
  async load(domain) {
    try {
      const [row] = await getDb()
        .select()
        .from(schema.companyResearch)
        .where(eq(schema.companyResearch.domain, domain))
        .limit(1)
      if (!row) return null
      return {
        site: row.site,
        company: row.company,
        facts: Array.isArray(row.facts) ? row.facts.filter((fact): fact is string => typeof fact === 'string') : [],
        status: row.status as ResearchStatus,
        readAt: row.readAt,
      }
    } catch (err) {
      console.warn('[research] could not look up', domain, err instanceof Error ? err.message : err)
      return null
    }
  },

  async save(domain, entry) {
    try {
      const values = { ...entry, readAt: new Date() }
      await getDb()
        .insert(schema.companyResearch)
        .values({ domain, ...values })
        .onConflictDoUpdate({ target: schema.companyResearch.domain, set: values })
    } catch (err) {
      console.warn('[research] could not keep', domain, err instanceof Error ? err.message : err)
    }
  },
}
