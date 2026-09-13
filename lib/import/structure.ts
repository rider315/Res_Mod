import { extractJSON } from '@/lib/json-repair'
import { ResumeDoc, ResumeDocSchema } from '@/lib/resume-doc'
import type { GenerateFn } from '@/lib/run-optimization'

/**
 * Turning a resume's plain text into a ResumeDoc.
 *
 * The model is a transcriber here, not an editor. Tailoring happens later, as
 * changes the user reviews one by one, so anything the model improved or
 * invented at this step would slip into the resume unreviewed. The prompt says
 * so plainly, the reply is validated against the schema, and one retry feeds
 * the validation problems back.
 *
 * Client-safe: the server route passes its provider adapter as `generate`, and
 * the Puter path passes the browser client.
 */

export const STRUCTURE_SYSTEM_INSTRUCTION = `You convert resume text into structured JSON. You are a transcriber, not an editor.

Rules:
1. Copy wording exactly as written. Do not rephrase, shorten, improve, translate or correct anything.
2. Never add anything that is not in the text: no invented bullets, skills, dates, links or summaries. Leave a field empty when the resume has nothing for it.
3. Keep every bullet point, in its original order, as its own string. Remove only the bullet symbol.
4. Put each piece of text in exactly one field. Do not repeat content across fields.
5. Every string is plain text: no markdown, no LaTeX, no HTML.
6. Respond with only the JSON object.`

const SHAPE = `{
  "name": "<full name>",
  "contact": {
    "email": "<email>",
    "phone": "<phone>",
    "location": "<city and country>",
    "links": [{ "label": "<link text as shown>", "url": "<full URL>" }]
  },
  "summary": "<summary or objective paragraph>",
  "skills": [{ "category": "<category label, or empty>", "items": ["<one skill>"] }],
  "experience": [{
    "company": "<employer>",
    "role": "<job title>",
    "dates": "<dates as written>",
    "location": "<location>",
    "bullets": ["<one bullet>"],
    "groups": [{ "title": "<client or sub-project heading inside this job>", "bullets": ["<one bullet>"] }]
  }],
  "projects": [{ "name": "<project name>", "url": "<URL>", "stack": "<technologies listed with it>", "dates": "<dates>", "bullets": ["<one bullet>"] }],
  "education": [{ "school": "<school>", "degree": "<degree>", "dates": "<dates>", "location": "<location>", "details": ["<GPA, coursework or honours line>"] }],
  "sections": [{ "title": "<section heading>", "lines": ["<one entry>"] }]
}`

const PLACEHOLDERS = SHAPE.match(/<[^<>]+>/g) ?? []

function containsPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return PLACEHOLDERS.some((placeholder) => value.includes(placeholder))
  if (Array.isArray(value)) return value.some(containsPlaceholder)
  if (value && typeof value === 'object') return Object.values(value).some(containsPlaceholder)
  return false
}

export function buildStructurePrompt(resumeText: string, problems: string[] = []): string {
  const retry =
    problems.length > 0
      ? `\n\n## YOUR PREVIOUS ANSWER WAS REJECTED\nFix these problems and answer again:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : ''

  return `## RESUME TEXT
${resumeText}

## OUTPUT
Return one JSON object with exactly this shape. Replace each <description> with the resume's own text, or use an empty string or empty array when the resume has nothing for it:
${SHAPE}

- A job with no client or sub-project headings has an empty "groups" array. Bullets that sit under such a heading go in that group, not in "bullets".
- Anything that fits no other field (certifications, awards, publications, languages, interests, soft skills) goes in "sections".${retry}`
}

export type StructureResult = { ok: true; doc: ResumeDoc } | { ok: false; problems: string[] }

export function parseStructureResponse(responseText: string): StructureResult {
  let raw: unknown
  try {
    raw = JSON.parse(extractJSON(responseText) ?? responseText)
  } catch {
    return { ok: false, problems: ['The answer was not a valid JSON object.'] }
  }

  const parsed = ResumeDocSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '(top level)'}: ${issue.message}`),
    }
  }
  if (containsPlaceholder(parsed.data)) {
    return {
      ok: false,
      problems: [
        "Some fields contain the template's <placeholder> text instead of the resume's own text. " +
          'Use the resume text, or leave those fields empty.',
      ],
    }
  }
  return { ok: true, doc: parsed.data }
}

export async function structureResume({
  text,
  generate,
}: {
  text: string
  generate: GenerateFn
}): Promise<ResumeDoc> {
  let problems: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generate({
      systemInstruction: STRUCTURE_SYSTEM_INSTRUCTION,
      prompt: buildStructurePrompt(text, problems),
      temperature: 0,
    })
    const result = parseStructureResponse(reply)
    if (result.ok) return result.doc
    problems = result.problems
  }

  throw new Error(
    `The AI could not turn this resume into a usable structure (${problems.slice(0, 3).join('; ')}). ` +
      'Try again, or pick a different model in Settings.'
  )
}
