import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/require-auth'
import { AIProvider } from '@/types/resume'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { generateAIResponse, resolveModel } from '@/lib/ai-provider'
import { GenerateFn, RunProgress, runOptimization } from '@/lib/run-optimization'
import { addCall, AiUsage, describeUsage, emptyUsage } from '@/lib/ai-usage'
import { extractJdKeywords } from '@/lib/tailor/keywords'
import { TAILOR_LEVELS } from '@/lib/tailor/levels'
import { standardProfile } from '@/lib/profiles/standard'
import { getResume } from '@/lib/db/resumes'
import { ResumeDocSchema } from '@/lib/resume-doc'
import { renderCheckedResume } from '@/lib/import/render'
import { aiFailureMessage, chooseAi } from '@/lib/billing/ai-access'
import { releaseReservation } from '@/lib/billing/store'

// Keyword extraction, the level's passes and the keyword pass are several model calls.
export const maxDuration = 300

const schema = z.object({
  jobDescription: z
    .string()
    .trim()
    .min(80, 'Paste the whole job description.')
    .max(20_000, 'That job description is longer than 20,000 characters.'),
  level: z.enum(TAILOR_LEVELS),
  /** What the candidate says must not change. */
  instructions: z.string().max(2_000).default(''),
  /** The owner's own AI settings. Everyone else always runs on ResMod AI, and these are ignored. */
  provider: z.enum(PROVIDER_ORDER as [AIProvider, ...AIProvider[]]).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  /** The owner only: run on ResMod AI instead. */
  usePlatform: z.boolean().optional(),
})

type Params = { params: { id: string } }

/**
 * Tailor one of the signed-in user's saved resumes to a job description.
 *
 * A run is several model calls and takes a minute or two, so the answer is a
 * stream of newline-delimited JSON: a progress line as each pass starts and
 * after every model call, carrying what the run has spent so far, then one
 * `result` line with the proposed changes, the job's keywords and the starting
 * coverage, plus the parsed resume so the review screen can score the approved
 * changes live. Nothing is saved: applying happens separately, and only for the
 * changes the user approves.
 *
 * Everything refused before the run starts — no session, a bad request, no runs
 * left — is still a plain JSON error with its status code.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const startedAt = Date.now()
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { jobDescription, level, instructions, provider, usePlatform } = parsed.data
  if (auth.role === 'owner' && !usePlatform && provider && getProvider(provider).clientSide) {
    return NextResponse.json({ error: 'Puter runs in the browser, not through this route.' }, { status: 400 })
  }

  let row
  try {
    row = await getResume(auth.userId, params.id)
  } catch (err) {
    console.error('[resumes/:id/tailor] load failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The resume could not be loaded right now.' }, { status: 500 })
  }
  const doc = row ? ResumeDocSchema.safeParse(row.doc) : null
  if (!doc?.success) return NextResponse.json({ error: 'Resume not found' }, { status: 404 })

  const rendered = renderCheckedResume(doc.data)
  if (!rendered.ok) return NextResponse.json({ error: rendered.problems.join(' ') }, { status: 422 })

  // Only a resume that can actually be tailored costs a run.
  const ai = await chooseAi(auth, parsed.data, 'run')
  if (!ai.ok) return ai.response

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let settled = false
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
      // A run that produced nothing isn't charged, however it ends.
      const fail = async (message: string) => {
        if (settled) return
        settled = true
        if (ai.reservation) await releaseReservation(ai.reservation)
        console.error('[resumes/:id/tailor]', message)
        send({ type: 'error', error: aiFailureMessage(auth.role, message), rateLimited: /429|rate limit/i.test(message) })
        close()
      }
      // The platform ends the request at maxDuration with no chance to give the run back, so stop just before.
      // TAILOR_TIME_LIMIT_S shortens the limit, for the local checks.
      const limitS = Number(process.env.TAILOR_TIME_LIMIT_S) || maxDuration
      const stopAt = startedAt + (limitS - 10) * 1000
      const watchdog = setTimeout(() => {
        void fail(
          `Stopped after ${Math.round((Date.now() - startedAt) / 1000)} s: the AI is too slow to finish within ` +
            `this server's ${limitS} s limit. Try a lighter level or a faster model.`
        )
      }, stopAt - Date.now())

      let usage: AiUsage = emptyUsage()
      let progress: RunProgress = { stage: 'jd', label: 'Reading the job description' }
      const tell = () => send({ type: 'progress', ...progress, usage })

      const generate: GenerateFn = ({ systemInstruction, prompt, temperature }) =>
        generateAIResponse({
          provider: ai.provider,
          apiKey: ai.apiKey,
          systemInstruction,
          prompt,
          temperature,
          model: ai.model,
          onUsage: (call) => {
            usage = addCall(usage, call)
            tell()
          },
        })

      try {
        tell()
        const keywords = await extractJdKeywords({ jobDescription, generate })
        const result = await runOptimization({
          mode: 'optimize',
          level,
          keywords,
          profile: standardProfile(level),
          resume: rendered.parsed.resume,
          jobDescription,
          hardInstructions: instructions,
          softInstructions: '',
          provider: ai.provider,
          model: resolveModel(ai.provider, ai.model),
          generate,
          onProgress: (next) => {
            progress = next
            tell()
          },
          // Leave room for one last model call to finish before the watchdog.
          deadline: stopAt - 5_000,
        })

        if (!settled) {
          settled = true
          console.log(`[resumes/:id/tailor] ${level} run on ${ai.provider}: ${describeUsage(usage)}`)
          send({ type: 'result', result, resume: rendered.parsed.resume, usage })
        }
      } catch (err) {
        await fail(err instanceof Error ? err.message : String(err))
      } finally {
        clearTimeout(watchdog)
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // Proxies that buffer would hold every progress line until the run ended.
      'X-Accel-Buffering': 'no',
    },
  })
}
