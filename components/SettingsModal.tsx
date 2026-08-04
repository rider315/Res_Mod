'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AIProvider } from '@/types/resume'
import { AISettings } from '@/lib/settings-storage'
import { getProvider, PROVIDER_ORDER } from '@/lib/providers'
import { ensurePuterSignedIn } from '@/lib/puter'

interface CatalogModel {
  id: string
  name: string
  contextLength: number
  free: boolean
  promptPricePerM: number
  maxCompletionTokens: number
}

/**
 * The optimizer's JSON response runs to a couple of thousand tokens, so anything
 * below this is at real risk of being cut off mid-object.
 */
const TRUNCATION_RISK_TOKENS = 4096

interface SettingsModalProps {
  settings: AISettings
  onSave: (next: AISettings) => void
  onClose: () => void
}

function formatContext(tokens: number): string {
  if (!tokens) return ''
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K ctx`
  return `${tokens} ctx`
}

function formatPrice(model: CatalogModel): string {
  if (model.free) return 'Free'
  if (!model.promptPricePerM) return 'Paid'
  const price = model.promptPricePerM
  return `$${price < 1 ? price.toFixed(2) : price.toFixed(1)}/M in`
}

export default function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<AIProvider>(settings.provider)
  const [apiKeys, setApiKeys] = useState<Record<AIProvider, string>>({ ...settings.apiKeys })
  const [models, setModels] = useState<Record<AIProvider, string>>({ ...settings.models })
  const [showKey, setShowKey] = useState(false)

  // Catalogues are cached per provider so switching tabs doesn't refetch.
  const [catalogs, setCatalogs] = useState<Partial<Record<AIProvider, CatalogModel[]>>>({})
  const [catalogError, setCatalogError] = useState<Partial<Record<AIProvider, string>>>({})
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [search, setSearch] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [puterStatus, setPuterStatus] = useState<string | null>(null)

  const config = getProvider(provider)
  const model = models[provider] ?? ''
  const savedKey = settings.apiKeys[provider] ?? ''

  const fallbackModels: CatalogModel[] = useMemo(
    () =>
      config.fallbackModels.map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: 0,
        free: m.free,
        promptPricePerM: 0,
        maxCompletionTokens: 0,
      })),
    [config]
  )

  const loadCatalog = useCallback(
    async (force = false) => {
      if (!config.hasModelCatalog) return
      if (!force && catalogs[provider]) return
      // Providers whose catalogue needs a key can't be listed until there is one.
      if (config.catalogNeedsKey && !apiKeys[provider]?.trim() && !force) return

      setLoadingCatalog(true)
      try {
        const res = await fetch('/api/ai/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey: apiKeys[provider] }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to load models')
        setCatalogs((c) => ({ ...c, [provider]: data.models }))
        setCatalogError((e) => ({ ...e, [provider]: undefined }))
      } catch (err: unknown) {
        setCatalogError((e) => ({
          ...e,
          [provider]: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        setLoadingCatalog(false)
      }
    },
    [config, provider, apiKeys, catalogs]
  )

  useEffect(() => {
    setSearch('')
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  // Any config change invalidates the previous test result.
  useEffect(() => setTestResult(null), [provider, model, apiKeys])

  const visibleModels = useMemo(() => {
    const source = catalogs[provider]?.length ? catalogs[provider]! : fallbackModels
    const query = search.trim().toLowerCase()

    const filtered = source.filter((m) => {
      if (freeOnly && !m.free) return false
      if (!query) return true
      return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
    })

    // With no search, lead with the curated picks so the list opens on good defaults.
    if (!query) {
      const recommended = new Set(config.fallbackModels.map((m) => m.id))
      return [
        ...filtered.filter((m) => recommended.has(m.id)),
        ...filtered.filter((m) => !recommended.has(m.id)),
      ].slice(0, 60)
    }
    return filtered.slice(0, 60)
  }, [catalogs, provider, fallbackModels, search, freeOnly, config])

  const searchIsUnlistedId =
    search.trim().length > 2 && !visibleModels.some((m) => m.id === search.trim())

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

  const handlePuterSignIn = useCallback(async () => {
    setPuterStatus('Opening Puter sign-in…')
    try {
      await ensurePuterSignedIn()
      setPuterStatus('✓ Signed in to Puter — you can run optimizations now.')
    } catch (err: unknown) {
      setPuterStatus(`✕ ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

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
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2.5">
              Active Provider
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_ORDER.map((id) => {
                const p = getProvider(id)
                const selected = provider === id
                const hasKey = Boolean(apiKeys[id]?.trim()) || !p.needsKey
                return (
                  <button
                    key={id}
                    onClick={() => setProvider(id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                      selected
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)] ring-1 ring-[var(--color-primary)]'
                        : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <span className="text-base leading-none flex-shrink-0">{p.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--color-text)] leading-tight truncate">
                        {p.label}
                      </span>
                      <span className="block text-[10px] text-[var(--color-text-muted)] leading-tight truncate">
                        {p.tagline}
                      </span>
                    </span>
                    {hasKey && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] flex-shrink-0"
                        title={p.needsKey ? 'Key set' : 'No key needed'}
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
              {config.emoji} <strong className="text-[var(--color-text)]">{config.label}</strong> — {config.freeNote}
            </p>
          </div>

          {/* API key — hidden for providers that don't use one */}
          {config.needsKey ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-[var(--color-text)]">{config.label} API Key</span>
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                {config.keyHint}{' '}
                {config.keyUrl && (
                  <a
                    href={config.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    Open ↗
                  </a>
                )}
              </p>
              <input
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder={config.keyPlaceholder}
                value={apiKeys[provider]}
                onChange={(e) => setApiKeys((k) => ({ ...k, [provider]: e.target.value }))}
                onBlur={() => config.catalogNeedsKey && apiKeys[provider]?.trim() !== savedKey && loadCatalog(true)}
                className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all font-mono"
              />
              <p className="text-[11px] text-[var(--color-text-faint)] mt-1.5">
                Stored in this browser only. Leave blank to use {config.envVar} from .env.local.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-3">
              <p className="text-xs text-[var(--color-text-muted)]">{config.keyHint}</p>
              {config.transport === 'puter' && (
                <>
                  <button
                    onClick={handlePuterSignIn}
                    className="mt-2.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-all"
                  >
                    Sign in to Puter
                  </button>
                  {puterStatus && (
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-2">{puterStatus}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-[var(--color-text)]">Model</span>
              <div className="flex items-center gap-3">
                {config.hasModelCatalog && (
                  <button
                    type="button"
                    onClick={() => loadCatalog(true)}
                    disabled={loadingCatalog}
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
                  >
                    {loadingCatalog ? 'Loading…' : 'Refresh'}
                  </button>
                )}
                {/* Only OpenRouter mixes free and paid models, so elsewhere this filters nothing. */}
                {config.pricingIsPerModel && (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={freeOnly}
                      onChange={(e) => setFreeOnly(e.target.checked)}
                      className="accent-[var(--color-primary)]"
                    />
                    Free only
                  </label>
                )}
              </div>
            </div>

            <div className="mb-2 px-3 py-2 rounded-lg bg-[var(--color-primary-highlight)] text-xs text-[var(--color-text)] font-mono break-all">
              {model || <span className="text-[var(--color-text-muted)]">Auto-select</span>}
            </div>

            <input
              type="text"
              placeholder="Search models, or paste a model id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
            />

            {catalogError[provider] && (
              <p className="text-[11px] text-[var(--color-warning)] mb-2">
                Live list unavailable ({catalogError[provider]}) — showing the built-in shortlist.
              </p>
            )}
            {!config.hasModelCatalog && (
              <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                {config.label} has no public model list — these are the models known to work.
              </p>
            )}
            {config.hasModelCatalog &&
              config.catalogNeedsKey &&
              !apiKeys[provider]?.trim() &&
              !catalogs[provider] &&
              !catalogError[provider] && (
                <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                  Add your API key above to load {config.label}&apos;s live model list.
                </p>
              )}

            <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-divider)]">
              {searchIsUnlistedId && (
                <button
                  onClick={() => {
                    setModels((m) => ({ ...m, [provider]: search.trim() }))
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
                    onClick={() => setModels((prev) => ({ ...prev, [provider]: m.id }))}
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
                    {m.maxCompletionTokens > 0 && m.maxCompletionTokens < TRUNCATION_RISK_TOKENS && (
                      <p className="text-[10px] text-[var(--color-warning)]">
                        Caps output at {m.maxCompletionTokens} tokens — long resumes may get truncated
                      </p>
                    )}
                  </button>
                )
              })}

              {visibleModels.length === 0 && !searchIsUnlistedId && (
                <p className="p-4 text-sm text-[var(--color-text-muted)]">
                  {loadingCatalog ? 'Loading models…' : 'No models match that search.'}
                </p>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-faint)] mt-1.5">
              Resume prompts are large — prefer models with 32K+ context that follow JSON instructions well.
            </p>
          </div>

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
              onClick={() => onSave({ provider, apiKeys, models })}
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
