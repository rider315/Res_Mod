'use client'
import { ReactNode, useState } from 'react'
import Working from '@/components/user/Working'
import LatexPreview from '@/components/LatexPreview'
import { ArrowLeft } from '@/components/brand/Icons'
import { ResumeDoc, ResumeDocSchema, SourceFormat } from '@/lib/resume-doc'
import {
  backLinkClass,
  downloadBlob,
  downloadResumePdf,
  errorBox,
  inputClass,
  primaryButton,
  resumeFileBase,
  ResumeSummary,
  secondaryButton,
} from '@/components/user/shared'

/**
 * Checking and editing a structured resume.
 *
 * The form keeps list fields as raw text (one bullet per line, skills separated
 * by commas) so typing a new line or a comma behaves normally; it becomes a
 * ResumeDoc only when saved. The server re-validates and renders the LaTeX, so
 * nothing typed here reaches the document without being escaped.
 */

interface JobForm {
  company: string
  role: string
  dates: string
  location: string
  bullets: string
  groups: { title: string; bullets: string }[]
}

interface ResumeForm {
  title: string
  name: string
  email: string
  phone: string
  location: string
  links: { label: string; url: string }[]
  summary: string
  skills: { category: string; items: string }[]
  experience: JobForm[]
  projects: { name: string; url: string; stack: string; dates: string; bullets: string }[]
  education: { school: string; degree: string; dates: string; location: string; details: string }[]
  sections: { title: string; lines: string }[]
}

const splitLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)
const splitItems = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
const hasText = (...values: string[]) => values.some((value) => value.trim().length > 0)

function toForm(doc: ResumeDoc, title: string): ResumeForm {
  return {
    title,
    name: doc.name,
    email: doc.contact.email,
    phone: doc.contact.phone,
    location: doc.contact.location,
    links: doc.contact.links.map((link) => ({ label: link.label, url: link.url })),
    summary: doc.summary,
    skills: doc.skills.map((skill) => ({ category: skill.category, items: skill.items.join(', ') })),
    experience: doc.experience.map((job) => ({
      company: job.company,
      role: job.role,
      dates: job.dates,
      location: job.location,
      bullets: job.bullets.join('\n'),
      groups: job.groups.map((group) => ({ title: group.title, bullets: group.bullets.join('\n') })),
    })),
    projects: doc.projects.map((project) => ({
      name: project.name,
      url: project.url,
      stack: project.stack,
      dates: project.dates,
      bullets: project.bullets.join('\n'),
    })),
    education: doc.education.map((school) => ({
      school: school.school,
      degree: school.degree,
      dates: school.dates,
      location: school.location,
      details: school.details.join('\n'),
    })),
    sections: doc.sections.map((section) => ({ title: section.title, lines: section.lines.join('\n') })),
  }
}

/** Entries that are completely blank are dropped; half-filled ones are caught by formProblems. */
function fromForm(form: ResumeForm): unknown {
  return {
    name: form.name,
    contact: {
      email: form.email,
      phone: form.phone,
      location: form.location,
      links: form.links.filter((link) => hasText(link.url)),
    },
    summary: form.summary,
    skills: form.skills
      .map((skill) => ({ category: skill.category, items: splitItems(skill.items) }))
      .filter((skill) => skill.items.length > 0),
    experience: form.experience
      .map((job) => ({
        company: job.company,
        role: job.role,
        dates: job.dates,
        location: job.location,
        bullets: splitLines(job.bullets),
        groups: job.groups
          .map((group) => ({ title: group.title, bullets: splitLines(group.bullets) }))
          .filter((group) => hasText(group.title) || group.bullets.length > 0),
      }))
      .filter((job) => hasText(job.company, job.role, job.dates, job.location) || job.bullets.length > 0 || job.groups.length > 0),
    projects: form.projects
      .map((project) => ({ ...project, bullets: splitLines(project.bullets) }))
      .filter((project) => hasText(project.name, project.url, project.stack, project.dates) || project.bullets.length > 0),
    education: form.education
      .map((school) => ({ ...school, details: splitLines(school.details) }))
      .filter((school) => hasText(school.school, school.degree, school.dates, school.location) || school.details.length > 0),
    sections: form.sections
      .map((section) => ({ title: section.title, lines: splitLines(section.lines) }))
      .filter((section) => hasText(section.title) || section.lines.length > 0),
  }
}

