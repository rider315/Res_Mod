import { AIProvider, OptimizationResult, ParsedResume } from '@/types/resume'
import {
  OPTIMIZE_SYSTEM_INSTRUCTION,
  buildOptimizePrompt,
  parseOptimizeResponse,
} from '@/lib/optimizer'
import {
  REVAMP_SYSTEM_INSTRUCTION,
  buildRevampPrompt,
  parseRevampResponse,
} from '@/lib/revamper'
import { buildGapFillPrompt, findCoverageGaps, mergeChanges } from '@/lib/coverage'

/**
 * Orchestrates a full optimization run, including the coverage top-up pass.
 *
 * Client-safe by design: it takes the model call as a callback so the server
 * routes can pass their provider adapter and the browser-side Puter path can pass
 * puter.ai.chat, without either duplicating this logic.
 */

export type GenerateFn = (args: {
  systemInstruction: string
  prompt: string
  temperature: number
}) => Promise<string>

export interface RunOptions {
  mode: 'optimize' | 'revamp'
  resume: ParsedResume
  jobDescription: string
  hardInstructions: string
  softInstructions: string
  provider: AIProvider
  model?: string
  generate: GenerateFn
}

export async function runOptimization(opts: RunOptions): Promise<OptimizationResult> {
  const { mode, resume, jobDescription, hardInstructions, softInstructions, provider, model, generate } = opts
  const isRevamp = mode === 'revamp'

  const systemInstruction = isRevamp ? REVAMP_SYSTEM_INSTRUCTION : OPTIMIZE_SYSTEM_INSTRUCTION
  const prompt = isRevamp
    ? buildRevampPrompt(resume, jobDescription, hardInstructions, softInstructions)
    : buildOptimizePrompt(resume, jobDescription, hardInstructions, softInstructions)
  const temperature = isRevamp ? 0.3 : 0.2
  const parse = isRevamp ? parseRevampResponse : parseOptimizeResponse

  const firstPass = parse(await generate({ systemInstruction, prompt, temperature }), provider, model)

  // Did every experience/project section actually get its rewrites?
  const gaps = findCoverageGaps(resume, firstPass.changes)
  if (gaps.length === 0) return firstPass

  console.log(
    `[${mode}] Coverage gaps in ${gaps.length} section(s): ` +
    gaps.map((g) => `${g.sectionTitle} (${g.have}/${g.required})`).join(', ') +
    ' — running a top-up pass'
  )

  try {
    const gapPrompt = buildGapFillPrompt(jobDescription, hardInstructions, gaps, isRevamp)
    const secondPass = parse(
      await generate({ systemInstruction, prompt: gapPrompt, temperature }),
      provider,
      model
    )

    const changes = mergeChanges(firstPass.changes, secondPass.changes)
    const added = changes.length - firstPass.changes.length
    console.log(`[${mode}] Top-up pass added ${added} change(s)`)

    if (added === 0) return firstPass

    return {
      ...firstPass,
      changes,
      // Keep both passes' keyword lists so the review screen reflects everything.
      keywordsAdded: Array.from(new Set([...firstPass.keywordsAdded, ...secondPass.keywordsAdded])),
      sectionsModified: Array.from(
        new Set([...firstPass.sectionsModified, ...secondPass.sectionsModified])
      ),
    }
  } catch (err) {
    // A failed top-up must never lose the first pass's work.
    console.warn(`[${mode}] Top-up pass failed, keeping first-pass results:`, err)
    return firstPass
  }
}
