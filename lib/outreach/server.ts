import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AIProvider } from '@/types/resume'
import { requireAuth } from '@/lib/require-auth'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse } from '@/lib/ai-provider'
import type { CallUsage } from '@/lib/ai-usage'
import type { GenerateFn } from '@/lib/run-optimization'
import { ensureUser, getResume } from '@/lib/db/resumes'
import { getTailoring } from '@/lib/db/tailorings'
import { renderResumeLatex } from '@/lib/import/render'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { resumeTextFromLatex } from '@/lib/cover-letter'
import type { EmailSource } from '@/lib/outreach/types'

/** Pieces every Outreach route shares. Server-only. */

export function fail(status: number, error: string, code?: string): NextResponse {
  return NextResponse.json(code ? { error, code } : { error }, { status })
}

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request'
}

/** The owner's own AI settings, sent with AI requests. Everyone else runs on Chills AI and these are ignored. */
export const OwnerAiFields = {
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
}

export const EmailSourceSchema = z
  .object({ kind: z.enum(['resume', 'tailoring']), id: z.string().uuid() })
  .nullable()

/**
 * A signed-in account with a row to hang outreach data off. The row is made on
 * first use, as an account can add recruiters before it has imported anything.
 */
export async function requireOutreachAccount() {
  const auth = await requireAuth()
  if (!auth.ok) return auth
  if (!auth.userId) return { ok: false as const, response: fail(401, 'Not authenticated') }
  try {
    await ensureUser({ id: auth.userId, email: auth.email, name: auth.userName || null })
  } catch (err) {
    console.error('[outreach] could not load the account:', err instanceof Error ? err.message : err)
    return { ok: false as const, response: fail(503, 'Your account couldn’t be loaded just now. Try again in a moment.') }
  }
  return auth
}

/** Puter only runs in a browser, so the server can't write emails with it. */
export function puterRefusal(role: string, provider: AIProvider | undefined): NextResponse | null {
  if (role === 'owner' && provider && getProvider(provider).clientSide) {
    return fail(400, 'Puter runs in the browser, so it can’t write emails here. Pick another provider in AI settings.')
  }
  return null
}

/**
 * `cachePrefix` has to be passed on, not dropped: it is the opening the caller
 * has taken out of every prompt so a provider can cache it, and a generator that
 * quietly leaves it behind sends prompts with the job description missing.
 */
export function generatorFor(
  ai: { provider: AIProvider; apiKey: string; model: string | undefined },
  onUsage?: (usage: CallUsage) => void
): GenerateFn {
  return ({ systemInstruction, prompt, temperature, cachePrefix }) =>
    generateAIResponse({
      provider: ai.provider,
      apiKey: ai.apiKey,
      systemInstruction,
      prompt,
      temperature,
      cachePrefix,
      model: ai.model,
      onUsage,
    })
}

export interface ResolvedSource {
  source: NonNullable<EmailSource>
  /** The name on the resume. */
  candidateName: string
  /** The document an email attaches, as LaTeX. */
  latex: string
  resumeText: string
  /** From a tailored copy: the job it was tailored to. */
  job: { title: string; company: string; description: string } | null
}

/** What an email is written from and attaches, loaded for this account. Null when it is gone. */
export async function resolveSource(userId: string, source: EmailSource): Promise<ResolvedSource | null> {
  if (!source) return null
  if (source.kind === 'tailoring') {
    const tailoring = await getTailoring(userId, source.id)
    if (!tailoring) return null
    let candidateName = tailoring.resumeTitle
    if (tailoring.resumeId) {
      const row = await getResume(userId, tailoring.resumeId).catch(() => null)
      const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
      if (doc?.success) candidateName = doc.data.name
    }
    return {
      source,
      candidateName,
      latex: tailoring.latex,
      resumeText: resumeTextFromLatex(tailoring.latex),
      job: { title: tailoring.jobTitle, company: tailoring.company, description: tailoring.jobDescription },
    }
  }
  const row = await getResume(userId, source.id)
  const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
  if (!doc?.success) return null
  const latex = renderResumeLatex(doc.data)
  return { source, candidateName: doc.data.name, latex, resumeText: resumeTextFromLatex(latex), job: null }
}
