'use client'
import { useEffect, useRef, useState } from 'react'
import { AIProvider } from '@/types/resume'
import { getProvider } from '@/lib/providers'
import type { PlatformAiStatus } from '@/lib/billing/types'

/**
 * The owner's control for Chills AI, inside AI settings: make the provider, model
 * and key picked above the AI that every regular account runs on, or switch it
 * off. A key goes to the server once, is checked, is stored encrypted, and is
 * never sent back.
 */

/** Fired on the window when Chills AI is switched on, changed or turned off, so the owner's header can update. */
export const PLATFORM_AI_CHANGED = 'resmod:platform-ai-changed'

interface PlatformAiSectionProps {
  provider: AIProvider
  model: string
  apiKey: string
  /** Scroll to this section and mark it, when AI settings were opened to set it up. */
  focus?: boolean
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function PlatformAiSection({ provider, model, apiKey, focus = false }: PlatformAiSectionProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<PlatformAiStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'off' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const config = getProvider(provider)
  const modelLabel = model ? ` · ${model.split('/').pop()}` : ''

  useEffect(() => {
    const section = sectionRef.current
    if (!focus || !section) return
    const show = () => section.scrollIntoView({ block: 'start' })
    show()

    // The model list above this can finish loading after the dialog opens and push this section out of
    // view, so follow it for a moment, and stop as soon as the owner scrolls for themselves.
    const above = section.previousElementSibling
    const scroller = section.parentElement
    const observer = new ResizeObserver(show)
    if (above) observer.observe(above)
    const stop = () => observer.disconnect()
    const timer = setTimeout(stop, 4000)
    scroller?.addEventListener('wheel', stop, { once: true })
    scroller?.addEventListener('touchstart', stop, { once: true })
    return () => {
      clearTimeout(timer)
      stop()
      scroller?.removeEventListener('wheel', stop)
      scroller?.removeEventListener('touchstart', stop)
    }
  }, [focus])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/platform-ai', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Chills AI could not be loaded.')
        if (!cancelled) setStatus(data)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function send(method: 'PUT' | 'DELETE') {
    if (
      method === 'DELETE' &&
      !window.confirm("Turn off Chills AI? Users won't be able to import or tailor, and buying plans switches off.")
    ) {
      return
    }
    setBusy(method === 'PUT' ? 'save' : 'off')
    setMessage(null)
    try {
      const res = await fetch('/api/admin/platform-ai', {
        method,
        headers: method === 'PUT' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'PUT' ? JSON.stringify({ provider, model, apiKey }) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'That did not work.')
      setStatus(data)
      window.dispatchEvent(new Event(PLATFORM_AI_CHANGED))
      setMessage({
        ok: true,
        text:
          method === 'PUT'
            ? `Your users now run on ${config.label}${modelLabel}.`
            : "Chills AI is off: users can't import or tailor, and plans can't be bought.",
      })
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  const current = status?.current
  const currentProvider = current ? getProvider(current.provider) : null

  return (
    <section
      ref={sectionRef}
      className={`mt-6 pt-5 border-t-[1.6px] border-[var(--color-ink)] space-y-3 ${
        focus ? 'rounded-[10px] ring-2 ring-[var(--color-warning)] ring-offset-4 ring-offset-[var(--color-surface)] px-1' : ''
      }`}
    >
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Chills AI for your users</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Every other account imports and tailors on this model; they have no AI settings of their own. Their
          tailorings come from their free ones, Pro or credits. Until it&apos;s set, they can&apos;t import or tailor, and
          plans can&apos;t be bought.
        </p>
      </div>

      <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface-offset)] p-3 text-xs space-y-1">
        {loadError ? (
          <p className="text-[var(--color-error)]">{loadError}</p>
        ) : !status ? (
          <p className="text-[var(--color-text-muted)]">Loading…</p>
        ) : current && currentProvider ? (
          <p className="text-[var(--color-text-muted)]">
            Now:{' '}
            <span className="font-medium text-[var(--color-text)]">
              {currentProvider.emoji} {currentProvider.label}
              {current.model ? ` · ${current.model}` : ''} ·{' '}
              {current.keySource === 'saved' ? `saved key …${current.keyHint ?? ''}` : currentProvider.needsKey ? `server ${currentProvider.envVar}` : 'no key needed'}
            </span>
          </p>
        ) : (
          <p className="text-[var(--color-text-muted)]">
            Now: <span className="font-medium text-[var(--color-text)]">off</span>
          </p>
        )}
        {status && current && !status.working && (
          <p className="text-[var(--color-warning)]">
            This can&apos;t run: its key is missing, or was saved before NEXTAUTH_SECRET changed. Save it again.
          </p>
        )}
        {status?.overriddenByEnv && (
          <p className="text-[var(--color-warning)]">
            PLATFORM_AI_* variables are set on this server, so they are used instead of this setting.
          </p>
        )}
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>{message.text}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => send('PUT')}
          disabled={busy !== null || config.clientSide}
          className="py-2 px-3 rounded-[10px] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-all"
        >
          {busy === 'save' ? 'Checking the key…' : `Use ${config.label}${modelLabel} for Chills AI`}
        </button>
        {current && (
          <button
            onClick={() => send('DELETE')}
            disabled={busy !== null}
            className="py-2 px-3 rounded-[10px] border-[1.6px] border-[var(--color-ink)] text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] disabled:opacity-50 transition-all"
          >
            {busy === 'off' ? 'Turning off…' : 'Turn off'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)]">
        {config.clientSide
          ? `${config.label} runs in each person's browser, so it can't power Chills AI. Pick another provider above.`
          : config.needsKey
            ? `Uses the ${config.label} key above${config.envVar ? `, or this server's ${config.envVar} if that field is blank` : ''}. The key is checked first, then stored encrypted.`
            : 'This provider needs no key.'}
      </p>
    </section>
  )
}
