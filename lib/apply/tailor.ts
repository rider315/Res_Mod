import { AiCallError } from '@/lib/ai-errors'
import { resumeTextFromLatex } from '@/lib/cover-letter'
import { saveTailoring } from '@/lib/db/tailorings'
import { renderCheckedResume } from '@/lib/import/render'
import { standardProfile } from '@/lib/profiles/standard'
import type { ResumeDoc } from '@/lib/resume-doc'
import { GenerateFn, RunProgress, runOptimization } from '@/lib/run-optimization'
import { historyCoverage } from '@/lib/tailor/history'
import type { JdKeywords } from '@/lib/tailor/keywords'
import type { TailorLevel } from '@/lib/tailor/levels'
import { tailorStoredResume } from '@/lib/tailor/splice'
import type { AIProvider, OptimizationResult, ParsedResume } from '@/types/resume'

/**
 * Tailor a stored resume to a job and keep the copy, for the runs that have
 * nobody sitting in front of them deciding change by change.
 *
 * Two routes need exactly this — the complete application, and a recruiter email
 * asked to tailor the resume it attaches first — and they must not drift apart,
 * because both then write an email from what comes out. So it lives here once.
 *
 * The stored resume is never touched. The LaTeX is rendered fresh from the
 * stored document and the changes are spliced into that copy, which is what gets
 * saved to history and attached; the original is exactly as it was.
 *
 * Every change the run returns is applied. There is no review screen in these
 * flows, and the run has already dropped anything that would touch a fact, a
 * frozen section or a line that isn't in the resume (lib/run-optimization.ts).
 *
 * Server-only: it writes to the database.
 */

export interface TailoredForJob {
  tailoringId: string
  /** The tailored document, for the PDF that goes out. */
  latex: string
  /** Its plain text, for whatever is written from it next. */
  resumeText: string
  appliedCount: number
  keywordReport: OptimizationResult['keywordReport']
  unevidencedSkills: string[]
}

export async function tailorForJob({
  userId,
  resume,
  parsed,
  jobDescription,
  keywords,
  level,
  instructions = '',
  jobTitle,
  company,
  provider,
  model,
  generate,
  onProgress,
  deadline,
}: {
  userId: string
  resume: { id: string; title: string; doc: ResumeDoc }
  /** The stored resume, already parsed, so it isn't rendered twice. */
  parsed: ParsedResume
  jobDescription: string
  /** The job's keywords, found once and shared with whatever else reads the role. */
  keywords: JdKeywords
  level: TailorLevel
  instructions?: string
  /** What to file the copy under; the keywords' own reading when not given. */
  jobTitle?: string
  company?: string
  provider: AIProvider
  model?: string
  generate: GenerateFn
  onProgress?: (progress: RunProgress) => void
  deadline?: number
}): Promise<TailoredForJob> {
  const profile = standardProfile(level)
  const result = await runOptimization({
    mode: 'optimize',
    level,
    keywords,
    profile,
    resume: parsed,
    jobDescription,
    hardInstructions: instructions,
    softInstructions: '',
    provider,
    model,
    generate,
    onProgress,
    deadline,
  })

  const changes = result.changes.map(({ original, proposed }) => ({ original, proposed }))
  const spliced = tailorStoredResume(resume.doc, changes)
  if (!spliced.ok) throw new AiCallError(spliced.error, 'unusable')

  const skipped = new Set([...spliced.result.unmatched, ...spliced.result.rejected.map((entry) => entry.original)])
  const applied = changes.filter((change) => !skipped.has(change.original))

  const tailoringId = await saveTailoring(userId, {
    resumeId: resume.id,
    resumeTitle: resume.title,
    jobTitle: (jobTitle ?? keywords.jobTitle ?? '').trim().slice(0, 200),
    company: (company ?? keywords.company ?? '').trim().slice(0, 200),
    level,
    jobDescription,
    changes: applied,
    appliedCount: spliced.result.applied,
    coverage: historyCoverage(parsed, keywords.keywords, applied),
    latex: spliced.result.latex,
  })

  return {
    tailoringId,
    latex: spliced.result.latex,
    resumeText: resumeTextFromLatex(spliced.result.latex),
    appliedCount: spliced.result.applied,
    keywordReport: result.keywordReport,
    unevidencedSkills: result.unevidencedSkills ?? [],
  }
}

/** The stored document, checked and parsed once, for a run that will tailor it. */
export function readyToTailor(doc: ResumeDoc): { ok: true; parsed: ParsedResume } | { ok: false; problems: string } {
  const rendered = renderCheckedResume(doc)
  return rendered.ok ? { ok: true, parsed: rendered.parsed.resume } : { ok: false, problems: rendered.problems.join(' ') }
}
