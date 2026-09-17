import type { Posting } from '@/lib/apply/job-source'
import type { ScoredKeyword } from '@/lib/tailor/keyword-finder'

/**
 * One reading of the role, shared by everything a Premium run produces.
 *
 * The point of the combined run is that the resume and the email agree. They do
 * because they are built from this single object: the posting's own text, the
 * role and company taken from it, and the keywords found in it once. Nothing
 * downstream re-reads the posting or asks the model what the job is, so the two
 * halves can't drift apart or contradict each other.
 */
export interface RoleAnalysis {
  /** The posting the run is about, exactly as it was read. */
  posting: Posting
  /** The role, from the posting's structured data, its title, or the recruiter's own words. */
  title: string
  company: string
  location: string
  /** What the posting screens for, scored once and used by both the tailoring and the email. */
  keywords: ScoredKeyword[]
}

/** The strongest requirements, for the email to speak to. The resume covers all of them. */
export function leadKeywords(analysis: Pick<RoleAnalysis, 'keywords'>, count = 6): string[] {
  return analysis.keywords
    .filter((keyword) => keyword.required)
    .slice(0, count)
    .map((keyword) => keyword.term)
}

/**
 * The role and company for a run. The posting's own structured data is trusted
 * first, then what the keyword pass read out of its text, then what the user
 * typed, and only then the recruiter's company — so the run is described by the
 * employer's words wherever the employer gave any.
 */
export function describeRole(
  posting: Posting,
  recruiter: { company: string },
  read: { jobTitle?: string; company?: string } = {},
  typedTitle = ''
): Pick<RoleAnalysis, 'title' | 'company' | 'location'> {
  const pick = (...values: Array<string | undefined>) => values.map((v) => (v ?? '').trim()).find(Boolean) ?? ''
  return {
    title: pick(posting.structured ? posting.title : '', read.jobTitle, posting.title, typedTitle).slice(0, 160),
    company: pick(posting.company, read.company, recruiter.company).slice(0, 160),
    location: posting.location.trim().slice(0, 160),
  }
}

/** "Platform Engineer at Northwind Labs", for the run's own heading. */
export function roleLabel(role: Pick<RoleAnalysis, 'title' | 'company'>): string {
  if (role.title && role.company) return `${role.title} at ${role.company}`
  return role.title || role.company || 'this role'
}
