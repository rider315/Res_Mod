'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AIProvider } from '@/types/resume'
import { AISettings } from '@/lib/settings-storage'
import { RECOMMENDED_OPENROUTER_MODELS } from '@/lib/openrouter-models'

interface CatalogModel {
  id: string
  name: string
  contextLength: number
  free: boolean
  promptPricePerM: number
}

interface SettingsModalProps {
  settings: AISettings
  onSave: (next: AISettings) => void
  onClose: () => void
}

const PROVIDER_META: Record<
  AIProvider,
  { label: string; sub: string; badge: string; badgeClass: string; keyHint: string; keyUrl: string; placeholder: string }
> = {
  openrouter: {
    label: 'OpenRouter',
    sub: '400+ models, one key',
    badge: 'OR',
    badgeClass: 'bg-[var(--color-purple)]',
    keyHint: 'Create a key at openrouter.ai/keys — free models need no credits.',
    keyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-...',
  },
  gemini: {
    label: 'Gemini',
    sub: '2.5 Pro',
    badge: 'G',
    badgeClass: 'bg-[var(--color-blue)]',
    keyHint: 'Get a key at aistudio.google.com/apikey. Leave blank to use the server key.',
    keyUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...',
  },
  cerebras: {
    label: 'Cerebras',
    sub: 'Free & fast',
    badge: 'C',
    badgeClass: 'bg-[var(--color-warning)]',
    keyHint: 'Get a free key at cloud.cerebras.ai.',
    keyUrl: 'https://cloud.cerebras.ai',
    placeholder: 'csk-...',
  },
}

const PROVIDER_ORDER: AIProvider[] = ['openrouter', 'gemini', 'cerebras']

