/*
 * What a cold email costs, measured against the real code.
 *
 *   npx tsc -p tsconfig.pipeline-test.json && node scripts/measure-outreach.js
 *
 * It runs the actual flows — company research, the tailoring passes, the email,
 * the cover letter — against a stand-in model that answers instantly and records
 * every call: the system instruction, the cacheable opening, the prompt and the
 * answer. Nothing is guessed from reading the code, and no real model is called.
 *
 * Latency is not measured here, because a stand-in answers in microseconds. What
 * is reported instead is the critical path: how many model calls have to finish
 * before the next can start. That is the number a real run's wall clock follows,
 * and it is the one the optimisation moves.
 */
const path = require('path')
const Module = require('module')

const BUILD = path.join(__dirname, '..', '.pipeline-test')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(BUILD, request.slice(2))
  return origResolve.call(this, request, ...rest)
}

const { estimateTokens } = require(BUILD + '/lib/json-repair')
const { standardProfile } = require(BUILD + '/lib/profiles/standard')
const { runOptimization } = require(BUILD + '/lib/run-optimization')
const { extractJdKeywords } = require(BUILD + '/lib/tailor/keywords')
const { scoreKeywords } = require(BUILD + '/lib/tailor/keyword-finder')
const { describeRole } = require(BUILD + '/lib/apply/role')
const { writeOutreachEmail } = require(BUILD + '/lib/outreach/prompt')
const { writeCoverLetter } = require(BUILD + '/lib/cover-letter')
const { researchCompany } = require(BUILD + '/lib/outreach/company-research')
const { parseLatexResume } = require(BUILD + '/lib/latex/parse')
const { renderResumeLatex } = require(BUILD + '/lib/import/render')
const { ResumeDocSchema } = require(BUILD + '/lib/resume-doc')
const { resumeTextFromLatex } = require(BUILD + '/lib/cover-letter')

// ─── The sample: one candidate, one posting, one recruiter ───────────────────

const RESUME_DOC = ResumeDocSchema.parse({
  name: 'Asha Menon',
  contact: { email: 'asha.menon@example.com', phone: '+91 90000 00000', location: 'Pune' },
  summary: 'Backend engineer with four years building payment and data services on AWS.',
  skills: [
    { category: 'Languages', items: ['Java', 'Python', 'TypeScript', 'SQL'] },
    { category: 'Cloud', items: ['AWS Lambda', 'ECS', 'RDS', 'S3'] },
    { category: 'Data', items: ['PostgreSQL', 'Redis', 'Kafka'] },
  ],
  experience: [
    {
      company: 'Northwind Systems',
      role: 'Senior Backend Engineer',
      start: '2022',
      end: 'present',
      bullets: [
        'Built a payouts service handling 40,000 daily requests, cutting p95 latency by 32% through query tuning and caching',
        'Led the migration of six services from EC2 to ECS with no customer-visible downtime',
        'Cut the nightly reconciliation job from 90 minutes to 11 by batching writes and adding a covering index',
        'Ran the on-call rotation for the payments domain and wrote the runbooks the team still uses',
        'Reviewed roughly 400 pull requests a year and mentored two junior engineers to mid level',
      ],
    },
    {
      company: 'Contoso Labs',
      role: 'Backend Engineer',
      start: '2020',
      end: '2022',
      bullets: [
        'Wrote the ingestion pipeline that moved 2 TB a day from partner feeds into the warehouse',
        'Replaced a hand-rolled scheduler with a queue-backed worker pool, halving failed jobs',
        'Added structured logging and dashboards that cut median incident diagnosis from 40 to 12 minutes',
        'Shipped the first public API, with versioning and rate limits, used by 30 partners',
      ],
    },
  ],
  projects: [
    {
      name: 'Ledger reconciler',
      bullets: [
        'An open-source tool that reconciles bank statements against an internal ledger, used by four teams',
        'Handles 1.2 million rows a run in under two minutes on a single node',
        'Written in Go with a Postgres backing store and a small web front end',
      ],
    },
  ],
  education: [{ school: 'College of Engineering, Pune', degree: 'B.Tech Computer Science', year: '2020' }],
})