/** Half-filled entries the renderer would silently skip; better to ask. */
function formProblems(form: ResumeForm): string[] {
  const problems: string[] = []
  if (!hasText(form.name)) problems.push('Add your full name.')
  form.experience.forEach((job, i) => {
    const content = hasText(job.dates, job.location, job.bullets) || job.groups.some((g) => hasText(g.title, g.bullets))
    if (content && !hasText(job.company, job.role)) problems.push(`Job ${i + 1} needs a company or a job title.`)
  })
  form.projects.forEach((project, i) => {
    if (hasText(project.url, project.stack, project.dates, project.bullets) && !hasText(project.name)) {
      problems.push(`Project ${i + 1} needs a name.`)
    }
  })
  form.education.forEach((school, i) => {
    if (hasText(school.degree, school.dates, school.location, school.details) && !hasText(school.school)) {
      problems.push(`Education ${i + 1} needs a school.`)
    }
  })
  form.sections.forEach((section, i) => {
    if (hasText(section.lines) && !hasText(section.title)) problems.push(`Section ${i + 1} needs a heading.`)
  })
  return problems
}

function describeIssue(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (!issue) return 'Some fields are not valid.'
  const where = issue.path.map((part) => (typeof part === 'number' ? `#${part + 1}` : String(part))).join(' › ')
  return where ? `${where}: ${issue.message}` : issue.message
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm font-bold mb-1.5">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  )
}

