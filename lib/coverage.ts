import { ParsedResume, ResumeChange, ResumeSection } from '@/types/resume'

/**
 * Per-section coverage rules.
 *
 * The prompts ask for "at least 2 bullet changes per role and per project", but
 * nothing used to check that the model complied — a run that touched one role and
 * skipped the rest was accepted silently. This module measures what actually came
 * back so the caller can request the missing edits in a focused second pass.
 */

/** Sections that must never be edited — mirrors the SECTION SKIP LIST in the prompts. */
const FROZEN_SECTION = /education|award|certificat|header|contact/i
const EXPERIENCE_SECTION = /experience|employment|work history|professional background/i
const PROJECT_SECTION = /project/i

/** Minimum rewrites the user expects in each experience/project section. */
export const REQUIRED_CHANGES_PER_SECTION = 2

/**
 * Lines shorter than this are almost always role headers, company names, dates,
 * or project titles — all frozen — rather than editable bullet text.
 */
const MIN_BULLET_LENGTH = 40

export interface CoverageGap {
  sectionId: string
  sectionTitle: string
  /** How many changes this section should have. */
  required: number
  /** How many it actually got. */
  have: number
  /** The bullet lines still available to rewrite. */
  candidateLines: string[]
}

export function isEditableSection(section: ResumeSection): boolean {
  if (FROZEN_SECTION.test(section.title)) return false
  return EXPERIENCE_SECTION.test(section.title) || PROJECT_SECTION.test(section.title)
}

/** Content lines long enough to be real bullet text rather than a heading or date. */
export function bulletLines(section: ResumeSection): string[] {
  return section.content.filter((line) => line.trim().length >= MIN_BULLET_LENGTH)
}

/**
 * Sections that came back with fewer changes than required, along with the lines
 * still available to rewrite.
 */
export function findCoverageGaps(resume: ParsedResume, changes: ResumeChange[]): CoverageGap[] {
  const gaps: CoverageGap[] = []
  const usedOriginals = new Set(changes.map((c) => c.original))

  for (const section of resume.sections) {
    if (!isEditableSection(section)) continue

    const lines = bulletLines(section)
    if (lines.length === 0) continue

    // Can't ask for more rewrites than there are bullets to rewrite.
    const required = Math.min(REQUIRED_CHANGES_PER_SECTION, lines.length)

    const have = changes.filter(
      (c) => c.sectionId === section.id || c.sectionTitle === section.title
    ).length
    if (have >= required) continue

    const candidateLines = lines.filter((line) => !usedOriginals.has(line))
    if (candidateLines.length === 0) continue

    gaps.push({
      sectionId: section.id,
      sectionTitle: section.title,
      required,
      have,
      candidateLines,
    })
  }

  return gaps
}

/**
 * A tightly scoped prompt for the follow-up pass: only the sections that came up
 * short, only the bullets not already rewritten. Keeping it small matters — this
 * runs against the same context budget as the first pass.
 */
export function buildGapFillPrompt(
  jobDescription: string,
  hardInstructions: string,
  gaps: CoverageGap[],
  withBoldKeywords: boolean
): string {
  const sectionBlocks = gaps
    .map((gap) => {
      const needed = gap.required - gap.have
      const lines = gap.candidateLines.map((l) => `- ${l}`).join('\n')
      return `### ${gap.sectionTitle} [id: ${gap.sectionId}]
You MUST return at least ${needed} more change${needed === 1 ? '' : 's'} for this section.
Available bullet lines (pick from these, copy them VERBATIM into "original"):
${lines}`
    })
    .join('\n\n')

  const boldField = withBoldKeywords
    ? ',\n      "boldKeywords": ["keyword1", "keyword2"]'
    : ''

  return `## TARGET JOB DESCRIPTION
${jobDescription}


## HARD CONSTRAINTS — You MUST obey these exactly:
${hardInstructions || 'None'}


## YOUR TASK
A previous pass under-delivered: the sections below did not get enough ATS keyword rewrites.
Rewrite the bullet points listed under each section so they DIRECTLY USE the job description's
exact keywords, tool names, and methodologies.

${sectionBlocks}


## RULES
- "original" MUST be copied VERBATIM, character-for-character, from the "Available bullet lines" above.
- Do NOT return changes for any line not listed above.
- Do NOT touch company names, role titles, dates, or project title lines.
- COMPLETELY RESTRUCTURE each bullet around the JD's terminology — do not just append a keyword.
- Preserve any metric or achievement from the original.
- Keep "proposed" within roughly 30% of the original length. Growing a bullet to fit keywords is expected;
  never shorten it by more than a third.
- Plain text only — no markdown, no asterisks.


## OUTPUT FORMAT
Return this exact JSON structure and nothing else:
{
  "summary": "what you rewrote",
  "companyName": "Company",
  "keywordsAdded": ["keyword1", "keyword2"],
  "sectionsModified": ["Section Title"],
  "changes": [
    {
      "sectionId": "the exact section id shown above",
      "sectionTitle": "the exact section title shown above",
      "original": "verbatim line copied from the list above",
      "proposed": "rewritten line using the JD's exact keywords",
      "reason": "why this improves the ATS match",
      "type": "rewrite"${boldField}
    }
  ]
}`
}

/** Merge follow-up changes in, ignoring anything that duplicates a bullet already rewritten. */
export function mergeChanges(primary: ResumeChange[], extra: ResumeChange[]): ResumeChange[] {
  const seen = new Set(primary.map((c) => c.original))
  const merged = [...primary]

  for (const change of extra) {
    if (seen.has(change.original)) continue
    seen.add(change.original)
    merged.push(change)
  }
  return merged
}