const JOB_DESCRIPTION = [
  'Northwind Labs is hiring a Senior Platform Engineer to own our payments platform.',
  '',
  'About the role: you will design, build and operate RESTful APIs and event-driven services on AWS, with strong ownership of reliability, observability and cost. You will work with product engineers across three teams and set the standard for how services are built here.',
  '',
  'What you will do:',
  ...Array.from({ length: 14 }, (_, i) =>
    `- Responsibility ${i + 1}: own a part of the platform end to end, from design review through rollout, on-call and the runbook that follows it.`
  ),
  '',
  'Requirements: Java or Kotlin, Spring Boot, PostgreSQL, Kafka, Terraform, Kubernetes, CI/CD, distributed systems, microservices, RESTful APIs.',
  'Nice to have: Go, observability tooling, cost optimisation, incident command.',
  '',
  'We offer a hybrid schedule from our Bengaluru office, private health cover, and a learning budget.',
].join('\n')

/** What a posting on a real careers page runs to: the role, then benefits, process and boilerplate. */
const LONG_POSTING = [
  JOB_DESCRIPTION,
  ...Array.from(
    { length: 40 },
    (_, i) =>
      `Section ${i + 1}: a paragraph about benefits, our values, the interview process, equal opportunity, ` +
      'relocation support, and how we think about levelling and compensation bands across the company.'
  ),
].join('\n\n')

const RECRUITER = { name: 'Priya Rao', company: 'Northwind Labs', title: 'Talent Partner', email: 'priya.rao@northwindlabs.example' }

const SITE_TEXT =
  'Northwind Labs builds payment infrastructure for 2,000 small businesses across India. ' +
  'Our ledger service settles merchant payouts every morning. Founded in 2019 in Pune, we serve merchants in 40 cities. ' +
  'We are hiring across platform, data and security.'

const PROFILE = { senderName: 'Asha Menon', phone: '+91 90000 00000', links: [], availability: 'Can join in 30 days', highlights: 'Led the payments migration' }

// ─── The stand-in model ──────────────────────────────────────────────────────

const KEYWORDS_REPLY = JSON.stringify({
  jobTitle: 'Senior Platform Engineer',
  company: 'Northwind Labs',
  keywords: [
    ...['RESTful APIs', 'Spring Boot', 'Kafka', 'Terraform', 'Kubernetes', 'PostgreSQL', 'microservices', 'CI/CD'].map((term) => ({
      term, kind: 'tool', required: true,
    })),
    ...['observability', 'distributed systems', 'cost optimisation'].map((term) => ({ term, kind: 'skill', required: false })),
  ],
})

const EMAIL_PARTS = {
  subject: 'Senior Platform Engineer — payments and Kubernetes',
  greeting: 'Hi Priya,',
  paragraphs: [
    'I am a senior backend engineer at Northwind Systems, where I own the payouts service that handles forty thousand requests a day, and I am looking for a platform role with that kind of ownership.',
    'Two things from my work line up with what you describe. I moved six services to ECS with no customer-visible downtime, and I cut the nightly reconciliation job from ninety minutes to eleven. Both were RESTful APIs backed by PostgreSQL, with the on-call rota that goes with them.',
    'Your ledger service settling merchant payouts every morning is close to the problem I have been working on. Would a short call next week suit you?',
  ],
  closing: 'Best regards,',
}

/** Deliberately about different work, as the one-call prompt asks. */
const LETTER_PARTS = {
  greeting: 'Dear Hiring Manager,',
  paragraphs: [
    'I am writing about the Senior Platform Engineer role. My last four years have been spent on data movement and the reliability around it, which is the part of your posting about observability and cost.',
    'At Contoso Labs I wrote an ingestion pipeline moving two terabytes a day from partner feeds, replaced a hand-rolled scheduler with a queue-backed worker pool that halved failed jobs, and added structured logging that took median incident diagnosis from forty minutes to twelve. Alongside that I maintain an open-source ledger reconciler that handles 1.2 million rows a run.',
    'Those are the habits I would bring to a platform owned across three teams: dashboards before incidents, runbooks after them, and a review culture that makes both stick.',
    'I would be glad to talk about where the platform is today and where you want it to go.',
  ],
  closing: 'Kind regards,',
}

const emailReply = (withLetter) => JSON.stringify(withLetter ? { ...EMAIL_PARTS, letter: LETTER_PARTS } : EMAIL_PARTS)
const LETTER_REPLY = JSON.stringify(LETTER_PARTS)

const RESEARCH_REPLY = JSON.stringify({
  company: 'Northwind Labs',
  facts: [
    'Builds payment infrastructure for 2,000 small businesses across India',
    'Its ledger service settles merchant payouts every morning',
    'Founded in 2019 in Pune, serving merchants in 40 cities',
  ],
})

