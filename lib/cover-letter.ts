import { z } from 'zod'
import { extractJSON } from '@/lib/json-repair'
import { AiCallError } from '@/lib/ai-errors'
import { visible } from '@/lib/latex/match'
import { parseLatexResume } from '@/lib/latex/parse'
import { escapeLatexText } from '@/lib/latex/sanitize'
import type { GenerateFn } from '@/lib/run-optimization'

/**
 * Cover letters written from a tailored resume: the prompt, a check of the
 * model's answer, the letter as text, and the letter as a printable LaTeX page.
 *
 * Client-safe: the owner's Puter setting writes letters in the browser.
 */

/**
 * A tailored resume's text, section by section, for the letter prompt. The
 * header is left out: the name is given separately, and contact details have no
 * place in a letter's body.
 */
export function resumeTextFromLatex(latex: string): string {
  const { resume } = parseLatexResume(latex, 'resume')
  return resume.sections
    .filter((section) => section.id !== 'section_header')
    .map((section) => {
      const lines = section.content
        .map((line) =>
          visible(line.replace(/^\s*\[(Role|Project|Group)\]\s*/, ''))
            // Formatting commands with no braces, such as \scshape, have no text of their own.
            .replace(/\\[a-zA-Z]+\s*/g, '')
            .trim()
        )
        .filter(Boolean)
      return lines.length > 0 ? `## ${section.title}\n${lines.map((line) => `- ${line}`).join('\n')}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export const COVER_LETTER_TONES = ['professional', 'warm', 'direct', 'enthusiastic'] as const
export type CoverLetterTone = (typeof COVER_LETTER_TONES)[number]

export const COVER_LETTER_LENGTHS = ['short', 'standard'] as const
export type CoverLetterLength = (typeof COVER_LETTER_LENGTHS)[number]

/** Letters that can be written, or rewritten, for one tailored copy. */
export const MAX_COVER_LETTERS_PER_TAILORING = 3

/** The longest letter kept, once edited. */
export const MAX_COVER_LETTER_CHARS = 8_000

export const TONE_LABELS: Record<CoverLetterTone, { label: string; hint: string }> = {
  professional: { label: 'Professional', hint: 'Polished and measured' },
  warm: { label: 'Warm', hint: 'Friendly and personal' },
  direct: { label: 'Direct', hint: 'Short sentences, straight to the point' },
  enthusiastic: { label: 'Enthusiastic', hint: 'Energetic about the role' },
}

/** How each tone reads, as told to the model. Recruiter emails use the same tones (lib/outreach/prompt.ts). */
export const TONE_RULES: Record<CoverLetterTone, string> = {
  professional: 'Polished, confident and measured. No slang, no exclamation marks.',
  warm: 'Friendly and personal, as if writing to someone the candidate would like to work with, while staying professional.',
  direct: 'Plain and to the point: short sentences, no filler, every sentence carrying a fact or a reason.',
  enthusiastic: 'Energetic and genuinely keen on this role and company, without hype or exaggeration.',
}

const LENGTH_RULES: Record<CoverLetterLength, string> = {
  short: '3 paragraphs, about 170 to 220 words in all.',
  standard: '4 paragraphs, about 280 to 360 words in all.',
}

export const COVER_LETTER_SYSTEM_INSTRUCTION =
  'You write cover letters for job applications, using only facts from the candidate\'s resume. Respond with only a JSON object.'

export interface CoverLetterInput {
  /** The tailored resume, as plain text. */
  resumeText: string
  jobDescription: string
  jobTitle: string
  company: string
  candidateName: string
  tone: CoverLetterTone
  length: CoverLetterLength
  /** Who to address it to, when the candidate knows. */
  recipient?: string
  /** Anything the candidate wants mentioned. */
  notes?: string
}

export function buildCoverLetterPrompt(input: CoverLetterInput, problems: string[] = []): string {
  const role = [input.jobTitle && `Job title: ${input.jobTitle}`, input.company && `Company: ${input.company}`]
    .filter(Boolean)
    .join('\n')
  const retry =
    problems.length > 0
      ? `\n\n## YOUR PREVIOUS ANSWER WAS REJECTED\nFix these problems and answer again:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : ''

  return `Write a cover letter for ${input.candidateName || 'the candidate'}.

## THE CANDIDATE'S RESUME (already tailored to this job)
${input.resumeText.slice(0, 12_000)}

## THE JOB DESCRIPTION
${input.jobDescription.slice(0, 12_000)}

## THE ROLE
${role || 'Take the job title and company from the job description.'}

## HOW TO WRITE IT
- Tone: ${TONE_RULES[input.tone]}
- Length: ${LENGTH_RULES[input.length]}
- Address it to ${input.recipient?.trim() ? `"${input.recipient.trim()}"` : 'the hiring manager'}.
- Open with the role and one specific reason the candidate fits it.
- In the middle, give two or three concrete achievements from the resume that match what the job asks for most, using the job's own wording for its key skills where it fits naturally.
- Close with a short, confident line about talking further.
- Use only facts that are in the resume: never invent employers, job titles, dates, numbers, degrees, skills or tools.
- Never use placeholders such as [Company] or [Your Name]. If the company isn't known, write around it.
- Plain sentences only: no markdown, no bullet points, no headings, no address block, no date.${
    input.notes?.trim() ? `\n- The candidate asks you to include: ${input.notes.trim().slice(0, 600)}` : ''
  }

## OUTPUT FORMAT
{
  "greeting": "Dear Hiring Manager,",
  "paragraphs": ["<first paragraph>", "<second paragraph>"],
  "closing": "Kind regards,"
}${retry}`
}

const LetterSchema = z.object({
  greeting: z.string().trim().min(3).max(120),
  paragraphs: z.array(z.string().trim().min(30).max(1500)).min(2).max(6),
  closing: z.string().trim().min(3).max(60),
})

export type CoverLetterParse = { ok: true; greeting: string; paragraphs: string[]; closing: string } | { ok: false; problems: string[] }

const PLACEHOLDER = /\[[^\]]{2,40}\]|\{\{|<[A-Za-z ]{3,30}>/

/** Text a model left a fill-in-the-blank in, such as "[Company]" or "<Your Name>". */
export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text)
}

export function parseCoverLetterResponse(responseText: string): CoverLetterParse {
  let raw: unknown
  try {
    raw = JSON.parse(extractJSON(responseText) ?? responseText)
  } catch {
    return { ok: false, problems: ['The answer was not valid JSON in the format shown.'] }
  }
  const parsed = LetterSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'letter'}: ${issue.message}`) }
  }
  const { greeting, paragraphs, closing } = parsed.data
  const text = [greeting, ...paragraphs, closing].join('\n')
  if (hasPlaceholder(text)) {
    return { ok: false, problems: ['Remove the placeholders in square or angle brackets and write real text instead.'] }
  }
  return {
    ok: true,
    greeting,
    // Markdown the model slipped in reads as stray symbols in a letter.
    paragraphs: paragraphs.map((p) => p.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim()),
    closing,
  }
}

/** The letter as the candidate edits and sends it. */
export function composeLetter(parts: { greeting: string; paragraphs: string[]; closing: string }, candidateName: string): string {
  return [parts.greeting, ...parts.paragraphs, `${parts.closing}\n${candidateName}`.trim()].join('\n\n')
}

export async function writeCoverLetter({ input, generate }: { input: CoverLetterInput; generate: GenerateFn }): Promise<string> {
  let problems: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generate({
      systemInstruction: COVER_LETTER_SYSTEM_INSTRUCTION,
      prompt: buildCoverLetterPrompt(input, problems),
      temperature: 0.6,
    })
    const result = parseCoverLetterResponse(reply)
    if (result.ok) return composeLetter(result, input.candidateName)
    problems = result.problems
  }
  throw new AiCallError(`The AI could not write a usable cover letter (${problems.slice(0, 2).join('; ')}). Try again.`, 'unusable')
}

export interface LetterHeader {
  name: string
  /** Email, phone and location, each shown when present. */
  contact: string[]
  date: string
}

/** The letter as a one-page LaTeX document. Every piece of text is escaped. */
export function coverLetterLatex(header: LetterHeader, body: string): string {
  const paragraphs = body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => escapeLatexText(line))
        .filter(Boolean)
        .join('\\\\\n')
    )
    .filter(Boolean)
  const contact = header.contact.map((part) => escapeLatexText(part)).filter(Boolean).join(' \\quad{}$\\cdot$\\quad{} ')

  return `\\documentclass[11pt]{article}
\\usepackage[a4paper,margin=2.2cm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{parskip}
\\pagestyle{empty}
\\begin{document}
{\\LARGE\\bfseries ${escapeLatexText(header.name) || 'Cover letter'}}\\par
${contact ? `{\\small ${contact}}\\par` : ''}
\\vspace{14pt}
${escapeLatexText(header.date)}\\par
\\vspace{10pt}
${paragraphs.join('\n\n')}
\\end{document}
`
}
