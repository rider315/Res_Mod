import { ResumeSection } from '@/types/resume'

/**
 * A resume profile captures everything that depends on how one particular resume
 * is laid out — and nothing else.
 *
 * The ATS objective is deliberately NOT part of a profile: every resume is
 * optimized toward the same goal (rewrite bullets to carry the job description's
 * exact keywords), so that strategy lives once in lib/prompts/ats-core.ts and
 * improving it improves both resumes.
 *
 * What differs between resumes is structural: which sections exist and what they
 * are called, which lines are frozen headings, how work history is grouped, how
 * many rewrites a section owes. Those rules live here, one file per resume, so
 * tuning one layout can never disturb the other.
 */

export type ResumeProfileId = 'gaurav' | 'himanshu'

export interface CoverageRules {
  /** Sections that must never be edited. */
  frozenSection: RegExp
  /** Sections holding work history. */
  experienceSection: RegExp
  /** Sections holding personal/side projects. */
  projectSection: RegExp
  /** Shorter lines are headings, dates or titles rather than editable bullets. */
  minBulletLength: number
  /**
   * Lines that are structural and must never be rewritten even inside an
   * editable section — client/project sub-headings, for example.
   */
  frozenLinePatterns: RegExp[]
  /** How many rewrites this section owes, given the editable bullets available. */
  requiredChanges(section: ResumeSection, bulletCount: number): number
}

export interface LengthRules {
  /** Most characters a rewrite may add. */
  maxGrowth(originalLength: number): number
  /** Fewest characters a rewrite may leave behind. */
  minLength(originalLength: number): number
}

export interface ResumeProfile {
  id: ResumeProfileId
  /** Shown in the resume picker. */
  label: string
  /**
   * Whose resume this is. Used for the exported file name and the Drive rename —
   * it must come from the profile, not the signed-in Google account, or every
   * export is named after whoever happens to be logged in.
   */
  personName: string
  /** One-line description of the layout this profile targets. */
  description: string
  /** Pre-filled document URL, so the common case needs no typing. */
  defaultDocUrl: string
  /** localStorage slot for this profile's document URL. */
  urlStorageKey: string
  /**
   * Layout-specific instructions appended to the shared ATS core: which sections
   * are frozen, which headings must not move, how this resume groups its bullets.
   */
  sectionRules: string
  /** Same, for the more aggressive full-revamp pass. */
  revampSectionRules: string
  /** Extra layout reminders appended to the per-request prompt body. */
  promptNotes: string
  coverage: CoverageRules
  length: LengthRules
}
