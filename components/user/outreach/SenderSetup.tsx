'use client'
import { useState } from 'react'
import Working from '@/components/user/Working'
import { CheckCircle, ExternalLink, Eye, KeyIcon, Mail, Plus, Shield, Trash } from '@/components/brand/Icons'
import { cardClass, errorBox, inputClass, linkButton, primaryButton, secondaryButton, successBox } from '@/components/user/shared'
import { formatDate } from '@/components/user/billing-client'
import { LIMITS, MAIL_PROVIDER_IDS, MAIL_PROVIDERS, MailProviderId, OutreachProfile, SMTP_PORTS } from '@/lib/outreach/model'
import type { OutreachSetup } from '@/lib/outreach/types'
import { signatureLines } from '@/lib/outreach/prompt'
import { Field, Toggle } from '@/components/user/outreach/controls'
import { outreachApi } from '@/components/user/outreach/outreach-client'

/**
 * Where recruiter emails come from: the mailbox they are sent through, and how
 * they are signed. The mailbox password is sent once, checked, and stored
 * encrypted; it is never shown again.
 */

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface SenderSetupProps {
  setup: OutreachSetup
  onSetupChange: (setup: OutreachSetup) => void
}

export default function SenderSetup({ setup, onSetupChange }: SenderSetupProps) {
  return (
    <div className="grid gap-8 lg:grid-cols-2 items-start">
      <MailboxCard setup={setup} onSetupChange={onSetupChange} />
      <ProfileCard setup={setup} onSetupChange={onSetupChange} />
    </div>
  )
}