function formatContext(tokens: number): string {
  if (!tokens) return ''
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K ctx`
  return `${tokens} ctx`
}

function formatPrice(model: CatalogModel): string {
  if (model.free) return 'Free'
  // The offline shortlist carries no pricing data.
  if (!model.promptPricePerM) return 'Paid'
  const price = model.promptPricePerM
  return `$${price < 1 ? price.toFixed(2) : price.toFixed(1)}/M in`
}

/** The curated shortlist, shaped like catalogue entries so one renderer covers both. */
const FALLBACK_MODELS: CatalogModel[] = RECOMMENDED_OPENROUTER_MODELS.map((m) => ({
  id: m.id,
  name: m.name,
  contextLength: 0,
  free: m.free,
  promptPricePerM: 0,
}))

export default function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<AIProvider>(settings.provider)
  const [apiKeys, setApiKeys] = useState<Record<AIProvider, string>>({ ...settings.apiKeys })
  const [model, setModel] = useState(settings.openRouterModel)
  const [showKey, setShowKey] = useState(false)

  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const meta = PROVIDER_META[provider]

  // Load the live OpenRouter catalogue the first time the OpenRouter tab is shown.
  useEffect(() => {
    if (provider !== 'openrouter' || catalog) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ai/models')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data.error ?? 'Failed to load models')
        setCatalog(data.models)
      } catch (err: unknown) {
        if (cancelled) return
        setCatalogError(err instanceof Error ? err.message : String(err))
        setCatalog(FALLBACK_MODELS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, catalog])

  // Any config change invalidates the previous test result.
  useEffect(() => setTestResult(null), [provider, model, apiKeys])

  const visibleModels = useMemo(() => {
    const source = catalog ?? FALLBACK_MODELS
    const query = search.trim().toLowerCase()

    const filtered = source.filter((m) => {
      if (freeOnly && !m.free) return false
      if (!query) return true
      return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
    })

    // With no search, lead with the curated picks so the list opens on good defaults.
    if (!query) {
      const recommendedIds = new Set(RECOMMENDED_OPENROUTER_MODELS.map((m) => m.id))
      const recommended = filtered.filter((m) => recommendedIds.has(m.id))
      const rest = filtered.filter((m) => !recommendedIds.has(m.id))
      return [...recommended, ...rest].slice(0, 60)
    }
    return filtered.slice(0, 60)
  }, [catalog, search, freeOnly])

  const searchIsUnlistedId =
    search.trim().includes('/') && !visibleModels.some((m) => m.id === search.trim())

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKeys[provider], model }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Connection test failed')
      setTestResult({
        ok: true,
        message: `${data.usingServerKey ? 'Using server key. ' : ''}${data.detail ?? 'Connection OK.'}`,
      })
    } catch (err: unknown) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }, [provider, apiKeys, model])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--color-text)]">AI Provider Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5">
          {/* Provider picker */}
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text)] mb-3">Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDER_ORDER.map((p) => {
                const m = PROVIDER_META[p]
                const selected = provider === p
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                      selected
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)] ring-1 ring-[var(--color-primary)]'
                        : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full ${m.badgeClass} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white text-[10px] font-bold">{m.badge}</span>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-[var(--color-text)] leading-tight">{m.label}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">{m.sub}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* API key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-[var(--color-text)]">{meta.label} API Key</span>
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">
              {meta.keyHint}{' '}
              <a
                href={meta.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                Open ↗
              </a>
            </p>
            <input
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={meta.placeholder}
              value={apiKeys[provider]}
              onChange={(e) => setApiKeys((k) => ({ ...k, [provider]: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all font-mono"
            />
            <p className="text-[11px] text-[var(--color-text-faint)] mt-1.5">
              Stored in this browser only. Leave blank to use the server key from .env.local.
            </p>
          </div>

          {/* OpenRouter model picker */}
          {provider === 'openrouter' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-[var(--color-text)]">Model</span>
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={freeOnly}
                    onChange={(e) => setFreeOnly(e.target.checked)}
                    className="accent-[var(--color-primary)]"
                  />
                  Free only
                </label>
              </div>

              <div className="mb-2 px-3 py-2 rounded-lg bg-[var(--color-primary-highlight)] text-xs text-[var(--color-text)] font-mono break-all">
                {model}
              </div>

              <input
                type="text"
                placeholder="Search models, or paste a model id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
              />

              {catalogError && (
                <p className="text-[11px] text-[var(--color-warning)] mb-2">
                  Live model list unavailable ({catalogError}) — showing the built-in shortlist.
                </p>
              )}

              <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-divider)]">
                {!catalog && !catalogError && (
                  <p className="p-4 text-sm text-[var(--color-text-muted)]">Loading models…</p>
                )}

                {searchIsUnlistedId && (
                  <button
                    onClick={() => {
                      setModel(search.trim())
                      setSearch('')
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[var(--color-surface-offset)] transition-colors"
                  >
                    <p className="text-sm text-[var(--color-primary)] font-medium">
                      Use custom id &ldquo;{search.trim()}&rdquo;
                    </p>
                  </button>
                )}

                {visibleModels.map((m) => {
                  const selected = m.id === model
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        selected ? 'bg-[var(--color-primary-highlight)]' : 'hover:bg-[var(--color-surface-offset)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">{m.name}</p>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${
                            m.free
                              ? 'bg-[var(--color-success-highlight)] text-[var(--color-success)]'
                              : 'bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]'
                          }`}
                        >
                          {formatPrice(m)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] font-mono truncate">
                        {m.id}
                        {m.contextLength ? ` · ${formatContext(m.contextLength)}` : ''}
                      </p>
                    </button>
                  )
                })}

                {catalog && visibleModels.length === 0 && !searchIsUnlistedId && (
                  <p className="p-4 text-sm text-[var(--color-text-muted)]">No models match that search.</p>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-text-faint)] mt-1.5">
                Resume prompts are large — prefer models with 32K+ context that follow JSON instructions well.
              </p>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                testResult.ok
                  ? 'border-[var(--color-success)] bg-[var(--color-success-highlight)] text-[var(--color-success)]'
                  : 'border-[var(--color-error)] bg-[var(--color-error-highlight)] text-[var(--color-error)]'
              }`}
            >
              {testResult.ok ? '✓ ' : '✕ '}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex-1 py-3 px-4 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] font-semibold text-sm hover:bg-[var(--color-surface-offset)] disabled:opacity-50 transition-all"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <button
              onClick={() => onSave({ provider, apiKeys, openRouterModel: model })}
              className="flex-1 py-3 px-4 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm hover:bg-[var(--color-primary-hover)] transition-all"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
