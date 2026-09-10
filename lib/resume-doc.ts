import { z } from 'zod'

/**
 * The structured resume an imported file is turned into, and the only thing a
 * user's .tex is ever rendered from (lib/import/render.ts).
 *
 * Every field is plain text. Markup is added by the renderer, never taken from
 * here, so neither an AI transcription nor a user's edit can smuggle LaTeX into
 * the document. The limits keep a runaway model reply or a pasted novel from
 * producing a document nobody can compile.
 *
 * Client-safe: the import review screen validates edits with the same schema.
 */

const text = (max: number) => z.string().trim().max(max)
const lines = (maxItems: number, maxLength = 600) => z.array(text(maxLength)).max(maxItems).default([])

export const ResumeDocSchema = z.object({
  name: text(120).min(1, 'A resume needs a name'),
  contact: z
    .object({
      email: text(200).default(''),
      phone: text(60).default(''),
      location: text(120).default(''),
      links: z.array(z.object({ label: text(120).default(''), url: text(500) })).max(8).default([]),
    })
    .prefault({}),
  summary: text(1500).default(''),
  skills: z.array(z.object({ category: text(80).default(''), items: lines(40, 80) })).max(12).default([]),
  experience: z
    .array(
      z.object({
        company: text(160).default(''),
        role: text(160).default(''),
        dates: text(60).default(''),
        location: text(120).default(''),
        bullets: lines(20),
        /** Client engagements inside one employer, each with its own bullets. */
        groups: z.array(z.object({ title: text(200), bullets: lines(20) })).max(10).default([]),
      })
    )
    .max(20)
    .default([]),
  projects: z
    .array(
      z.object({
        name: text(160),
        url: text(500).default(''),
        stack: text(200).default(''),
        dates: text(60).default(''),
        bullets: lines(12),
      })
    )
    .max(20)
    .default([]),
  education: z
    .array(
      z.object({
        school: text(200),
        degree: text(200).default(''),
        dates: text(60).default(''),
        location: text(120).default(''),
        details: lines(8),
      })
    )
    .max(10)
    .default([]),
  /** Anything else: certifications, publications, awards, languages, soft skills. */
  sections: z.array(z.object({ title: text(80), lines: lines(20) })).max(10).default([]),
})

export type ResumeDoc = z.infer<typeof ResumeDocSchema>
