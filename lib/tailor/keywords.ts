import { z } from 'zod'
import { extractJSON } from '@/lib/json-repair'
import { visible } from '@/lib/latex/match'
import { escapeLatexText } from '@/lib/latex/sanitize'
import { CoverageRules, STRUCTURAL_LINE } from '@/lib/profiles/types'
import { readLines, ResumeLine } from '@/lib/tailor/guards'
import { ParsedResume, ResumeChange } from '@/types/resume'
import type { GenerateFn } from '@/lib/run-optimization'

/**
 * The keyword guarantee: which terms a job description screens for, whether a
 * resume carries them, and a last resort that lists whatever is still missing.
 *
 * Client-safe, so the review screen can re-score the resume live as changes are
 * approved and rejected.
 */

export const KEYWORD_KINDS = [
  'skill',
  'tool',
  'domain',
  'responsibility',
  'soft_skill',
  'certification',
  'title',
] as const

const KeywordSchema = z.object({
  term: z.string().trim().min(1).max(60),
  kind: z.enum(KEYWORD_KINDS).catch('skill'),
  required: z.boolean().catch(true),
  aliases: z.array(z.string().trim().min(1).max(60)).max(4).default([]).catch([]),
})

export const JdKeywordsSchema = z.object({
  jobTitle: z.string().trim().max(120).default('').catch(''),
  company: z.string().trim().max(120).default('').catch(''),
  keywords: z.array(KeywordSchema).min(1, 'List at least one keyword.').max(40),
})

export type JdKeyword = z.infer<typeof KeywordSchema>
export type JdKeywords = z.infer<typeof JdKeywordsSchema>

// ---------------------------------------------------------------- extraction

export const KEYWORD_SYSTEM_INSTRUCTION =
  'You extract the keywords an applicant tracking system screens a job description for. Respond with only a JSON object.'

const KEYWORD_SHAPE = `{
  "jobTitle": "<the job title>",
  "company": "<the hiring company, or an empty string>",
  "keywords": [
    { "term": "<keyword exactly as the job description writes it>", "kind": "skill", "required": true, "aliases": [] }
  ]
}`

export function buildKeywordPrompt(jobDescription: string, problems: string[] = []): string {
  const retry =
    problems.length > 0
      ? `\n\n## YOUR PREVIOUS ANSWER WAS REJECTED\nFix these problems and answer again:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : ''

  return `## JOB DESCRIPTION
${jobDescription}

## TASK
List the keywords an applicant tracking system would screen applicants for.
- Copy each keyword's exact spelling from the job description ("Node.js", "CI/CD", "stakeholder management").
- 1 to 4 words each: skills, tools, platforms, methodologies, domain terms, certifications, and the job title itself.
- Skip filler most jobs list ("team player", "hard-working", "communication") unless this job clearly stresses it.
- "kind" is one of: ${KEYWORD_KINDS.join(', ')}.
- "required" is true for anything the job calls required, must-have or essential, or mentions more than once; false for nice-to-have.
- "aliases" lists other common spellings of the same thing, such as "JS" for "JavaScript" or "K8s" for "Kubernetes". Never a different technology.
- Most important first, and no more than 30.

## OUTPUT
${KEYWORD_SHAPE}${retry}`
}

export type KeywordParse = { ok: true; value: JdKeywords } | { ok: false; problems: string[] }

export function parseKeywordResponse(responseText: string): KeywordParse {
  let raw: unknown
  try {
    raw = JSON.parse(extractJSON(responseText) ?? responseText)
  } catch {
    return { ok: false, problems: ['The answer was not a valid JSON object.'] }
  }

  const parsed = JdKeywordsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.') || '(top level)'}: ${issue.message}`),
    }
  }

  const seen = new Set<string>()
  const keywords = parsed.data.keywords.filter((keyword) => {
    if (/<[^<>]+>/.test(keyword.term)) return false
    const key = compact(keyword.term)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (keywords.length === 0) {
    return {
      ok: false,
      problems: ['No usable keywords: replace the <placeholder> text with terms from the job description.'],
    }
  }
  return { ok: true, value: { ...parsed.data, keywords: keywords.slice(0, 30) } }
}

export async function extractJdKeywords({
  jobDescription,
  generate,
}: {
  jobDescription: string
  generate: GenerateFn
}): Promise<JdKeywords> {
  let problems: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generate({
      systemInstruction: KEYWORD_SYSTEM_INSTRUCTION,
      prompt: buildKeywordPrompt(jobDescription, problems),
      temperature: 0,
    })
    const result = parseKeywordResponse(reply)
    if (result.ok) return result.value
    problems = result.problems
  }
  throw new Error(
    `The AI could not pick out this job description's keywords (${problems.slice(0, 2).join('; ')}). ` +
      'Try again, or pick a different model in AI settings.'
  )
}

