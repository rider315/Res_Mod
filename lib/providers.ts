import { AIProvider } from '@/types/resume'

/**
 * Client-safe provider registry.
 *
 * Keep this module free of server-only imports — it is pulled into the browser
 * bundle by the settings modal and by the Puter client-side path.
 */

export interface ModelOption {
  id: string
  name: string
  note: string
  free: boolean
}

export interface ProviderConfig {
  id: AIProvider
  label: string
  tagline: string
  emoji: string
  /** How requests are made. 'openai' covers every OpenAI-compatible REST API. */
  transport: 'openai' | 'gemini' | 'puter'
  /** Root of the OpenAI-compatible API, without a trailing slash. */
  baseUrl?: string
  /** Server-side env var checked when the user hasn't set a key in Settings. */
  envVar?: string
  needsKey: boolean
  keyUrl?: string
  keyPlaceholder?: string
  keyHint: string
  /** The whole exchange happens in the browser — no server round trip. */
  clientSide?: boolean
  defaultModel: string
  /** Offline shortlist; the live catalogue is preferred when reachable. */
  fallbackModels: ModelOption[]
  /** Provider exposes GET {baseUrl}/models. */
  hasModelCatalog: boolean
  /** That catalogue endpoint requires the API key. */
  catalogNeedsKey: boolean
  /** Cap for max_tokens. Omitted means "don't send max_tokens at all". */
  maxOutputTokens?: number
  /**
   * True when free vs paid is decided per model (OpenRouter). Everywhere else
   * it's a property of your account tier, so per-model list prices would be
   * misleading — SambaNova, for instance, publishes prices but hands out a free
   * tier with rate limits.
   */
  pricingIsPerModel?: boolean
  /** Squeeze the prompt before sending — for providers with small context windows. */
  compressPrompt?: boolean
  /** One-line note about what the free tier gives you. */
  freeNote: string
}

// Model shortlists below were verified against each provider's live catalogue.
// They are fallbacks only — the settings picker fetches the real list at runtime,
// because every provider retires model ids sooner or later.