function tailoringReply(resume, prompt) {
  // The follow-up passes are asked for less; answering with nothing keeps the
  // measurement honest about what a run costs at minimum.
  if (/## MISSING REQUIRED KEYWORDS|under-delivered|## THE PROBLEM/.test(prompt)) {
    return JSON.stringify({ changes: [] })
  }
  const bullets = resume.sections.flatMap((section) =>
    section.content.filter((line) => line.startsWith('\\item')).map((line) => ({ section, line }))
  )
  return JSON.stringify({
    summary: 'Rebuilt around the platform role: RESTful APIs, Kubernetes and the reliability ownership the posting asks for.',
    companyName: 'Northwind Labs',
    keywordsAdded: ['RESTful APIs', 'Kubernetes', 'Terraform', 'PostgreSQL'],
    sectionsModified: ['Experience', 'Projects'],
    changes: bullets.slice(0, 9).map(({ section, line }) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      original: line,
      proposed: line.replace(/\\item /, '\\item Operated \\textbf{RESTful APIs} on \\textbf{Kubernetes}: '),
      reason: 'Carries the posting’s own terms',
      type: 'rewrite',
    })),
  })
}

/**
 * What the Claude API actually bills for one call, given what earlier calls in
 * the same run left in the cache. Two breakpoints, as lib/claude.ts sends them:
 * one after the system instruction, one after the repeated opening. A prefix
 * shorter than the model's minimum never caches, so it is billed in full every
 * time — which is why a 30-token system instruction is not worth marking.
 */
const MIN_CACHEABLE = 1024
const CACHE_READ = 0.1
const CACHE_WRITE = 1.25

function billed(call, seen) {
  const points = [
    { key: call.systemText, tokens: call.system },
    { key: call.systemText + ' ' + call.cachedText, tokens: call.system + call.cached },
  ].filter((point) => point.tokens >= MIN_CACHEABLE)

  const hit = [...points].reverse().find((point) => seen.has(point.key))
  const read = hit ? hit.tokens : 0
  const write = points.length > 0 ? points[points.length - 1].tokens - read : 0
  for (const point of points) seen.add(point.key)

  const uncached = call.system + call.cached - read - write
  return Math.round(read * CACHE_READ + write * CACHE_WRITE + uncached + call.prompt)
}

