import { AIProvider } from '@/types/resume'
import { DEFAULT_PROVIDER, defaultModels, emptyKeys, isValidProvider, PROVIDER_ORDER } from '@/lib/providers'

export interface AISettings {
  provider: AIProvider
  apiKeys: Record<AIProvider, string>
  models: Record<AIProvider, string>
}

const PROVIDER_KEY = 'resmod_ai_provider'
const keySlot = (provider: AIProvider) => `resmod_key_${provider}`
const modelSlot = (provider: AIProvider) => `resmod_model_${provider}`

/** Storage slots from earlier versions, migrated on first load. */
const LEGACY_SINGLE_KEY = 'resmod_ai_api_key'
const LEGACY_OPENROUTER_MODEL = 'resmod_openrouter_model'

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: DEFAULT_PROVIDER,
  apiKeys: emptyKeys(),
  models: defaultModels(),
}

/**
 * Keys live in localStorage only — they are sent to our own API routes per
 * request and never persisted server-side.
 */
export function loadAISettings(): AISettings {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS

  const stored = localStorage.getItem(PROVIDER_KEY)
  const provider = stored && isValidProvider(stored) ? stored : DEFAULT_PROVIDER

  const apiKeys = emptyKeys()
  const models = defaultModels()
  for (const id of PROVIDER_ORDER) {
    apiKeys[id] = localStorage.getItem(keySlot(id)) ?? ''
    models[id] = localStorage.getItem(modelSlot(id)) || models[id]
  }

  // Migrate the old single-key slot onto whichever provider was selected.
  const legacyKey = localStorage.getItem(LEGACY_SINGLE_KEY)
  if (legacyKey) {
    if (!apiKeys[provider]) {
      apiKeys[provider] = legacyKey
      localStorage.setItem(keySlot(provider), legacyKey)
    }
    localStorage.removeItem(LEGACY_SINGLE_KEY)
  }

  // Migrate the OpenRouter-only model slot.
  const legacyModel = localStorage.getItem(LEGACY_OPENROUTER_MODEL)
  if (legacyModel) {
    if (!localStorage.getItem(modelSlot('openrouter'))) {
      models.openrouter = legacyModel
      localStorage.setItem(modelSlot('openrouter'), legacyModel)
    }
    localStorage.removeItem(LEGACY_OPENROUTER_MODEL)
  }

  return { provider, apiKeys, models }
}

export function saveAISettings(settings: AISettings): void {
  if (typeof window === 'undefined') return

  localStorage.setItem(PROVIDER_KEY, settings.provider)
  for (const id of PROVIDER_ORDER) {
    const key = settings.apiKeys[id]?.trim() ?? ''
    if (key) localStorage.setItem(keySlot(id), key)
    else localStorage.removeItem(keySlot(id))

    const model = settings.models[id]?.trim() ?? ''
    if (model) localStorage.setItem(modelSlot(id), model)
    else localStorage.removeItem(modelSlot(id))
  }
}