export const PROVIDERS: Record<AIProvider, ProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: '400+ models, one key',
    emoji: '🌐',
    transport: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: 'Create a key at openrouter.ai/keys — ":free" models cost nothing.',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    hasModelCatalog: true,
    catalogNeedsKey: false,
    maxOutputTokens: 8192,
    pricingIsPerModel: true,
    freeNote: 'Many models are free; paid ones need credits.',
    fallbackModels: [
      {
        id: 'nvidia/nemotron-3-super-120b-a12b:free',
        name: 'Nemotron 3 Super 120B (free)',
        note: '262K context · structured output',
        free: true,
      },
      {
        id: 'openrouter/free',
        name: 'Free Models Router',
        note: 'Auto-picks an available free model',
        free: true,
      },
      { id: 'openai/gpt-oss-20b:free', name: 'gpt-oss 20B (free)', note: '131K context', free: true },
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', note: '262K context', free: true },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', note: 'Paid · 1M context', free: false },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', note: 'Paid · best quality', free: false },
    ],
  },

  puter: {
    id: 'puter',
    label: 'Puter',
    tagline: 'No API key needed',
    emoji: '☁️',
    transport: 'puter',
    needsKey: false,
    clientSide: true,
    keyUrl: 'https://puter.com',
    keyHint:
      'No key required. Runs in your browser via puter.js — you sign in to Puter once and usage bills to your own Puter account.',
    defaultModel: 'gpt-5-nano',
    hasModelCatalog: false,
    catalogNeedsKey: false,
    maxOutputTokens: 8192,
    freeNote: 'Free allowance per Puter account, then user-pays.',
    fallbackModels: [
      { id: 'gpt-5-nano', name: 'GPT-5 nano', note: "Puter's default · fast", free: true },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', note: 'Better quality rewrites', free: true },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', note: 'Strong instruction following', free: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', note: 'Large context', free: true },
    ],
  },

  sambanova: {
    id: 'sambanova',
    label: 'SambaNova',
    tagline: 'Fast open models',
    emoji: '🚀',
    transport: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    envVar: 'SAMBANOVA_API_KEY',
    needsKey: true,
    keyUrl: 'https://cloud.sambanova.ai',
    keyPlaceholder: 'sk-...',
    keyHint: 'Get a free key at cloud.sambanova.ai.',
    defaultModel: 'DeepSeek-V3.1',
    hasModelCatalog: true,
    catalogNeedsKey: false,
    // Several SambaNova models cap completions well below 8K, so stay conservative.
    maxOutputTokens: 4096,
    freeNote: 'Free tier with rate limits.',
    fallbackModels: [
      { id: 'DeepSeek-V3.1', name: 'DeepSeek V3.1', note: '131K context · strong JSON', free: true },
      { id: 'gpt-oss-120b', name: 'gpt-oss 120B', note: '131K context', free: true },
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', note: '196K context', free: true },
      { id: 'gemma-4-31B-it', name: 'Gemma 4 31B', note: '131K context', free: true },
      {
        id: 'Meta-Llama-3.3-70B-Instruct',
        name: 'Llama 3.3 70B',
        note: 'Short completion cap — may truncate',
        free: true,
      },
    ],
  },

  groq: {
    id: 'groq',
    label: 'Groq',
    tagline: 'Fastest free tier',
    emoji: '⚡',
    transport: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Free key at console.groq.com/keys — no credit card.',
    defaultModel: 'llama-3.3-70b-versatile',
    hasModelCatalog: true,
    catalogNeedsKey: true,
    maxOutputTokens: 8192,
    freeNote: 'Free tier: generous daily request limits.',
    fallbackModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', note: 'Best free quality', free: true },
      { id: 'openai/gpt-oss-120b', name: 'gpt-oss 120B', note: 'Strong reasoning', free: true },
      { id: 'openai/gpt-oss-20b', name: 'gpt-oss 20B', note: 'Faster, lighter', free: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', note: 'Highest rate limits', free: true },
      { id: 'qwen3-32b', name: 'Qwen3 32B', note: 'Good structured output', free: true },
    ],
  },

  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    tagline: 'Free & fast',
    emoji: '🧠',
    transport: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    envVar: 'CEREBRAS_API_KEY',
    needsKey: true,
    keyUrl: 'https://cloud.cerebras.ai',
    keyPlaceholder: 'csk-...',
    keyHint: 'Free key at cloud.cerebras.ai.',
    defaultModel: '',
    hasModelCatalog: true,
    catalogNeedsKey: true,
    maxOutputTokens: 8192,
    // Cerebras free-tier models have tight token-per-minute limits.
    compressPrompt: true,
    freeNote: 'Free tier with strict per-minute token limits.',
    fallbackModels: [
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', note: 'Best free quality', free: true },
      { id: 'llama3.1-8b', name: 'Llama 3.1 8B', note: 'Fastest', free: true },
      { id: 'qwen-3-32b', name: 'Qwen 3 32B', note: 'Good structured output', free: true },
    ],
  },

  mistral: {
    id: 'mistral',
    label: 'Mistral',
    tagline: 'European models',
    emoji: '🌬️',
    transport: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    envVar: 'MISTRAL_API_KEY',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyPlaceholder: '...',
    keyHint: 'Free experiment tier at console.mistral.ai/api-keys.',
    defaultModel: 'mistral-large-latest',
    hasModelCatalog: true,
    catalogNeedsKey: true,
    maxOutputTokens: 8192,
    freeNote: 'Free "Experiment" tier after phone verification.',
    fallbackModels: [
      { id: 'mistral-large-latest', name: 'Mistral Large', note: 'Best quality', free: true },
      { id: 'mistral-small-latest', name: 'Mistral Small', note: 'Faster, cheaper', free: true },
      { id: 'open-mistral-nemo', name: 'Mistral Nemo', note: 'Lightweight open model', free: true },
    ],
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini',
    tagline: 'Google AI Studio',
    emoji: '✨',
    transport: 'gemini',
    envVar: 'GEMINI_API_KEY',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
    keyHint: 'Free key at aistudio.google.com/apikey.',
    defaultModel: 'gemini-2.5-pro',
    hasModelCatalog: true,
    catalogNeedsKey: true,
    maxOutputTokens: 8192,
    freeNote: 'Free tier with daily request limits.',
    fallbackModels: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', note: 'Best quality', free: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', note: 'Faster, higher limits', free: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', note: 'Fastest', free: true },
    ],
  },

  ollama: {
    id: 'ollama',
    label: 'Ollama',
    tagline: 'Local, unlimited',
    emoji: '🖥️',
    transport: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    keyHint:
      'No key needed. Install Ollama, run "ollama pull llama3.1", and models on this machine appear below.',
    defaultModel: 'llama3.1',
    hasModelCatalog: true,
    catalogNeedsKey: false,
    maxOutputTokens: 8192,
    freeNote: 'Completely free — runs on your own machine.',
    fallbackModels: [
      { id: 'llama3.1', name: 'Llama 3.1 8B', note: 'ollama pull llama3.1', free: true },
      { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', note: 'ollama pull qwen2.5:14b', free: true },
      { id: 'mistral-nemo', name: 'Mistral Nemo', note: 'ollama pull mistral-nemo', free: true },
    ],
  },
}

/** Display order in the settings picker. */
export const PROVIDER_ORDER: AIProvider[] = [
  'openrouter',
  'gemini',
  'sambanova',
  'puter',
  'cerebras',
  'groq',
  'mistral',
  'ollama',
]

export const DEFAULT_PROVIDER: AIProvider = 'openrouter'

export function getProvider(id: AIProvider): ProviderConfig {
  return PROVIDERS[id] ?? PROVIDERS[DEFAULT_PROVIDER]
}

export function isValidProvider(id: string): id is AIProvider {
  return id in PROVIDERS
}

/** Starting model for every provider, used to seed settings state. */
export function defaultModels(): Record<AIProvider, string> {
  return PROVIDER_ORDER.reduce(
    (acc, id) => {
      acc[id] = PROVIDERS[id].defaultModel
      return acc
    },
    {} as Record<AIProvider, string>
  )
}

/** Empty key slots for every provider. */
export function emptyKeys(): Record<AIProvider, string> {
  return PROVIDER_ORDER.reduce(
    (acc, id) => {
      acc[id] = ''
      return acc
    },
    {} as Record<AIProvider, string>
  )
}