function Area({
  label,
  hint,
  value,
  onChange,
  rows = 4,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  rows?: number
}) {
  return (
    <label className="block">
      <span className="block text-sm font-bold mb-1.5">
        {label}
        {hint && <span className="font-normal text-[var(--color-text-faint)]"> · {hint}</span>}
      </span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} resize-y leading-relaxed`} />
    </label>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="nb-card rounded-[10px] p-6 space-y-4">
      <div>
        <h2 className="text-xl font-black">{title}</h2>
        {description && <p className="text-sm text-[var(--color-text-muted)] mt-1">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Repeater<T>({
  items,
  onChange,
  create,
  addLabel,
  itemLabel,
  render,
}: {
  items: T[]
  onChange: (items: T[]) => void
  create: () => T
  addLabel: string
  itemLabel: (index: number) => string
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode
}) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="rounded-[10px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-bg)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              {itemLabel(index)}
            </span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
            >
              Remove
            </button>
          </div>
          {render(item, (patch) => onChange(items.map((current, i) => (i === index ? { ...current, ...patch } : current))))}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, create()])}
        className="text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
      >
        + {addLabel}
      </button>
    </div>
  )
}

interface ResumeEditorProps {
  resumeId: string | null
  sourceFormat: SourceFormat
  initialDoc: ResumeDoc
  initialTitle: string
  initialLatex: string | null
  onSaved: (resume: ResumeSummary) => void
  onBack: () => void
  /** Offered once the resume is saved with no unsaved changes. */
  onTailor?: (resumeId: string, title: string) => void
}

export default function ResumeEditor({
  resumeId,
  sourceFormat,
  initialDoc,
  initialTitle,
  initialLatex,
  onSaved,
  onBack,
  onTailor,
}: ResumeEditorProps) {
  const [form, setForm] = useState<ResumeForm>(() => toForm(initialDoc, initialTitle))
  const [savedId, setSavedId] = useState(resumeId)
  const [latex, setLatex] = useState(initialLatex)
  const [dirty, setDirty] = useState(resumeId === null)
  const [saving, setSaving] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<ResumeForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  async function save() {
    const problems = formProblems(form)
    if (problems.length > 0) {
      setError(problems.join(' '))
      return
    }
    const parsed = ResumeDocSchema.safeParse(fromForm(form))
    if (!parsed.success) {
      setError(describeIssue(parsed.error.issues[0]))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(savedId ? `/api/resumes/${savedId}` : '/api/resumes', {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          savedId ? { title: form.title, doc: parsed.data } : { title: form.title, sourceFormat, doc: parsed.data }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'The resume could not be saved.')
      setSavedId(data.resume.id)
      setLatex(data.latex)
      setDirty(false)
      onSaved(data.resume)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function downloadTex() {
    if (latex) downloadBlob(new Blob([latex], { type: 'application/x-tex' }), `${resumeFileBase(form.name)}.tex`)
  }

  async function downloadPdf() {
    if (!savedId) return
    setCompiling(true)
    setError(null)
    try {
      await downloadResumePdf(savedId, form.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompiling(false)
    }
  }

  return (
    <div className="space-y-6 anim-page-enter max-w-4xl">
      <div>
        <button onClick={onBack} className={backLinkClass}>
          <ArrowLeft size={16} /> Your resumes
        </button>
        <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">
          {savedId ? (
            <>
              Edit <span className="nb-highlight">resume</span>
            </>
          ) : (
            <>
              Check your <span className="nb-highlight">resume</span>
            </>
          )}
        </h1>
        <p className="mt-5 text-lg text-[var(--color-text-muted)]">
          {savedId
            ? 'Saving updates the stored copy and regenerates its LaTeX.'
            : 'The AI copied your resume into these fields without rewriting it. Fix anything it misread, then save.'}
        </p>
      </div>

      <Section title="Resume name" description="Only you see this, in your list of resumes.">
        <Field label="Title" value={form.title} onChange={(title) => update({ title })} placeholder="e.g. Backend roles" />
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name" value={form.name} onChange={(name) => update({ name })} />
          <Field label="Email" type="email" value={form.email} onChange={(email) => update({ email })} />
          <Field label="Phone" value={form.phone} onChange={(phone) => update({ phone })} />
          <Field label="Location" value={form.location} onChange={(location) => update({ location })} />
        </div>
        <Repeater
          items={form.links}
          onChange={(links) => update({ links })}
          create={() => ({ label: '', url: '' })}
          addLabel="Add a link"
          itemLabel={(i) => `Link ${i + 1}`}
          render={(link, set) => (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Text shown" value={link.label} onChange={(label) => set({ label })} placeholder="linkedin.com/in/you" />
              <Field label="URL" value={link.url} onChange={(url) => set({ url })} placeholder="https://…" />
            </div>
          )}
        />
      </Section>

      <Section title="Summary">
        <Area label="Summary" value={form.summary} onChange={(summary) => update({ summary })} rows={4} />
      </Section>

      <Section title="Skills" description="One line per group of skills.">
        <Repeater
          items={form.skills}
          onChange={(skills) => update({ skills })}
          create={() => ({ category: '', items: '' })}
          addLabel="Add a skill line"
          itemLabel={(i) => `Skill line ${i + 1}`}
          render={(skill, set) => (
            <>
              <Field label="Category" value={skill.category} onChange={(category) => set({ category })} placeholder="Languages" />
              <Area label="Skills" hint="separated by commas" value={skill.items} onChange={(items) => set({ items })} rows={2} />
            </>
          )}
        />
      </Section>

      <Section title="Experience">
        <Repeater
          items={form.experience}
          onChange={(experience) => update({ experience })}
          create={() => ({ company: '', role: '', dates: '', location: '', bullets: '', groups: [] })}
          addLabel="Add a job"
          itemLabel={(i) => `Job ${i + 1}`}
          render={(job, set) => (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Company" value={job.company} onChange={(company) => set({ company })} />
                <Field label="Job title" value={job.role} onChange={(role) => set({ role })} />
                <Field label="Dates" value={job.dates} onChange={(dates) => set({ dates })} placeholder="Jan 2022 – Present" />
                <Field label="Location" value={job.location} onChange={(location) => set({ location })} />
              </div>
              <Area label="Bullet points" hint="one per line" value={job.bullets} onChange={(bullets) => set({ bullets })} rows={5} />
              <Repeater
                items={job.groups}
                onChange={(groups) => set({ groups })}
                create={() => ({ title: '', bullets: '' })}
                addLabel="Add a client or sub-project"
                itemLabel={(i) => `Client or sub-project ${i + 1}`}
                render={(group, setGroup) => (
                  <>
                    <Field label="Heading" value={group.title} onChange={(title) => setGroup({ title })} />
                    <Area label="Bullet points" hint="one per line" value={group.bullets} onChange={(bullets) => setGroup({ bullets })} rows={3} />
                  </>
                )}
              />
            </>
          )}
        />
      </Section>

      <Section title="Projects">
        <Repeater
          items={form.projects}
          onChange={(projects) => update({ projects })}
          create={() => ({ name: '', url: '', stack: '', dates: '', bullets: '' })}
          addLabel="Add a project"
          itemLabel={(i) => `Project ${i + 1}`}
          render={(project, set) => (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Name" value={project.name} onChange={(name) => set({ name })} />
                <Field label="Link" value={project.url} onChange={(url) => set({ url })} placeholder="https://…" />
                <Field label="Technologies" value={project.stack} onChange={(stack) => set({ stack })} />
                <Field label="Dates" value={project.dates} onChange={(dates) => set({ dates })} />
              </div>
              <Area label="Bullet points" hint="one per line" value={project.bullets} onChange={(bullets) => set({ bullets })} rows={4} />
            </>
          )}
        />
      </Section>

      <Section title="Education">
        <Repeater
          items={form.education}
          onChange={(education) => update({ education })}
          create={() => ({ school: '', degree: '', dates: '', location: '', details: '' })}
          addLabel="Add education"
          itemLabel={(i) => `Education ${i + 1}`}
          render={(school, set) => (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="School" value={school.school} onChange={(value) => set({ school: value })} />
                <Field label="Degree" value={school.degree} onChange={(degree) => set({ degree })} />
                <Field label="Dates" value={school.dates} onChange={(dates) => set({ dates })} />
                <Field label="Location" value={school.location} onChange={(location) => set({ location })} />
              </div>
              <Area label="Details" hint="GPA, coursework, honours — one per line" value={school.details} onChange={(details) => set({ details })} rows={2} />
            </>
          )}
        />
      </Section>

      <Section title="Other sections" description="Certifications, awards, publications, languages, anything else.">
        <Repeater
          items={form.sections}
          onChange={(sections) => update({ sections })}
          create={() => ({ title: '', lines: '' })}
          addLabel="Add a section"
          itemLabel={(i) => `Section ${i + 1}`}
          render={(section, set) => (
            <>
              <Field label="Heading" value={section.title} onChange={(title) => set({ title })} placeholder="Certifications" />
              <Area label="Entries" hint="one per line" value={section.lines} onChange={(lines) => set({ lines })} rows={3} />
            </>
          )}
        />
      </Section>

      {error && <div className={errorBox}>{error}</div>}

      {latex && !dirty && <LatexPreview latex={latex} title="Generated LaTeX" />}

      <div className="sticky bottom-4 nb-card rounded-[10px] shadow-[5px_5px_0_0_var(--color-ink)] p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          {saving ? 'Saving…' : dirty ? (savedId ? 'Unsaved changes' : 'Not saved yet') : 'All changes saved'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTex} disabled={!latex || dirty} className={secondaryButton}>
            Download .tex
          </button>
          {compiling && (
            <div className="w-full">
              <Working kind="pdf" active={0} steps={['Typesetting your resume as a PDF']} />
            </div>
          )}
          <button onClick={downloadPdf} disabled={!savedId || dirty || compiling} className={secondaryButton}>
            {compiling ? 'Building PDF…' : 'Download PDF'}
          </button>
          {onTailor && savedId && !dirty ? (
            <button onClick={() => onTailor(savedId, form.title || form.name)} className={primaryButton}>
              Tailor to a job →
            </button>
          ) : (
            <button onClick={save} disabled={saving || !dirty} className={primaryButton}>
              {saving ? 'Saving…' : 'Save resume'}
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)] text-center">
        Download PDF sends the saved resume to texlive.net to be typeset.
      </p>
    </div>
  )
}