/** Records every call and answers it, so a whole flow runs without a model. */
function standIn(resume) {
  const calls = []
  const generate = async ({ systemInstruction, prompt, temperature, cachePrefix }) => {
    const full = (cachePrefix ?? '') + prompt
    let answer
    if (/pick out facts about a company/.test(prompt) || /## TEXT FROM/.test(prompt)) answer = RESEARCH_REPLY
    else if (/"jobTitle"/.test(prompt) && /keywords/.test(prompt) && !/## RESUME/.test(full)) answer = KEYWORDS_REPLY
    else if (/Write a first email/.test(prompt)) answer = emailReply(/## ALSO WRITE THE COVER LETTER/.test(prompt))
    else if (/Write a cover letter/.test(prompt)) answer = LETTER_REPLY
    else answer = tailoringReply(resume, full)

    calls.push({
      systemText: systemInstruction,
      cachedText: cachePrefix ?? '',
      system: estimateTokens(systemInstruction),
      cached: estimateTokens(cachePrefix ?? ''),
      prompt: estimateTokens(prompt),
      output: estimateTokens(answer),
      temperature,
      what: label(prompt, full),
    })
    return answer
  }
  return { calls, generate }
}

function label(prompt, full) {
  if (/## TEXT FROM/.test(prompt)) return 'company research'
  if (/"jobTitle"/.test(prompt) && !/## RESUME/.test(full)) return 'job keywords'
  if (/Write a first email/.test(prompt)) return 'recruiter email'
  if (/Write a cover letter/.test(prompt)) return 'cover letter'
  if (/## MISSING REQUIRED KEYWORDS/.test(prompt)) return 'tailor: keyword top-up'
  if (/under-delivered/.test(prompt)) return 'tailor: coverage'
  if (/## THE PROBLEM/.test(prompt)) return 'tailor: evidence'
  return 'tailor: first pass'
}

// ─── Reporting ───────────────────────────────────────────────────────────────

const pad = (text, width) => String(text).padEnd(width)
const num = (value, width) => String(value).padStart(width)

function report(title, calls, { criticalPath = calls.length } = {}) {
  const seen = new Set()
  const rows = calls.map((call) => ({ ...call, billedInput: billed(call, seen) }))
  const sent = rows.reduce((total, row) => total + row.system + row.cached + row.prompt, 0)
  const paid = rows.reduce((total, row) => total + row.billedInput, 0)
  const out = rows.reduce((total, row) => total + row.output, 0)

  console.log(`\n${title}`)
  console.log('  ' + pad('call', 26) + num('sent in', 9) + num('billed', 9) + num('out', 8))
  for (const row of rows) {
    console.log('  ' + pad(row.what, 26) + num(row.system + row.cached + row.prompt, 9) + num(row.billedInput, 9) + num(row.output, 8))
  }
  console.log('  ' + pad('TOTAL', 26) + num(sent, 9) + num(paid, 9) + num(out, 8))
  console.log(`  ${calls.length} model calls, ${criticalPath} on the critical path`)
  return { name: title, calls: calls.length, sent, paid, out, criticalPath }
}

// ─── The flows ───────────────────────────────────────────────────────────────

const latex = renderResumeLatex(RESUME_DOC)
const parsed = parseLatexResume(latex, 'sample').resume
const resumeText = resumeTextFromLatex(latex)

/** A research store that has never seen this company, so the site is read every time. */
const coldStore = () => ({ load: async () => null, save: async () => undefined })
/** A research store that already holds it: what every email after the first sees. */
const warmStore = () => ({
  load: async () => ({ site: 'northwindlabs.example', company: 'Northwind Labs', facts: JSON.parse(RESEARCH_REPLY).facts, status: 'found', readAt: new Date() }),
  save: async () => undefined,
})
const sitePage = `<html><head><title>Northwind Labs</title></head><body><nav>Home Careers</nav><main><p>${SITE_TEXT}</p></main></body></html>`
const siteDeps = {
  resolveHost: async () => '93.184.216.34',
  fetchPage: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => new TextEncoder().encode(sitePage).buffer,
  }),
}

async function emailOnly({ store, withLetter, jobDescription = JOB_DESCRIPTION }) {
  const { calls, generate } = standIn(parsed)
  // As the route does it: the site is read while nothing else is waiting on it.
  const researching = researchCompany(RECRUITER.email, generate, store, siteDeps)
  const company = await researching
  const written = await writeOutreachEmail({
    input: {
      candidateName: 'Asha Menon',
      resumeText,
      recruiter: RECRUITER,
      jobTitle: 'Senior Platform Engineer',
      company: 'Northwind Labs',
      jobDescription,
      tone: 'professional',
      availability: PROFILE.availability,
      highlights: PROFILE.highlights,
      attachResume: true,
      about: company.status === 'found' ? company : null,
      withCoverLetter: withLetter,
      letterLength: 'standard',
    },
    signature: ['Asha Menon', '+91 90000 00000'],
    generate,
  })
  await letterIfNotAlready(written, { withLetter, jobDescription, jobTitle: 'Senior Platform Engineer', company: 'Northwind Labs', generate })
  // Nothing overlaps here: the email needs the facts, so both are on the path.
  return { calls, criticalPath: calls.length }
}

/**
 * The cover letter as a second call — which is what the code did before this
 * work, and still does when writeOutreachEmail doesn't return one. Keeping the
 * fallback is what lets this script run unchanged against an older commit and
 * produce a real before-and-after rather than a remembered one.
 */
async function letterIfNotAlready(written, { withLetter, jobDescription, jobTitle, company, generate }) {
  if (!withLetter || written?.coverLetter) return
  await writeCoverLetter({
    input: {
      resumeText, jobDescription, jobTitle, company,
      candidateName: 'Asha Menon', tone: 'professional', length: 'standard',
    },
    generate,
  })
}

/**
 * The routes used to wait for the company research before starting the
 * tailoring, though it needs nothing from it. SEQUENTIAL_RESEARCH=1 arranges the
 * calls that way, so the critical path in the before column is measured rather
 * than asserted.
 */
const SEQUENTIAL = process.env.SEQUENTIAL_RESEARCH === '1'

async function withTailoring({ store, withLetter, level = 'hard' }) {
  const { calls, generate } = standIn(parsed)
  // Started first and awaited last: it needs nothing from the tailoring.
  const researching = researchCompany(RECRUITER.email, generate, store, siteDeps)
  researching.catch(() => null)
  if (SEQUENTIAL) await researching

  const keywords = await extractJdKeywords({ jobDescription: JOB_DESCRIPTION, generate })
  const analysis = {
    posting: { url: '', title: '', company: '', location: '', text: JOB_DESCRIPTION, structured: false },
    ...describeRole({ url: '', title: '', company: '', location: '', text: JOB_DESCRIPTION, structured: false }, RECRUITER, keywords, ''),
    keywords: scoreKeywords(JOB_DESCRIPTION, keywords.keywords),
  }
  const tailored = await runOptimization({
    mode: 'optimize', level, keywords, profile: standardProfile(level), resume: parsed,
    jobDescription: JOB_DESCRIPTION, hardInstructions: '', softInstructions: '', provider: 'anthropic', generate,
  })
  const company = await researching
  const written = await writeOutreachEmail({
    input: {
      candidateName: 'Asha Menon', resumeText, recruiter: RECRUITER,
      jobTitle: analysis.title, company: analysis.company, jobDescription: JOB_DESCRIPTION,
      tone: 'professional', availability: PROFILE.availability, highlights: PROFILE.highlights,
      attachResume: true, about: company.status === 'found' ? company : null,
      withCoverLetter: withLetter, letterLength: 'standard',
    },
    signature: ['Asha Menon', '+91 90000 00000'],
    generate,
  })
  await letterIfNotAlready(written, { withLetter, jobDescription: JOB_DESCRIPTION, jobTitle: analysis.title, company: analysis.company, generate })
  // The research call runs beside the tailoring, so it is off the path.
  return { calls, changes: tailored.changes.length, criticalPath: SEQUENTIAL ? calls.length : calls.length - 1 }
}

/**
 * The same five flows measured on the commit before this work, with the same
 * sample and the same stand-in. Kept here so the comparison can be re-run rather
 * than taken on trust: `git stash && node scripts/measure-outreach.js` against
 * the parent commit reproduces the left-hand column.
 */
const BASELINE = {
  A: { calls: 2, sent: 2011, paid: 2011, out: 246, criticalPath: 2 },
  B: { calls: 1, sent: 1680, paid: 1680, out: 189, criticalPath: 1 },
  C: { calls: 2, sent: 3035, paid: 3035, out: 418, criticalPath: 2 },
  D: { calls: 6, sent: 10327, paid: 7826, out: 493, criticalPath: 6 },
  E: { calls: 7, sent: 11682, paid: 9181, out: 722, criticalPath: 7 },
  F: { calls: 2, sent: 6851, paid: 6851, out: 418, criticalPath: 2 },
}

function compare(key, now) {
  const was = BASELINE[key]
  if (!was) return
  const delta = (before, after) => {
    const change = after - before
    const pct = before === 0 ? 0 : Math.round((change / before) * 100)
    return `${before} → ${after} (${change >= 0 ? '+' : ''}${pct}%)`
  }
  console.log(`  vs before: calls ${delta(was.calls, now.calls)} · billed in ${delta(was.paid, now.paid)} · on path ${delta(was.criticalPath, now.criticalPath)}`)
}

async function main() {
  console.log('Sample: ' + [
    `resume ${resumeText.length} chars (~${estimateTokens(resumeText)} tok)`,
    `posting ${JOB_DESCRIPTION.length} chars (~${estimateTokens(JOB_DESCRIPTION)} tok)`,
  ].join(', '))

  const cold = await emailOnly({ store: coldStore(), withLetter: false })
  compare('A', report('A. Cold email, company never researched before', cold.calls, cold))

  const warm = await emailOnly({ store: warmStore(), withLetter: false })
  compare('B', report('B. Cold email, company already researched', warm.calls, warm))

  const withLetter = await emailOnly({ store: warmStore(), withLetter: true })
  compare('C', report('C. Cold email + cover letter, company already researched', withLetter.calls, withLetter))

  const full = await withTailoring({ store: coldStore(), withLetter: false })
  compare('D', report(`D. Tailored resume + cold email (${full.changes} changes applied)`, full.calls, full))

  const fullLetter = await withTailoring({ store: coldStore(), withLetter: true })
  compare('E', report('E. Tailored resume + cold email + cover letter', fullLetter.calls, fullLetter))

  // A real posting, not a short sample: this is where capping what the email is
  // given shows up, because the sample above is already under the cap.
  const long = await emailOnly({ store: warmStore(), withLetter: true, jobDescription: LONG_POSTING })
  compare('F', report(`F. Cold email + cover letter, ${LONG_POSTING.length}-char posting`, long.calls, long))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
