import { ResumeSection } from '@/types/resume'

/**
 * A resume profile captures everything that depends on how one particular resume
 * is laid out — and nothing else.
 *
 * The ATS objective is deliberately NOT part of a profile: every resume is
 * optimized toward the same goal (rewrite bullets to carry the job description's
 * exact keywords), so that strategy lives once in the shared prompt core and
 * improving it improves both resumes.
 *
 * What differs between resumes is structural: which sections exist and what they
 * are called, which lines are frozen headings, how work history is grouped, how
 * many rewrites a section owes. Those rules live here, one file per resume, so
 * tuning one layout can never disturb the other.
 */

export type ResumeProfileId = 'gaurav' | 'himanshu'

/**
 * Structural lines the LaTeX parser emits for context — an employer line, a
 * project title, a client sub-heading. They exist so the model knows which role
 * a bullet belongs to, and they are frozen everywhere: rewriting one would
 * invent an employer, a client or a project that does not exist.
 */
export const STRUCTURAL_LINE = /^\s*\[(Role|Project|Group)\]/

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
   * Whose resume this is. Used for the exported file name — it must come from
   * the profile, not the signed-in Google account, or every export is named
   * after whoever happens to be logged in.
   */
  personName: string
  /** One-line description of the layout this profile targets. */
  description: string
  /**
   * The LaTeX resume for this person, as a file name inside resumes/.
   * This file is the source of truth; the app reads it and never writes to it.
   */
  texFile: string
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

/**
 * The LaTeX contract, shared by both resumes.
 *
 * Content lines handed to the model are the raw source of a macro argument, so
 * rewrites come back as LaTeX too. Saying so explicitly is what lets the model
 * bold a keyword properly instead of emitting markdown asterisks that would show
 * up literally in the PDF.
 */
export const LATEX_RULES = `## LATEX FORMAT RULES (this resume is LaTeX source, not plain text):
- Every line you are shown is the exact contents of one LaTeX macro argument. Your "original" MUST be copied from it verbatim, and your "proposed" MUST be valid LaTeX for the same slot.
- **Bold the job description's keywords** by wrapping them: \\textbf{Kubernetes}. This is how keywords are emphasised in this resume — do it for the terms you inject.
- The ONLY macros you may use are: \\textbf{...}, \\textit{...}, \\emph{...}, \\underline{...}, \\texttt{...}, \\href{url}{label}. Any other backslash command will cause the change to be rejected.
- **Escape these characters** or the document will not compile: % must be written \\%, & must be \\&, _ must be \\_, # must be \\#. So "cut latency by 40%" must be written "cut latency by 40\\%".
- Every { must have a matching }. An unbalanced brace rejects the change.
- Do NOT use markdown. Asterisks, backticks and underscores are not formatting here — \\textbf{} is.
- Do NOT wrap your text in a macro like \\resumeItem{...}; supply only what goes *inside* the braces.

## FROZEN STRUCTURAL LINES:
- Lines beginning with [Role], [Project] or [Group] are employer lines, project titles and client sub-headings. They are shown ONLY so you know which job or project a bullet belongs to.
- NEVER return a change whose "original" starts with [Role], [Project] or [Group]. Those changes are discarded, and rewriting them would fabricate an employer or client.`
