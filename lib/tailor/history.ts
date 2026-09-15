import { labelSections } from '@/lib/tailor/guards'
import { CoverageSummary, JdKeyword, keywordCoverage } from '@/lib/tailor/keywords'
import { ParsedResume, ResumeChange } from '@/types/resume'

/**
 * The keyword score kept with a tailored copy in the history: where the resume
 * started, and where the changes that were actually applied took it.
 *
 * Client-safe and pure, so it can be tested on its own.
 */

export interface HistoryCoverage {
  before: CoverageSummary
  after: CoverageSummary
}

const summarize = ({ requiredPresent, requiredTotal, present, total, score }: CoverageSummary): CoverageSummary => ({
  requiredPresent,
  requiredTotal,
  present,
  total,
  score,
})

export function historyCoverage(
  resume: ParsedResume,
  keywords: JdKeyword[],
  applied: Array<{ original: string; proposed: string }>
): HistoryCoverage | null {
  if (keywords.length === 0) return null
  const changes: ResumeChange[] = labelSections(
    resume,
    applied.map(({ original, proposed }, i) => ({
      id: `history_${i}`,
      sectionId: '',
      sectionTitle: '',
      original,
      proposed,
      reason: '',
      type: 'rewrite',
      approved: true,
    }))
  )
  return {
    before: summarize(keywordCoverage(resume, keywords)),
    after: summarize(keywordCoverage(resume, keywords, changes)),
  }
}
