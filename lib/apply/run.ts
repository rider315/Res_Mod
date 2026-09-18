import type { OutreachProfile } from '@/lib/outreach/model'
import type { OutreachEmailInput } from '@/lib/outreach/prompt'
import type { CoverLetterTone } from '@/lib/cover-letter'
import type { GenerateFn } from '@/lib/run-optimization'
import { describeRole, leadKeywords, RoleAnalysis } from '@/lib/apply/role'
import type { Posting } from '@/lib/apply/job-source'
import { extractJdKeywords, JdKeywords } from '@/lib/tailor/keywords'
import { scoreKeywords } from '@/lib/tailor/keyword-finder'

/**
 * One complete application, from the employer's own posting.
 *
 * The whole point of the combined run is that the resume and the email agree,
 * and they agree because both are built from one reading: the posting is fetched
 * once, its keywords are found once, and everything downstream works from that
 * single RoleAnalysis. Nothing here asks the model what the job is a second
 * time, so the two halves cannot drift apart or contradict each other — which is
 * exactly what happens when someone tailors a resume, then writes the email an
 * hour later from memory.
 *
 * Client-safe: it takes the model call as a callback, and never fetches. Reading
 * the posting happens in lib/apply/job-source.ts, on the server.
 */

/** The passes an application goes through, in the order the user sees them. */
export type ApplyStage = 'posting' | 'role' | 'tailor' | 'email' | 'saving' | 'done'

export const APPLY_STAGES: Array<{ stage: ApplyStage; label: string }> = [
  { stage: 'posting', label: 'Reading the job posting' },
  { stage: 'role', label: 'Working out what the role screens for' },
  { stage: 'tailor', label: 'Tailoring your resume to it' },
  { stage: 'email', label: 'Writing the recruiter email from that same reading' },
  { stage: 'saving', label: 'Saving the tailored copy and the draft' },
]

export const applyStageLabel = (stage: ApplyStage): string =>
  APPLY_STAGES.find((entry) => entry.stage === stage)?.label ?? 'Working'

/**
 * Read the role once: the posting's keywords, then the title, company and
 * location from whichever source actually knows them (lib/apply/role.ts).
 */
export async function analyseRole({
  posting,
  recruiter,
  typedTitle = '',
  generate,
}: {
  posting: Posting
  recruiter: { company: string }
  /** What the user typed, used only where the posting and the model both say nothing. */
  typedTitle?: string
  generate: GenerateFn
}): Promise<{ analysis: RoleAnalysis; keywords: JdKeywords }> {
  const keywords = await extractJdKeywords({ jobDescription: posting.text, generate })
  return {
    analysis: {
      posting,
      ...describeRole(posting, recruiter, keywords, typedTitle),
      keywords: scoreKeywords(posting.text, keywords.keywords),
    },
    keywords,
  }
}

/**
 * What the email is written from. The resume it quotes is the tailored one, not
 * the original, so an achievement the run reworded is described the same way in
 * both — and the keywords it leads on are the ones the posting screens for
 * hardest, which the resume has just been rebuilt around.
 */
export function applicationEmailInput({
  analysis,
  candidateName,
  tailoredResumeText,
  recruiter,
  profile,
  tone,
  notes = '',
  attachResume,
  about = null,
}: {
  analysis: RoleAnalysis
  candidateName: string
  tailoredResumeText: string
  recruiter: { name: string; company: string; title: string }
  profile: Pick<OutreachProfile, 'availability' | 'highlights'>
  tone: CoverLetterTone
  notes?: string
  attachResume: boolean
  about?: { site: string; facts: string[] } | null
}): OutreachEmailInput {
  const lead = leadKeywords(analysis)
  return {
    candidateName,
    resumeText: tailoredResumeText,
    recruiter,
    jobTitle: analysis.title,
    company: analysis.company,
    jobDescription: analysis.posting.text,
    tone,
    availability: profile.availability,
    highlights: [
      profile.highlights,
      notes,
      // Said plainly, because the email and the resume have to name the same things.
      lead.length > 0 ? `This role screens hardest for: ${lead.join(', ')}. The attached resume was tailored to it.` : '',
    ]
      .filter((part) => part.trim())
      .join('\n'),
    attachResume,
    about,
  }
}

/** "Platform Engineer at Northwind Labs, from their careers page" — what the run was about, for the log and the history. */
export function applicationLabel(analysis: RoleAnalysis): string {
  const role = [analysis.title, analysis.company && `at ${analysis.company}`].filter(Boolean).join(' ')
  const where = analysis.posting.url ? new URL(analysis.posting.url).hostname.replace(/^www\./, '') : 'a pasted posting'
  return `${role || 'this role'}, from ${where}`
}
