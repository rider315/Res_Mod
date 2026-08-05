import { OptimizationResult, ParsedResume, ResumeChange } from '@/types/resume'
import { CoverageRules } from '@/lib/profiles/types'
import { isEditableSection } from '@/lib/coverage'

/**
 * Skills claimed without evidence.
 *
 * The optimizer is allowed to add JD-required skills to the Skills line. Left
 * unchecked that produces the worst possible resume: a recruiter reads "RAG,
 * Vector Data, Cloud Deployment" in the skills list, scans the experience, finds
 * only banking payments work, and stops trusting the document.
 *
 * A real run on Himanshu's resume against an Agentic-AI job description added
 * exactly those four terms to Skills and supported none of them in a single
 * bullet. This module finds newly-claimed skills that no experience or project
 * bullet backs up, so the caller can either work them into a bullet where the
 * underlying work genuinely supports it, or drop the claim.
 */

/** Split a skills line into individual terms, dropping any "Label:" prefix. */
export function splitSkillTerms(line: string): string[] {
  const withoutLabel = line.replace(/^[^:]{0,40}:\s*/, '')
  return withoutLabel
    .split(/[,;]/)
    .map((t) => t.replace(/\.$/, '').trim())
    .filter((t) => t.length >= 2)
}

function isSkillsSection(title: string): boolean {
  return /skill|technolog|tools/i.test(title) && !/soft\s*skill/i.test(title)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word-ish containment, so "RAG" doesn't match "leveraging". */
export function mentions(text: string, term: string): boolean {
  const t = term.trim()
  if (!t) return false
  // Terms starting with a word character get a leading boundary; symbols (C++) don't.
  const prefix = /^\w/.test(t) ? '\\b' : ''
  return new RegExp(prefix + escapeRegExp(t), 'i').test(text)
}

export interface EvidenceGap {
  /** The skill term now claimed on the skills line. */
  term: string
  /** Bullets that could plausibly carry it, for the follow-up prompt. */
  candidateLines: string[]
}

/**
 * Terms this optimization ADDED to the skills line that no experience or project
 * bullet mentions. Pre-existing skills are left alone — the goal is to hold the
 * tool's own additions to account, not to police the original resume.
 */
export function findUnevidencedSkills(
  resume: ParsedResume,
  changes: ResumeChange[],
  rules: CoverageRules
): EvidenceGap[] {
  const skillChanges = changes.filter((c) => isSkillsSection(c.sectionTitle))
  if (skillChanges.length === 0) return []

  const addedTerms: string[] = []
  for (const change of skillChanges) {
    const before = splitSkillTerms(change.original)
    for (const term of splitSkillTerms(change.proposed)) {
      const isNew = !before.some((b) => b.toLowerCase() === term.toLowerCase())
      if (isNew) addedTerms.push(term)
    }
  }
  if (addedTerms.length === 0) return []

  // Everything a reader would see in the experience/project sections after the
  // rewrites are applied.
  const rewritten = new Map(changes.map((c) => [c.original, c.proposed]))
  const evidenceLines: string[] = []
  for (const section of resume.sections) {
    if (!isEditableSection(section, rules)) continue
    for (const line of section.content) {
      evidenceLines.push(rewritten.get(line) ?? line)
    }
  }
  const evidenceText = evidenceLines.join('\n')

  const candidateLines = evidenceLines.filter(
    (line) => line.trim().length >= rules.minBulletLength &&
      !rules.frozenLinePatterns.some((p) => p.test(line))
  )

  const seen = new Set<string>()
  const gaps: EvidenceGap[] = []
  for (const term of addedTerms) {
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (mentions(evidenceText, term)) continue
    gaps.push({ term, candidateLines })
  }
  return gaps
}

/**
 * Ask the model to back the claimed skills with real bullets — or to say plainly
 * that it can't. Fabricating experience is worse than an unmatched keyword, so
 * the instruction has to make the opt-out explicit and easy.
 */
export function buildEvidencePrompt(
  jobDescription: string,
  gaps: EvidenceGap[],
  withBoldKeywords: boolean,
  profileNotes = ''
): string {
  const terms = gaps.map((g) => `- ${g.term}`).join('\n')
  const lines = gaps[0]?.candidateLines.map((l) => `- ${l}`).join('\n') ?? ''
  const boldField = withBoldKeywords ? ',\n      "boldKeywords": ["keyword1"]' : ''

  return `## TARGET JOB DESCRIPTION
${jobDescription}


## THE PROBLEM
These skills are now claimed on the resume's skills line, but NO experience or project
bullet mentions them. A recruiter reading the skills list and then the experience will
see the mismatch immediately, and the resume loses credibility:

${terms}


## YOUR TASK
For each term above, rewrite ONE bullet from the list below so the bullet genuinely
demonstrates that skill — but ONLY where the work described can honestly support it.

**Honesty comes first.** If a term cannot be tied to work that actually happened, DO NOT
invent a project, tool, or responsibility to justify it. Leave it out and list it under
"unsupported" instead. An unmatched keyword costs far less than a claim the candidate
cannot defend in an interview.

Good: the bullet already describes model training, and the term is "output evaluation" —
reframe the existing evaluation work using the JD's phrase.
Bad: the bullet describes SQL tuning and the term is "LLM orchestration" — unrelated.
Say it is unsupported.

Available bullet lines (copy VERBATIM into "original"):
${lines}
${profileNotes ? '\n\n' + profileNotes : ''}


## RULES
- "original" MUST be copied VERBATIM from the list above.
- Never touch company names, role titles, dates, or project/client title lines.
- Keep "proposed" within roughly 30% of the original length.
- Preserve any metric or achievement already in the bullet.
- Plain text only — no markdown, no asterisks.


## OUTPUT FORMAT
Return this exact JSON structure and nothing else:
{
  "summary": "which skills you evidenced",
  "companyName": "Company",
  "keywordsAdded": ["term you successfully evidenced"],
  "sectionsModified": ["Section Title"],
  "unsupported": ["term that cannot be honestly evidenced by this resume"],
  "changes": [
    {
      "sectionId": "the section id of the bullet you rewrote",
      "sectionTitle": "the section title of the bullet you rewrote",
      "original": "verbatim line copied from the list above",
      "proposed": "rewritten line that genuinely demonstrates the skill",
      "reason": "which claimed skill this now evidences",
      "type": "add_keywords"${boldField}
    }
  ]
}`
}

/** Terms still unevidenced after the follow-up pass, for honest reporting. */
export function remainingUnevidenced(
  result: OptimizationResult,
  resume: ParsedResume,
  rules: CoverageRules
): string[] {
  return findUnevidencedSkills(resume, result.changes, rules).map((g) => g.term)
}
