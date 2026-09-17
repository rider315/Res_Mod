import { ParsedResume } from '@/types/resume'
import { ResumeProfile } from '@/lib/profiles/types'
import { LEVELS, TailorLevel, TailorTone, TONES } from '@/lib/tailor/levels'
import type { JdKeyword, JdKeywords } from '@/lib/tailor/keywords'
import type { EditableLine } from '@/lib/tailor/guards'

/**
 * Prompts for tailoring a regular user's resume at a chosen level. The owner's
 * optimize and revamp prompts (lib/optimizer.ts, lib/revamper.ts) are separate
 * and unchanged.
 */

const CORE = `You are an expert resume writer. You tailor a candidate's real resume to one job description so it passes ATS keyword screening, while every claim stays true to the candidate's actual experience.

ABSOLUTE RULES
1. Never invent employers, job titles, dates, degrees, certifications, projects or metrics. Keep every number and achievement a line already has.
2. Only rewrite lines that exist. Never add or remove roles, projects, sections or bullets.
3. Each "original" is an exact, character-for-character copy of one line shown in the resume, LaTeX markup included.
4. Use the job description's exact wording for its keywords ("RESTful APIs", not "REST services") wherever the candidate's work genuinely matches.
5. When a required keyword cannot honestly be tied to real work, add it to the skills line of the matching category instead of inventing experience.
6. Return only the JSON object: no markdown fences, no commentary.`

export function buildTailorSystemInstruction(level: TailorLevel, profile: ResumeProfile, tone: TailorTone = 'balanced'): string {
  const spec = LEVELS[level]
  const voice = TONES[tone]?.style
  const toneBlock = voice
    ? `\n## TONE: ${TONES[tone].label.toUpperCase()}\n${voice} The tone changes the wording only, never the facts.\n`
    : ''
  return `${CORE}

## TAILORING LEVEL: ${spec.label.toUpperCase()}
${spec.strategy}
${toneBlock}
${profile.sectionRules}`
}

const OUTPUT_FORMAT = `## OUTPUT FORMAT
Return this exact JSON structure:
{
  "summary": "one paragraph on what you changed and why",
  "companyName": "the hiring company from the job description, or 'Company'",
  "keywordsAdded": ["every keyword you worked in"],
  "sectionsModified": ["Section Title"],
  "changes": [
    {
      "sectionId": "the section id shown above, e.g. section_2",
      "sectionTitle": "Section Title",
      "original": "the exact line from the resume, LaTeX markup included",
      "proposed": "the rewritten line as LaTeX, keywords in \\\\textbf{}, with % & _ # $ escaped as \\\\% \\\\& \\\\_ \\\\# \\\\$",
      "reason": "which keywords this carries and why it fits the job",
      "type": "rewrite|add_keywords|improve_clarity|action_verb"
    }
  ]
}`

function keywordList(keywords: JdKeyword[]): string {
  return keywords
    .map((k) => `- ${k.term}${k.aliases.length > 0 ? ` (also written ${k.aliases.join(', ')})` : ''}`)
    .join('\n')
}

function keywordBlock(keywords: JdKeyword[]): string {
  const required = keywords.filter((k) => k.required)
  const optional = keywords.filter((k) => !k.required)
  return [
    required.length > 0 ? `Required, and screened for by the ATS, so work in every one:\n${keywordList(required)}` : '',
    optional.length > 0 ? `Also valuable:\n${keywordList(optional)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function instructionsBlock(instructions: string): string {
  const text = instructions.trim()
  return text ? `\n\n## THE CANDIDATE'S INSTRUCTIONS (obey exactly)\n${text}` : ''
}

function rules(level: TailorLevel): string {
  return `## RULES
- "original" must EXACTLY match one line shown above: no paraphrasing, no trimming, no list marker.
- Never return a change for a line starting with [Role], [Project] or [Group], or for any line in Education, Certifications, Awards, Publications, Languages, Interests or the header.
- Write "proposed" as LaTeX: bold injected keywords with \\textbf{...}; escape % & _ # $ as \\% \\& \\_ \\# \\$; never markdown.
- Length: each proposed line ${LEVELS[level].lengthHint}.
- One change per line: put everything that belongs in a line into that one rewrite.`
}

export function buildTailorPrompt({
  resume,
  jobDescription,
  keywords,
  level,
  instructions,
}: {
  resume: ParsedResume
  jobDescription: string
  keywords: JdKeywords
  level: TailorLevel
  instructions: string
}): string {
  const resumeText = resume.sections
    .map((section) => `### ${section.title} [id: ${section.id}]\n${section.content.join('\n')}`)
    .join('\n\n')

  return `## RESUME
${resumeText}

## TARGET JOB DESCRIPTION
${jobDescription}

## TARGET JOB TITLE
${keywords.jobTitle || '(not stated)'}

## KEYWORDS TO COVER
${keywordBlock(keywords.keywords)}${instructionsBlock(instructions)}

${OUTPUT_FORMAT}

${rules(level)}`
}

/**
 * The keyword top-up pass: the required keywords still missing after the earlier
 * passes, and every line that may still change, as it currently reads.
 */
export function buildKeywordTopUpPrompt({
  jobDescription,
  missing,
  lines,
  level,
  instructions,
}: {
  jobDescription: string
  missing: JdKeyword[]
  lines: EditableLine[]
  level: TailorLevel
  instructions: string
}): string {
  const bySection = new Map<string, string[]>()
  for (const line of lines) {
    const heading = `### ${line.sectionTitle} [id: ${line.sectionId}]`
    bySection.set(heading, [...(bySection.get(heading) ?? []), line.text])
  }
  const available = Array.from(bySection, ([heading, texts]) => `${heading}\n${texts.join('\n')}`).join('\n\n')

  const where =
    level === 'soft'
      ? '- This is a light-touch tailoring: prefer the summary and the skills lines, and change a bullet only to add a word or two.'
      : '- Prefer a bullet or the summary wherever the real work involves the keyword; otherwise use the skills line of the matching category.'

  return `## TARGET JOB DESCRIPTION
${jobDescription}

## MISSING REQUIRED KEYWORDS
The resume still lacks these keywords, and an ATS screens for every one:
${keywordList(missing)}

## YOUR TASK
Work EVERY keyword above into the resume by rewriting lines listed below.
${where}
- Never invent experience to fit a keyword. A keyword the work cannot support goes in the skills line of its category.
- The lines below show the resume as it currently reads. Copy the line you change VERBATIM into "original".${instructionsBlock(instructions)}

## LINES YOU MAY CHANGE
${available}

${OUTPUT_FORMAT}

${rules(level)}`
}
