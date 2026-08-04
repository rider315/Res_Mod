/**
 * Client-safe OpenRouter constants.
 *
 * Keep this module free of server-only imports — it is pulled into the browser
 * bundle by the settings modal.
 */

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Used when the user hasn't picked a model and OPENROUTER_MODEL isn't set. */
export const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

export interface OpenRouterModelOption {
  id: string
  name: string
  /** Short note shown under the model name in the picker. */
  note: string
  free: boolean
}

/**
 * Curated shortlist shown first in the settings picker.
 *
 * The full live catalogue is fetched from /api/ai/models; this list is the
 * offline fallback and the "recommended" grouping. Every id below was verified
 * against the live catalogue and supports `response_format`, which matters
 * because the optimizer expects strict JSON back. OpenRouter retires model ids
 * fairly often — if one 404s, pick a replacement from the live list.
 */
export const RECOMMENDED_OPENROUTER_MODELS: OpenRouterModelOption[] = [
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B (free)',
    note: 'Free · 262K context · structured output — good default',
    free: true,
  },
  {
    id: 'openrouter/free',
    name: 'Free Models Router',
    note: 'Free · auto-picks an available free model — fewer rate limits',
    free: true,
  },
  {
    id: 'openai/gpt-oss-20b:free',
    name: 'gpt-oss 20B (free)',
    note: 'Free · 131K context · dependable JSON',
    free: true,
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B (free)',
    note: 'Free · 262K context',
    free: true,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    note: 'Paid · fast and cheap · 1M context',
    free: false,
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    note: 'Paid · cheap and dependable',
    free: false,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    note: 'Paid · best quality rewrites',
    free: false,
  },
]

/** True for OpenRouter ids that are served on the free tier. */
export function isFreeModel(id: string): boolean {
  return id.endsWith(':free')
}