function MailboxCard({ setup, onSetupChange }: SenderSetupProps) {
  const connected = setup.mailbox
  const [editing, setEditing] = useState(!connected)
  const [provider, setProvider] = useState<MailProviderId>(connected?.provider ?? 'gmail')
  const [address, setAddress] = useState(connected?.address ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [host, setHost] = useState(connected?.provider === 'custom' ? connected.host : '')
  const [port, setPort] = useState<number>(connected?.provider === 'custom' ? connected.port : 587)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const preset = MAIL_PROVIDERS[provider]

  async function connect() {
    setBusy('connect')
    setError(null)
    setNotice(null)
    try {
      const { mailbox } = await outreachApi.connectMailbox({ provider, address, password, host, port })
      onSetupChange({ ...setup, mailbox })
      setPassword('')
      setEditing(false)
      setNotice('Connected. Chills signed in to your mailbox without sending anything.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this mailbox? Chills forgets its app password. Your drafts and sent emails stay.')) return
    setBusy('disconnect')
    setError(null)
    try {
      await outreachApi.disconnectMailbox()
      onSetupChange({ ...setup, mailbox: null })
      setEditing(true)
      setNotice('Disconnected. You can also delete the app password in your email provider’s settings.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`${cardClass} p-6 space-y-5`}>
      <div className="flex items-center gap-3">
        <span className={`nb-badge w-11 h-11 shrink-0 ${connected ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-yellow)]'}`}>
          <Mail size={22} />
        </span>
        <div>
          <h2 className="text-xl font-black leading-tight">Your mailbox</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Emails go out from your own address, so replies land in your inbox.</p>
        </div>
      </div>

      {connected && !editing && (
        <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-accent-soft)] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black flex items-center gap-2 break-all">
              <CheckCircle size={18} className="shrink-0 text-[var(--color-success)]" /> {connected.address}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {MAIL_PROVIDERS[connected.provider].label}
              {connected.provider === 'custom' ? ` · ${connected.host}:${connected.port}` : ''} · checked {formatDate(connected.verifiedAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} disabled={busy !== null} className={secondaryButton}>
              Change
            </button>
            <button onClick={disconnect} disabled={busy !== null} className={`${secondaryButton} text-[var(--color-error)]`}>
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            connect()
          }}
        >
          <Field label="Email provider">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as MailProviderId)}
              disabled={busy !== null}
              className={inputClass}
            >
              {MAIL_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {MAIL_PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-yellow-soft)] p-4 text-sm space-y-2">
            <p className="font-black flex items-center gap-2">
              <KeyIcon size={16} /> Use an app password
            </p>
            <p className="text-[var(--color-text-muted)]">{preset.help}</p>
            {'helpUrl' in preset && preset.helpUrl && (
              <a href={preset.helpUrl} target="_blank" rel="noopener noreferrer" className={`${linkButton} inline-flex items-center gap-1`}>
                Create an app password <ExternalLink size={14} />
              </a>
            )}
          </div>

          <Field label="Email address you send from">
            <input
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={busy !== null}
              autoComplete="email"
              placeholder="you@gmail.com"
              className={inputClass}
            />
          </Field>
          <Field label="App password">
            <div className="flex gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy !== null}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={provider === 'gmail' ? 'abcd efgh ijkl mnop' : 'App password'}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={secondaryButton}
                aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                aria-pressed={showPassword}
              >
                <Eye size={16} />
              </button>
            </div>
          </Field>

          {provider === 'custom' && (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label="SMTP server">
                <input value={host} onChange={(e) => setHost(e.target.value)} disabled={busy !== null} placeholder="smtp.example.com" className={inputClass} />
              </Field>
              <Field label="Port">
                <select value={port} onChange={(e) => setPort(Number(e.target.value))} disabled={busy !== null} className={inputClass}>
                  {SMTP_PORTS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                      {option === 465 ? ' (SSL)' : ' (STARTTLS)'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {busy === 'connect' && (
            <Working
              kind="mailbox"
              active={0}
              steps={['Signing in to your mailbox']}
              note="Nothing is sent. If the sign-in works, the app password is encrypted and saved."
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy !== null || !address.trim() || password.trim().length < 4 || (provider === 'custom' && !host.trim())}
              className={primaryButton}
            >
              {busy === 'connect' ? 'Signing in…' : connected ? 'Save and test' : 'Connect and test'}
            </button>
            {connected && (
              <button type="button" onClick={() => setEditing(false)} disabled={busy !== null} className={secondaryButton}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && <div className={errorBox}>{error}</div>}
      {notice && !error && <div className={successBox}>{notice}</div>}

      <ul className="space-y-2 text-xs text-[var(--color-text-muted)]">
        <li className="flex gap-2">
          <Shield size={14} className="shrink-0 mt-0.5" />
          The app password is encrypted before it’s stored and is never shown again. It is used only to send the emails you choose.
        </li>
        <li className="flex gap-2">
          <Shield size={14} className="shrink-0 mt-0.5" />
          An app password can’t change your account password, and you can delete it in your provider’s settings at any time.
        </li>
        <li className="flex gap-2">
          <Shield size={14} className="shrink-0 mt-0.5" />
          No mailbox? Every email can also be opened in Gmail or Outlook and sent from there.
        </li>
      </ul>
    </section>
  )
}

function ProfileCard({ setup, onSetupChange }: SenderSetupProps) {
  const [profile, setProfile] = useState<OutreachProfile>(setup.profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(profile) !== JSON.stringify(setup.profile)
  const preview = signatureLines(profile, setup.defaultName || 'Your name')

  const update = (patch: Partial<OutreachProfile>) => {
    setProfile({ ...profile, ...patch })
    setSaved(false)
  }
  const setLink = (index: number, patch: Partial<OutreachProfile['links'][number]>) =>
    update({ links: profile.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const cleaned = { ...profile, links: profile.links.filter((link) => link.url.trim()) }
      const result = await outreachApi.saveProfile(cleaned)
      setProfile(result.profile)
      onSetupChange({ ...setup, profile: result.profile })
      setSaved(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`${cardClass} p-6 space-y-5`}>
      <div>
        <h2 className="text-xl font-black leading-tight">Signature and preferences</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Added to every email exactly as you type it here.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" hint="Blank uses the name on the resume.">
          <input
            value={profile.senderName}
            onChange={(e) => update({ senderName: e.target.value })}
            maxLength={80}
            placeholder={setup.defaultName}
            className={inputClass}
          />
        </Field>
        <Field label="Phone" optional>
          <input value={profile.phone} onChange={(e) => update({ phone: e.target.value })} maxLength={40} placeholder="+91 98765 43210" className={inputClass} />
        </Field>
      </div>

      <div className="space-y-2">
        <span className="block text-sm font-bold">Links</span>
        {profile.links.map((link, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={link.label}
              onChange={(e) => setLink(index, { label: e.target.value })}
              maxLength={40}
              placeholder="LinkedIn"
              aria-label="Link name"
              className={`${inputClass} w-32 shrink-0`}
            />
            <input
              value={link.url}
              onChange={(e) => setLink(index, { url: e.target.value })}
              maxLength={300}
              placeholder="https://linkedin.com/in/you"
              aria-label="Link address"
              className={inputClass}
            />
            <button
              onClick={() => update({ links: profile.links.filter((_, i) => i !== index) })}
              className={secondaryButton}
              aria-label="Remove this link"
            >
              <Trash size={15} />
            </button>
          </div>
        ))}
        {profile.links.length < LIMITS.links && (
          <button
            onClick={() => update({ links: [...profile.links, { label: profile.links.length === 0 ? 'LinkedIn' : '', url: '' }] })}
            className={`${linkButton} inline-flex items-center gap-1`}
          >
            <Plus size={14} /> Add a link
          </button>
        )}
      </div>

      <div className="rounded-[10px] border-[1.6px] border-dashed border-[var(--color-ink)] bg-[var(--color-bg)] p-4">
        <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Signature preview</p>
        <p className="text-sm whitespace-pre-line leading-relaxed">{['Best regards,', ...preview].join('\n')}</p>
      </div>

      <Field label="Availability" optional hint="Mentioned in every email, such as “Can join immediately” or “30 days’ notice”.">
        <input value={profile.availability} onChange={(e) => update({ availability: e.target.value })} maxLength={120} className={inputClass} />
      </Field>
      <Field
        label="Always mention"
        optional
        hint={`Facts every email should work in, such as your current role or a project to highlight. ${profile.highlights.length}/${LIMITS.highlights}`}
      >
        <textarea
          rows={3}
          value={profile.highlights}
          onChange={(e) => update({ highlights: e.target.value })}
          maxLength={LIMITS.highlights}
          placeholder="Currently a software engineer at Northwind; led the move to Kubernetes."
          className={`${inputClass} resize-y`}
        />
      </Field>
      <Toggle
        checked={profile.trackOpens}
        onChange={(trackOpens) => update({ trackOpens })}
        label="Tell me when an email is opened"
        description="Adds a tiny invisible image to each email. Some mail apps load images on their own, so treat “Opened” as a hint, not proof."
      />

      {error && <div className={errorBox}>{error}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty} className={primaryButton}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && !dirty && <span className="text-sm font-semibold text-[var(--color-success)]">Saved</span>}
      </div>
    </section>
  )
}