// ------------------------------------------------------------------ matching

/** Lowercase word tokens: "C++" and "C#" stay whole, "Node.js" becomes node + js. */
function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+[+#]*/g) ?? []
}

function compact(text: string): string {
  return tokens(text).join('')
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 3) return false
  return a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function mentionsTerm(text: string, term: string): boolean {
  const wanted = tokens(term)
  if (wanted.length === 0) return false

  // "Go", "R", "C#", "AI": too short to match loosely, or "go-to-market" would count as Go.
  if (wanted.length === 1 && wanted[0].replace(/[+#]/g, '').length <= 2) {
    return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(term.trim())}(?![A-Za-z0-9])`).test(text)
  }

  const words = tokens(text)
  // The same words in order, singular or plural: "REST APIs" for "REST API".
  outer: for (let i = 0; i + wanted.length <= words.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (!sameWord(words[i + j], wanted[j])) continue outer
    }
    return true
  }
  // Written together or apart: "NodeJS" for "Node.js", "CICD" for "CI/CD".
  const joined = wanted.join('')
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      if (sameWord(words.slice(i, i + size).join(''), joined)) return true
    }
  }
  return false
}

/** Whether `text` (plain, no LaTeX) mentions the keyword or one of its aliases. */
export function mentionsKeyword(text: string, keyword: JdKeyword): boolean {
  return [keyword.term, ...keyword.aliases].some((term) => mentionsTerm(text, term))
}

// ------------------------------------------------------------------ coverage

export type KeywordStatus = 'covered' | 'skills_only' | 'missing'

export interface CoverageSummary {
  requiredPresent: number
  requiredTotal: number
  present: number
  total: number
  /** 0–100: the share of keywords present, with required ones weighing double. */
  score: number
}

export interface KeywordCoverage extends CoverageSummary {
  statuses: Array<{ keyword: JdKeyword; status: KeywordStatus }>
}

const HEADER_SECTION_ID = 'section_header'

function isSkillsSection(title: string): boolean {
  return /skill|technolog|tools|tech stack|competenc/i.test(title) && !/soft\s*skill/i.test(title)
}

/**
 * Which keywords the resume carries once `changes` are applied. A keyword in the
 * summary, a bullet or a heading is covered; one that appears only in a skills
 * line is listed but unevidenced. Either way an ATS finds it.
 */
export function keywordCoverage(
  resume: ParsedResume,
  keywords: JdKeyword[],
  changes: ResumeChange[] = []
): KeywordCoverage {
  let body = ''
  let skills = ''
  for (const { section, current } of readLines(resume, changes)) {
    if (section.id === HEADER_SECTION_ID) continue
    const text = visible(current.replace(STRUCTURAL_LINE, '')) + '\n'
    if (isSkillsSection(section.title)) skills += text
    else body += text
  }

  const statuses = keywords.map((keyword) => {
    const status: KeywordStatus = mentionsKeyword(body, keyword)
      ? 'covered'
      : mentionsKeyword(skills, keyword)
        ? 'skills_only'
        : 'missing'
    return { keyword, status }
  })

  let requiredPresent = 0
  let requiredTotal = 0
  let present = 0
  let weighted = 0
  let weightedTotal = 0
  for (const { keyword, status } of statuses) {
    const weight = keyword.required ? 2 : 1
    weightedTotal += weight
    if (keyword.required) requiredTotal++
    if (status !== 'missing') {
      present++
      weighted += weight
      if (keyword.required) requiredPresent++
    }
  }

  return {
    statuses,
    requiredPresent,
    requiredTotal,
    present,
    total: statuses.length,
    score: weightedTotal > 0 ? Math.round((weighted / weightedTotal) * 100) : 100,
  }
}

// ------------------------------------------------------------------ fallback

const KIND_HINTS: Record<JdKeyword['kind'], RegExp> = {
  skill: /skill|language|framework|librar|technolog|tech|core|stack|competenc/i,
  tool: /tool|platform|devops|cloud|infra|database|framework|librar|stack|technolog/i,
  domain: /domain|industr|methodolog|practice|concept|core|competenc|other|additional/i,
  responsibility: /methodolog|practice|process|core|competenc|other|additional/i,
  soft_skill: /soft|interpersonal|professional|other/i,
  certification: /certif|licen/i,
  // A job title belongs in the summary, never a skills category.
  title: /(?!)/,
}

/** The "Category" of a "\textbf{Category:} item, item" line, or empty. */
function categoryLabel(line: string): string {
  const text = visible(line)
  const colon = text.indexOf(':')
  return colon > 0 && colon <= 40 ? text.slice(0, colon) : ''
}

/** Keywords that describe work a person does rather than a tool: a skills list is a poor home for them. */
const PROSE_KINDS = new Set<JdKeyword['kind']>(['responsibility', 'domain', 'soft_skill'])

/** A skills line whose category label fits the keyword's kind, if there is one. */
function labelledSkillLine(lines: ResumeLine[], keyword: JdKeyword): ResumeLine | undefined {
  const hint = KIND_HINTS[keyword.kind]
  return lines.find((line) => hint.test(categoryLabel(line.current)))
}

/** The fitting skills line, or failing that the longest one. */
function bestSkillLine(lines: ResumeLine[], keyword: JdKeyword): ResumeLine | undefined {
  if (lines.length === 0) return undefined
  return (
    labelledSkillLine(lines, keyword) ??
    lines.reduce((best, line) => (visible(line.current).length > visible(best.current).length ? line : best))
  )
}

function appendToSkillLine(current: string, keywords: JdKeyword[]): string {
  const base = current.replace(/[\s.;,]+$/, '')
  const separator = /:\s*$/.test(visible(base)) ? ' ' : ', '
  return `${base}${separator}${keywords.map((k) => escapeLatexText(k.term)).join(', ')}`
}

function appendToSummary(current: string, keywords: JdKeyword[]): string {
  const terms = (keep: (k: JdKeyword) => boolean) =>
    keywords.filter(keep).map((k) => escapeLatexText(k.term))
  const titles = terms((k) => k.kind === 'title')
  const prose = terms((k) => PROSE_KINDS.has(k.kind))
  const skills = terms((k) => k.kind !== 'title' && !PROSE_KINDS.has(k.kind))

  const sentence = [
    titles.length > 0 ? `targeting ${titles.join(' / ')} roles` : '',
    prose.length > 0 ? `experienced in ${prose.join(', ')}` : '',
    skills.length > 0 ? `key skills: ${skills.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  return `${current.replace(/[\s.;,]+$/, '')}. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

export interface KeywordFallback {
  changes: ResumeChange[]
  /** Terms written into a skills line or the summary. */
  placed: string[]
  /** Terms no line could hold: the resume has neither a skills line nor a summary. */
  unplaced: string[]
}

/**
 * The last resort behind the guarantee. Any required keyword the rewrites didn't
 * place becomes an ordinary change the user reviews: a tool or skill is appended
 * to the skills line of the closest category, while a job title, a responsibility
 * or a domain term (or any keyword in a resume without skills lines) is written
 * into the summary. The review screen marks these as listed but
 * unevidenced, because nothing in the experience backs them up.
 */
export function addMissingKeywords(
  resume: ParsedResume,
  changes: ResumeChange[],
  missing: JdKeyword[],
  rules: CoverageRules
): KeywordFallback {
  const lines = readLines(resume, changes).filter(
    ({ section, original }) =>
      section.id !== HEADER_SECTION_ID && !rules.frozenSection.test(section.title) && !STRUCTURAL_LINE.test(original)
  )
  const skillLines = lines.filter(({ section }) => isSkillsSection(section.title))
  const summaryLine = lines.find(({ section }) => /summary|profile|objective|about/i.test(section.title))

  const additions = new Map<string, { line: ResumeLine; keywords: JdKeyword[] }>()
  const placed: string[] = []
  const unplaced: string[] = []

  for (const keyword of missing) {
    const target =
      keyword.kind === 'title'
        ? summaryLine ?? bestSkillLine(skillLines, keyword)
        : PROSE_KINDS.has(keyword.kind)
          ? labelledSkillLine(skillLines, keyword) ?? summaryLine ?? bestSkillLine(skillLines, keyword)
          : bestSkillLine(skillLines, keyword) ?? summaryLine
    if (!target) {
      unplaced.push(keyword.term)
      continue
    }
    const slot = additions.get(target.original) ?? { line: target, keywords: [] }
    slot.keywords.push(keyword)
    additions.set(target.original, slot)
    placed.push(keyword.term)
  }

  const next = [...changes]
  const stamp = Date.now()
  let index = 0
  additions.forEach(({ line, keywords }) => {
    const proposed = isSkillsSection(line.section.title)
      ? appendToSkillLine(line.current, keywords)
      : appendToSummary(line.current, keywords)
    const note = `Required by the job description and not yet anywhere in the resume: ${keywords.map((k) => k.term).join(', ')}.`
    const existing = next.findIndex(
      (change) =>
        change.original.trim() === line.original.trim() ||
        visible(change.original).toLowerCase() === visible(line.original).toLowerCase()
    )
    if (existing >= 0) {
      next[existing] = { ...next[existing], proposed, reason: `${next[existing].reason} ${note}`.trim() }
    } else {
      next.push({
        id: `keywords_${index++}_${stamp}`,
        sectionId: line.section.id,
        sectionTitle: line.section.title,
        original: line.original,
        proposed,
        reason: note,
        type: 'add_keywords',
        approved: null,
      })
    }
  })

  return { changes: next, placed, unplaced }
}
