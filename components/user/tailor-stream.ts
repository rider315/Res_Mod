import { readRunStream } from '@/components/user/run-stream'
import { AiUsage, emptyUsage } from '@/lib/ai-usage'
import { RunStage } from '@/lib/run-optimization'
import { OptimizationResult, ParsedResume } from '@/types/resume'

/** A tailoring run as it happens. The reading itself is shared (run-stream.ts). */

export interface RunUpdate {
  stage: RunStage
  label: string
  usage: AiUsage
}

export interface RunOutcome {
  result: OptimizationResult
  resume: ParsedResume
  usage: AiUsage
}

export async function readTailorStream(res: Response, onUpdate: (update: RunUpdate) => void): Promise<RunOutcome> {
  return readRunStream<RunOutcome>({
    res,
    whatFailed: 'Tailoring failed.',
    onUpdate: (update) => onUpdate({ ...update, stage: update.stage as RunStage }),
    readResult: (event) => ({
      result: event.result as OptimizationResult,
      resume: event.resume as ParsedResume,
      usage: (event.usage as AiUsage) ?? emptyUsage(),
    }),
  })
}
