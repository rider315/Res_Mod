import { AIProvider } from '@/types/resume'
import { DEFAULT_OPENROUTER_MODEL } from '@/lib/openrouter-models'

export interface AISettings {
  provider: AIProvider
  apiKeys: Record<AIProvider, string>
  openRouterModel: string
}

const PROVIDER_KEY = 'resmod_ai_provider'
const MODEL_KEY = 'resmod_openrouter_model'
const KEY_BY_PROVIDER: Record<AIProvider, string> = {
  openrouter: 'resmod_key_openrouter',
  gemini: 'resmod_key_gemini',
  cerebras: 'resmod_key_cerebras',
}
/** Pre-multi-key storage slot — migrated into KEY_BY_PROVIDER on first load. */
const LEGACY_KEY = 'resmod_ai_api_key'

const VALID_PROVIDERS: AIProvider[] = ['openrouter', 'gemini', 'cerebras']

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openrouter',
  apiKeys: { openrouter: '', gemini: '', cerebras: '' },
  openRouterModel: DEFAULT_OPENROUTER_MODEL,
}

/**
 * Keys live in localStorage only — they are sent to our own API routes per
 * request and never persisted server-side.
 */
export function loadAISettings(): AISettings {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS

  const stored = localStorage.getItem(PROVIDER_KEY) as AIProvider | null
  const provider = stored && VALID_PROVIDERS.includes(stored) ? stored : DEFAULT_AI_SETTINGS.provider

  const apiKeys: Record<AIProvider, string> = {
    openrouter: localStorage.getItem(KEY_BY_PROVIDER.openrouter) ?? '',
    gemini: localStorage.getItem(KEY_BY_PROVIDER.gemini) ?? '',
    cerebras: localStorage.getItem(KEY_BY_PROVIDER.cerebras) ?? '',
  }

  // Migrate the old single-key slot onto whichever provider was selected.
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) {
    if (!apiKeys[provider]) {
      apiKeys[provider] = legacy
      localStorage.setItem(KEY_BY_PROVIDER[provider], legacy)
    }
    localStorage.removeItem(LEGACY_KEY)
  }

  return {
    provider,
    apiKeys,
    openRouterModel: localStorage.getItem(MODEL_KEY) || DEFAULT_OPENROUTER_MODEL,
  }
}

export function saveAISettings(settings: AISettings): void {
  if (typeof window === 'undefined') return

  localStorage.setItem(PROVIDER_KEY, settings.provider)
  localStorage.setItem(MODEL_KEY, settings.openRouterModel)
  for (const provider of VALID_PROVIDERS) {
    const value = settings.apiKeys[provider]?.trim() ?? ''
    if (value) localStorage.setItem(KEY_BY_PROVIDER[provider], value)
    else localStorage.removeItem(KEY_BY_PROVIDER[provider])
  }
}
