/*
 * Tests for the LaTeX pipeline, run against the real resumes/*.tex.
 *
 *   npm run test:latex
 *
 * The modules under test are TypeScript with "@/..." imports, so the npm script
 * compiles them to .pipeline-test/ first and this file patches Node's resolver
 * to understand the alias. No test framework, on purpose: the project has none,
 * and this needs to stay runnable with nothing installed.
 *
 * What it covers, in order:
 *   1. parsing      — sections, editable spans, frozen structural lines
 *   2. matching     — the three ways a model mis-quotes a bullet
 *   3. coverage     — the per-section rewrite quota sees real bullets
 *   4. sanitizing   — escaping, markdown, and the macro allow-list
 *   5. applying     — splices land, frozen lines resist, bad LaTeX is refused
 *   6. fuzz corpus  — writes .pipeline-test/fuzz.tex; compile it to confirm
 *                     that anything the sanitizer accepts actually typesets
 *   7. evidence     — an evidence-pass rewrite of an already-rewritten bullet
 *                     chains back to the real source line and still applies
 *   8. access       — who counts as the owner, and that everyone else doesn't
 *   9. render       — a structured resume renders into the house template, with
 *                     every user character escaped and every bullet editable;
 *                     writes .pipeline-test/rendered.tex to compile
 *  10. import       — text comes out of PDF, Word, LaTeX and text uploads (the
 *                     binary fixtures in scripts/fixtures are synthetic), bad
 *                     uploads are refused, and the model's structuring reply is
 *                     validated and retried once
 *  11. tailoring    — keyword matching and coverage, the guards on facts and on
 *                     soft's bullet cap, the keyword fallback, and a full run
 *                     with a scripted model that proves the guarantee holds
 *  12. billing      — Razorpay signatures against digests made with openssl,
 *                     the order runs are spent in, which plan states give runs,
 *                     webhook payloads, prices, and the environment switches
 */
const path = require('path')
const fs = require('fs')
const Module = require('module')

const BUILD = path.join(__dirname, '..', '.pipeline-test')

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(BUILD, request.slice(2))
  return origResolve.call(this, request, ...rest)
}

const { parseLatexResume } = require(BUILD + '/lib/latex/parse')
const { findSpan } = require(BUILD + '/lib/latex/match')
const { sanitizeLatexFragment, validateLatexDocument } = require(BUILD + '/lib/latex/sanitize')
const { applyLatexChanges } = require(BUILD + '/lib/latex/apply')
const { findCoverageGaps, bulletLines, isEditableSection } = require(BUILD + '/lib/coverage')
const { PROFILES } = require(BUILD + '/lib/profiles/index')

const ROOT = path.join(__dirname, '..')
let pass = 0
let fail = 0

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  PASS  ' + name)
  } else {
    fail++
    console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''))
  }
}

// ---------------------------------------------------------------- 1-3. parse
for (const id of Object.keys(PROFILES)) {
  const profile = PROFILES[id]
  const src = fs.readFileSync(path.join(ROOT, 'resumes', profile.texFile), 'utf8')

  console.log('\n=== ' + profile.texFile + ' ===')
  const { resume, editable } = parseLatexResume(src, profile.personName + ' Resume')
  console.log('  sections: ' + resume.sections.map((s) => s.title + '(' + s.content.length + ')').join(', '))
  console.log('  editable spans: ' + editable.length)

  check('has a Summary section', resume.sections.some((s) => /summary/i.test(s.title)))
  check('has an Experience section', resume.sections.some((s) => /experience/i.test(s.title)))
  check('has a Projects section', resume.sections.some((s) => /project/i.test(s.title)))
  check('found editable spans', editable.length > 15, 'got ' + editable.length)

  const leaked = editable.filter((s) => s.text.includes('#1') || s.text.includes('vspace'))
  check('no \\newcommand bodies parsed as content', leaked.length === 0,
    leaked.slice(0, 2).map((l) => l.text.slice(0, 60)).join(' | '))

  const badSpan = editable.filter((s) => src.slice(s.argStart, s.argEnd) !== s.text)
  check('span offsets match their text', badSpan.length === 0,
    badSpan.slice(0, 2).map((b) => JSON.stringify(src.slice(b.argStart, b.argEnd).slice(0, 50))).join(' | '))

  const structural = resume.sections.flatMap((s) => s.content).filter((l) => /^\[(Role|Project|Group)\]/.test(l))
  check('structural lines tagged', structural.length > 0, 'got ' + structural.length)
  check('profile freezes every structural line',
    structural.every((l) => profile.coverage.frozenLinePatterns.some((p) => p.test(l))))
  check('structural lines are not editable',
    editable.filter((s) => /^\[(Role|Project|Group)\]/.test(s.text)).length === 0)

  const bullet = editable.find((s) => s.macro === 'resumeItem' && s.text.includes('\\textbf{'))
  if (!bullet) {
    check('found a bold bullet to test matching', false)
    continue
  }

  const visibleQuote = bullet.text
    .replace(/\\textbf\{([^{}]*)\}/g, '$1')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
  check('matches an exact quote',
    findSpan(editable, bullet.text)?.span.argStart === bullet.argStart)
  check('matches a whitespace-mangled quote',
    findSpan(editable, '  ' + bullet.text.replace(/ /g, '  ') + ' ')?.span.argStart === bullet.argStart)
  check('matches a markup-stripped quote (model dropped \\textbf and escapes)',
    findSpan(editable, visibleQuote)?.span.argStart === bullet.argStart,
    'quote: ' + visibleQuote.slice(0, 70))

  const expSection = resume.sections.find((s) => /experience/i.test(s.title))
  const bullets = bulletLines(expSection, profile.coverage)
  check('experience section is editable', isEditableSection(expSection, profile.coverage))
  check('coverage finds experience bullets', bullets.length > 3, 'got ' + bullets.length)
  check('coverage excludes structural lines',
    bullets.every((b) => !/^\[(Role|Project|Group)\]/.test(b)))
  const gaps = findCoverageGaps(resume, [], profile.coverage)
  console.log('  coverage would demand: ' + gaps.map((g) => g.sectionTitle + ' x' + g.required).join(', '))
  check('coverage demands rewrites somewhere', gaps.length > 0)
}

// ------------------------------------------------------------ 4. sanitizing
console.log('\n=== sanitizer ===')
const S = (t) => sanitizeLatexFragment(t)
check('escapes a bare percent', S('cut latency by 40%').text === 'cut latency by 40\\%', S('cut latency by 40%').text)
check('escapes a bare ampersand', S('R&D team').text === 'R\\&D team', S('R&D team').text)
check('escapes underscore and hash', S('a_b #1').text === 'a\\_b \\#1', S('a_b #1').text)
check('leaves an existing escape alone', S('40\\% growth').text === '40\\% growth', S('40\\% growth').text)
check('keeps allowed markup', S('used \\textbf{Kubernetes}').text === 'used \\textbf{Kubernetes}')
check('keeps the $|$ separator', S('A $|$ B').text === 'A $|$ B', S('A $|$ B').text)
check('converts markdown bold', S('used **Kubernetes**').text === 'used \\textbf{Kubernetes}', S('used **Kubernetes**').text)
check('escapes angle brackets (they typeset as inverted punctuation)',
  S('p95 <400ms').text === 'p95 \\textless{}400ms', S('p95 <400ms').text)
check('rejects unbalanced braces', !S('\\textbf{oops').ok)
check('rejects \\input (file read)', !S('x \\input{/etc/passwd}').ok)
check('rejects \\write18 (shell escape)', !S('x \\write18{rm -rf /}').ok)
check('rejects an unknown macro', !S('x \\dangerous{y}').ok)
check('folds a unicode em dash', S('a \u2014 b').text === 'a -- b', S('a \u2014 b').text)
check('folds a curly apostrophe', S('student\u2019s work').text === "student's work", S('student\u2019s work').text)
check('strips a zero-width space', S('Kuber\u200bnetes').text === 'Kubernetes', S('Kuber\u200bnetes').text)
check('escapes stray math dollar', S('costs $5').text === 'costs \\$5', S('costs $5').text)

// --------------------------------------------------------------- 5. applying
console.log('\n=== apply (gaurav.tex) ===')
const gsrc = fs.readFileSync(path.join(ROOT, 'resumes', 'gaurav.tex'), 'utf8')
const g = parseLatexResume(gsrc, 'g')
const target = g.editable.find((s) => s.macro === 'resumeItem' && s.text.includes('Retrieval-Augmented'))
check('found the RAG bullet', !!target)

const applied = applyLatexChanges(gsrc, [{
  original: target.text,
  proposed: 'Owned \\textbf{RAG} evaluation raising grounded accuracy by 30% for \\textbf{LangChain} pipelines',
}])
check('applied exactly one change', applied.applied === 1,
  JSON.stringify({ applied: applied.applied, unmatched: applied.unmatched.length, rejected: applied.rejected }))
check('percent got escaped on the way in', applied.latex.includes('by 30\\%'))
check('the new text is in the document', applied.latex.includes('Owned \\textbf{RAG} evaluation'))
check('the old text is gone', !applied.latex.includes(target.text))
check('result still validates', validateLatexDocument(applied.latex).length === 0,
  validateLatexDocument(applied.latex).join('; '))
check('only the splice region changed', Math.abs(applied.latex.length - gsrc.length) < 400)

const frozenAttempt = applyLatexChanges(gsrc, [{
  original: '[Role] Innodata | Senior Associate Engineer | Jun 2026 -- Present | Noida, India',
  proposed: 'Something Else Entirely',
}])
check('cannot rewrite a [Role] line',
  frozenAttempt.applied === 0 && frozenAttempt.unmatched.length === 1)

const evil = applyLatexChanges(gsrc, [{
  original: target.text,
  proposed: 'Legit looking text \\write18{calc.exe}',
}])
check('refuses a shell-escape proposal', evil.applied === 0 && evil.rejected.length === 1,
  JSON.stringify(evil.rejected))
check('refused proposal left the file untouched', evil.latex === gsrc)

const dup = applyLatexChanges(gsrc, [
  { original: target.text, proposed: 'First rewrite of the RAG bullet with enough length to pass' },
  { original: target.text, proposed: 'Second rewrite of the RAG bullet with enough length to pass' },
])
check('duplicate targets collapse to one edit',
  dup.applied === 1 && dup.overlapping.length === 1,
  JSON.stringify({ applied: dup.applied, overlapping: dup.overlapping.length }))

const three = g.editable.filter((s) => s.macro === 'resumeItem').slice(0, 3)
const multi = applyLatexChanges(gsrc, three.map((s, i) => ({
  original: s.text,
  proposed: 'Rewritten bullet number ' + i + ' carrying \\textbf{Kubernetes} and 9' + i + '\\% impact for the team',
})))
check('applies three changes at once', multi.applied === 3,
  JSON.stringify({ applied: multi.applied, unmatched: multi.unmatched }))
check('all three landed',
  [0, 1, 2].every((i) => multi.latex.includes('Rewritten bullet number ' + i)))
check('multi-splice still validates', validateLatexDocument(multi.latex).length === 0)
fs.writeFileSync(path.join(BUILD, 'applied.tex'), multi.latex)

// ------------------------------------------------------------ 6. fuzz corpus
console.log('\n=== sanitizer fuzz -> compilable .tex ===')

const INPUTS = [
  'Cut p95 latency by 40% and cost by 60%',
  'Led R&D across 3 teams & shipped 12 features',
  'Tuned model_config.json and issue #4213',
  'Used **LangChain** and **Pinecone** for `RAG` pipelines',
  'Wrote 100% test coverage \u2014 no regressions',
  'Delivered \\textbf{Kubernetes} rollouts at 99.9\\% uptime',
  'Costs dropped from $50k to $12k per month',
  'A ~5x speedup with x^2 scaling',
  'Curly \u201cquotes\u201d and \u2018apostrophes\u2019 and an ellipsis\u2026',
  'Non\u2011breaking\u00a0space and zero\u200bwidth junk',
  'Built C++ / C# / .NET integrations & REST APIs',
  'Achieved 93.1% accuracy (Decision Tree) and 90% (DNN)',
  'Split 67%\u201333% train/test with 96.1% F1',
  'Deployed to AWS S3 & EC2 \u2014 10K+ users',
  'Handled 50K+ transactions/day at <400ms p95 and >1k rps',
  'Used \\emph{LangGraph} with \\textbf{LLM-as-judge} rubrics',
  'Migrated 100_000 rows & re-indexed #primary',
  'Separator A $|$ B $|$ C stays intact',
  'Mixed **bold** with \\textbf{real bold} and 40% growth',
  'Trailing backslash issue \\',
]

const MUST_REJECT = [
  '\\input{/etc/passwd}',
  '\\write18{calc.exe}',
  '\\textbf{unbalanced',
  'closing } brace',
  '\\usepackage{tikz}',
  '\\def\\x{y}',
]

const accepted = []
let unexpectedRejects = 0
for (const raw of INPUTS) {
  const r = sanitizeLatexFragment(raw)
  if (!r.ok) {
    unexpectedRejects++
    console.log('  UNEXPECTED REJECT: ' + JSON.stringify(raw) + ' -> ' + r.problems.join('; '))
    continue
  }
  accepted.push(r.text)
}
check('every realistic model output was accepted', unexpectedRejects === 0)

let leaks = 0
for (const raw of MUST_REJECT) {
  if (sanitizeLatexFragment(raw).ok) {
    leaks++
    console.log('  LEAKED: ' + JSON.stringify(raw))
  }
}
check('nothing dangerous leaked through', leaks === 0)

// Reuse the real preamble so the macros are identical to production.
const template = fs.readFileSync(path.join(ROOT, 'resumes', 'gaurav.tex'), 'utf8')
const preamble = template.slice(0, template.indexOf('\\begin{document}'))
const fuzzDoc = preamble + '\\begin{document}\n' +
  '\\section{Sanitizer Output}\n\\resumeSubHeadingListStart\n' +
  '\\resumeSubheading{Fuzz Corp}{2026}{Engineer}{Nowhere}\n\\resumeItemListStart\n' +
  accepted.map((t) => '\\resumeItem{' + t + '}').join('\n') +
  '\n\\resumeItemListEnd\n\\resumeSubHeadingListEnd\n' +
  '\\section{Skill Lines}\n\\resumeSkillListStart\n' +
  accepted.slice(0, 6).map((t) => '\\skillLine{\\textbf{Cat:} ' + t + '}').join('\n') +
  '\n\\resumeSkillListEnd\n\\end{document}\n'

fs.writeFileSync(path.join(BUILD, 'fuzz.tex'), fuzzDoc)
check('fuzz document passes whole-document validation',
  validateLatexDocument(fuzzDoc).length === 0, validateLatexDocument(fuzzDoc).join('; '))
console.log('  wrote .pipeline-test/fuzz.tex (' + accepted.length + ' fragments) — compile it to verify typesetting')

// ---------------------------------------------------------- 7. evidence merge
console.log('\n=== evidence merge (gaurav.tex) ===')

const { mergeEvidenceChanges } = require(BUILD + '/lib/keyword-evidence')

{
  const profile = PROFILES.gaurav
  const src = fs.readFileSync(path.join(ROOT, 'resumes', profile.texFile), 'utf8')
  const [a, b] = parseLatexResume(src, 'resume').editable.filter((s) => s.macro === 'resumeItem')
  const change = (original, proposed, sectionTitle) => ({
    id: 'test_' + original.length + '_' + proposed.length,
    sectionId: '',
    sectionTitle,
    original,
    proposed,
    reason: '',
    type: 'rewrite',
    approved: true,
  })
  const addition = ' with \\textbf{RAG}'

  // A real rewrite restructures the sentence, so the matcher's "contains"
  // fallback can't quietly recover it — reversing the words has the same effect.
  const first = change(a.text, 'Reworked ' + a.text.split(' ').reverse().join(' '), a.sectionTitle)
  // The evidence prompt shows an already-rewritten bullet as its proposed text.
  const chained = change(first.proposed, a.text + addition, 'Other')
  const fresh = change(b.text, b.text + addition, b.sectionTitle)

  check('fixture fits the length rules',
    addition.length <= profile.length.maxGrowth(a.text.length),
    'addition ' + addition.length + ' > budget ' + profile.length.maxGrowth(a.text.length))
  check('an evidence change quoting rewritten text cannot apply on its own',
    applyLatexChanges(src, [chained]).unmatched.length === 1)

  const merged = mergeEvidenceChanges([first], [chained, fresh], profile.length)
  check('a chained rewrite replaces the earlier change', merged.length === 2, 'got ' + merged.length)
  check('a chained rewrite points back at the real source line', merged[0].original === a.text)
  check('a chained rewrite keeps the newer wording', merged[0].proposed === chained.proposed)
  check('a chained rewrite keeps the source section', merged[0].sectionTitle === a.sectionTitle)

  const applied = applyLatexChanges(src, merged)
  check('both merged changes splice into the .tex',
    applied.applied === 2 && applied.unmatched.length === 0,
    'applied ' + applied.applied + ', unmatched ' + applied.unmatched.length)

  const bloated = change(first.proposed, a.text + ' ' + 'x'.repeat(400), 'Other')
  check('a chained rewrite that breaks the length rules leaves the earlier one',
    mergeEvidenceChanges([first], [bloated], profile.length)[0].proposed === first.proposed)

  const repeat = change(b.text, b.text + ' twice', b.sectionTitle)
  check('a second rewrite of the same untouched bullet is dropped',
    mergeEvidenceChanges([], [fresh, repeat], profile.length).length === 1)
}

// ------------------------------------------------------------ 8. access roles
console.log('\n=== access roles ===')

const { parseOwnerEmails, roleForEmail, getAccess } = require(BUILD + '/lib/access')

{
  const OWNER = 'gaurav.chaudhary.865022@gmail.com'
  const defaults = parseOwnerEmails(undefined)
  const configured = parseOwnerEmails('a@x.com, B@Y.com')

  check('the platform owner is an owner by default', roleForEmail(OWNER, defaults) === 'owner')
  check('owner matching ignores case and surrounding spaces',
    roleForEmail('  Gaurav.Chaudhary.865022@Gmail.com ', defaults) === 'owner')
  check('any other account is a user', roleForEmail('someone@example.com', defaults) === 'user')
  check('a missing email is never an owner', roleForEmail(undefined, defaults) === 'user')
  check('OWNER_EMAILS replaces the default owner list',
    roleForEmail('b@y.com', configured) === 'owner' && roleForEmail(OWNER, configured) === 'user')
  check('a blank OWNER_EMAILS falls back to the default owner',
    roleForEmail(OWNER, parseOwnerEmails('  , ')) === 'owner')
  check('no session means no access', getAccess(null) === null)
  check('a session without an email means no access', getAccess({ user: { name: 'x' } }) === null)
}

// ------------------------------------------------------- 9. structured render
console.log('\n=== structured resume -> house LaTeX ===')

const { renderResumeLatex, latexUrl } = require(BUILD + '/lib/import/render')
const { ResumeDocSchema } = require(BUILD + '/lib/resume-doc')
const { visible } = require(BUILD + '/lib/latex/match')

{
  const doc = ResumeDocSchema.parse({
    name: 'Zoë O’Connor-Smith',
    contact: {
      email: 'zoe.oc@example.com',
      phone: '+1 555 010 0199',
      location: 'Austin, TX',
      links: [
        { label: 'github.com/zoe_dev', url: 'https://github.com/zoe_dev?tab=repos#top' },
        { label: 'sneaky', url: 'javascript:alert(1)' },
      ],
    },
    summary: 'Ships 50% faster & cheaper: C#, a $5M budget, ~{braces}~, <p95> \\input{x} ^caret … — “quoted”',
    skills: [{ category: 'Languages & Tools:', items: ['C#', 'C++', 'Node.js', 'R&D', ''] }],
    experience: [
      {
        company: 'Acme_Corp & Co.',
        role: 'Senior Engineer',
        dates: 'Jan 2020 – Present',
        location: 'Remote',
        bullets: ['Cut p95 latency by 40% (from 1.8s to <400ms)', 'Owned a $2M budget, the #1 priority'],
        groups: [{ title: 'Client: Big Bank', bullets: ['Built ISO 20022 payment flows'] }],
      },
      { company: 'Empty Role Inc', role: 'Intern', bullets: [] },
    ],
    projects: [{ name: 'Resume Parser', url: 'example.com/a_b c', stack: 'TypeScript, Next.js', dates: '2024', bullets: ['Parsed 10k+ resumes'] }],
    education: [{ school: 'State University', degree: 'B.S. Computer Science', dates: '2016 – 2020', location: 'Austin, TX', details: ['GPA 3.9/4.0'] }],
    sections: [
      { title: 'Certifications', lines: ['AWS Solutions Architect – Associate'] },
      { title: 'Soft Skills', lines: ['Communication | Leadership'] },
      { title: 'Empty', lines: ['  '] },
    ],
  })

  const tex = renderResumeLatex(doc)
  fs.writeFileSync(path.join(BUILD, 'rendered.tex'), tex)
  check('the rendered document validates', validateLatexDocument(tex).length === 0, validateLatexDocument(tex).join('; '))

  const parsed = parseLatexResume(tex, doc.name)
  const titles = parsed.resume.sections.map((s) => s.title)
  check('every non-empty section is rendered',
    ['Summary', 'Technical Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Soft Skills'].every((t) => titles.includes(t)),
    titles.join(', '))
  check('empty sections are left out', !titles.includes('Empty'))
  check('all prose is editable: summary, a skill line, 3 bullets, a project, an education detail, 2 extra lines',
    parsed.editable.length === 9, 'got ' + parsed.editable.length)

  const lines = parsed.resume.sections.flatMap((s) => s.content)
  check('employer, project and client group are structural lines',
    lines.some((l) => l.startsWith('[Role] Acme_Corp & Co. | Senior Engineer')) &&
    lines.some((l) => l.startsWith('[Project] Resume Parser | TypeScript, Next.js')) &&
    lines.includes('[Group] Client: Big Bank'),
    lines.filter((l) => l.startsWith('[')).join(' | '))
  check('a role with no bullets opens no empty list', !/\\resumeItemListStart\s*\\resumeItemListEnd/.test(tex))
  check('special characters are escaped',
    ['40\\%', 'R\\&D', 'C\\#', '\\$2M', '\\textless{}400ms', '\\{braces\\}', '\\textbackslash{}input', 'Acme\\_Corp'].every((s) => tex.includes(s)))
  check('an imported \\input is only text', !/\\input\{x\}/.test(tex))
  check('every editable span is unchanged by the rewrite sanitizer',
    parsed.editable.every((s) => { const r = sanitizeLatexFragment(s.text); return r.ok && r.text === s.text }),
    parsed.editable.filter((s) => { const r = sanitizeLatexFragment(s.text); return !r.ok || r.text !== s.text }).map((s) => s.text.slice(0, 50)).join(' | '))
  check('a bullet still reads the same once markup is stripped',
    parsed.editable.some((s) => visible(s.text).includes('40% (from 1.8s to')))
  check('a javascript: link is not rendered as a link', !tex.includes('javascript') && tex.includes('sneaky'))
  check('a bare domain becomes an https link with escaped characters',
    latexUrl('example.com/a_b c') === 'https://example.com/a\\_b\\%20c', latexUrl('example.com/a_b c'))

  const bullet = parsed.editable.find((s) => s.text.startsWith('Cut p95'))
  const spliced = applyLatexChanges(tex, [{ original: bullet.text, proposed: 'Cut \\textbf{p95 latency} by 40% with caching' }])
  check('the existing splice pipeline rewrites a rendered bullet',
    spliced.applied === 1 && validateLatexDocument(spliced.latex).length === 0,
    JSON.stringify({ applied: spliced.applied, unmatched: spliced.unmatched.length, rejected: spliced.rejected }))

  check('a resume without a name is rejected', !ResumeDocSchema.safeParse({ name: '' }).success)
  check('a resume with only a name gets defaults', ResumeDocSchema.safeParse({ name: 'A' }).success)
}

// ------------------------------------------------------------------ 10. import
const { extractResumeText, tidyResumeText, ImportError } = require(BUILD + '/lib/import/extract')
const { parseStructureResponse, structureResume } = require(BUILD + '/lib/import/structure')

async function importTests() {
  console.log('\n=== import: extract text, then structure it ===')

  const FIXTURES = path.join(__dirname, 'fixtures')
  const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)))
  const utf8 = (s) => new TextEncoder().encode(s)

  const pdf = await extractResumeText({ name: 'resume.pdf', type: 'application/pdf', bytes: fixture('sample-resume.pdf') })
  check('a PDF resume yields its text',
    pdf.sourceFormat === 'pdf' && pdf.text.includes('Acme') && pdf.text.includes('Cut p95 latency'), pdf.text.slice(0, 80))

  const docx = await extractResumeText({ name: 'resume.docx', type: '', bytes: fixture('sample-resume.docx') })
  check('a Word resume yields its text',
    docx.sourceFormat === 'docx' && docx.text.includes('Senior Engineer') && docx.text.includes('$2M budget'), docx.text.slice(0, 80))

  const renamed = await extractResumeText({ name: 'resume.txt', type: 'text/plain', bytes: fixture('sample-resume.pdf') })
  check('a PDF with the wrong extension is still read as a PDF', renamed.sourceFormat === 'pdf')

  const tex = await extractResumeText({
    name: 'resume.tex', type: '', bytes: utf8(fs.readFileSync(path.join(BUILD, 'rendered.tex'), 'utf8')),
  })
  check('a LaTeX resume is reduced to its words',
    tex.sourceFormat === 'latex' && tex.text.includes('Resume Parser') && tex.text.includes('Cut p95 latency') &&
    !/\\[a-zA-Z]/.test(tex.text), tex.text.slice(0, 120))

  const hostile = await extractResumeText({
    name: 'evil.tex', type: '',
    bytes: utf8('\\documentclass{article}\\begin{document}\nJane Doe\n\\input{/etc/passwd} \\write18{rm -rf /}\n% hidden note\n\\end{document}'),
  })
  check('commands and comments in an uploaded .tex do not survive',
    !hostile.text.includes('\\') && !hostile.text.includes('hidden note') && hostile.text.startsWith('Jane Doe'),
    JSON.stringify(hostile.text))

  const text = await extractResumeText({ name: 'resume.md', type: 'text/markdown', bytes: utf8('  Jane Doe\r\n\r\n\r\n\r\nEngineer  ') })
  check('plain text is tidied', text.sourceFormat === 'text' && text.text === 'Jane Doe\n\nEngineer', JSON.stringify(text.text))

  const refuses = async (label, file, pattern) => {
    try {
      await extractResumeText(file)
      check(label, false, 'the upload was accepted')
    } catch (err) {
      check(label, err instanceof ImportError && pattern.test(err.message), err.message)
    }
  }
  await refuses('an old .doc file is refused with advice',
    { name: 'cv.doc', type: 'application/msword', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]) }, /\.doc/)
  await refuses('a zip that is not a .docx is refused',
    { name: 'cv.zip', type: 'application/zip', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]) }, /\.docx/)
  await refuses('an image is refused',
    { name: 'photo.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) }, /Upload a PDF/)
  await refuses('an empty file is refused', { name: 'cv.txt', type: 'text/plain', bytes: new Uint8Array() }, /empty/)
  await refuses('a file with no text is refused', { name: 'cv.txt', type: 'text/plain', bytes: utf8(' \n\t\n ') }, /No text/)
  await refuses('a damaged PDF is refused', { name: 'cv.pdf', type: 'application/pdf', bytes: utf8('%PDF-1.4 not really a pdf') }, /could not be read/)
  let tooLong = null
  try { tidyResumeText('a'.repeat(40_001)) } catch (err) { tooLong = err }
  check('text over the length limit is refused', tooLong instanceof ImportError && /limit/.test(tooLong.message))

  const validDoc = { name: 'Jane Doe', contact: { email: 'jane@example.com' }, experience: [{ company: 'Acme', role: 'Engineer', bullets: ['Built things'] }] }
  const fenced = parseStructureResponse('Here you go:\n```json\n' + JSON.stringify(validDoc) + '\n```')
  check('a fenced JSON reply is accepted, with defaults filled', fenced.ok && fenced.doc.name === 'Jane Doe' && fenced.doc.contact.phone === '')
  check('a reply that is not JSON is rejected', !parseStructureResponse('Sorry, I cannot help with that.').ok)
  const noName = parseStructureResponse(JSON.stringify({ ...validDoc, name: '' }))
  check('a reply without a name is rejected, naming the field',
    !noName.ok && noName.problems.some((p) => p.startsWith('name')), JSON.stringify(noName))
  const placeholder = parseStructureResponse(JSON.stringify({ ...validDoc, summary: '<summary or objective paragraph>' }))
  check('copied template placeholders are rejected', !placeholder.ok && /placeholder/.test(placeholder.problems[0]))
  check('real angle brackets in resume text are kept',
    parseStructureResponse(JSON.stringify({ ...validDoc, summary: 'Kept p95 <400ms' })).ok)

  const calls = []
  const replies = [JSON.stringify({ ...validDoc, name: '' }), JSON.stringify(validDoc)]
  const structured = await structureResume({
    text: 'Jane Doe\nEngineer at Acme',
    generate: async ({ prompt, temperature }) => { calls.push({ prompt, temperature }); return replies.shift() },
  })
  check('a rejected reply is retried once, with the problems fed back',
    structured.name === 'Jane Doe' && calls.length === 2 &&
    !calls[0].prompt.includes('REJECTED') && calls[1].prompt.includes('REJECTED') && calls[1].prompt.includes('name:'))
  check('structuring runs at temperature 0', calls.every((c) => c.temperature === 0))

  let gaveUp = null
  try { await structureResume({ text: 'Jane Doe', generate: async () => 'not json' }) } catch (err) { gaveUp = err }
  check('two unusable replies give up with an explanation',
    gaveUp instanceof Error && /could not turn this resume/.test(gaveUp.message))
}

function summary() {
  console.log('\n' + '='.repeat(46))
  console.log('  ' + pass + ' passed, ' + fail + ' failed')
  console.log('='.repeat(46))
  process.exit(fail === 0 ? 0 : 1)
}

// --------------------------------------------------------------- 11. tailoring
const {
  addMissingKeywords,
  extractJdKeywords,
  keywordCoverage,
  mentionsKeyword,
  parseKeywordResponse,
} = require(BUILD + '/lib/tailor/keywords')
const {
  capBulletChanges,
  dropFrozenSectionChanges,
  editableLines,
  findGroupGaps,
  labelSections,
  snapToLines,
} = require(BUILD + '/lib/tailor/guards')
const { LEVELS } = require(BUILD + '/lib/tailor/levels')
const { standardProfile } = require(BUILD + '/lib/profiles/standard')
const { runOptimization } = require(BUILD + '/lib/run-optimization')
const { buildOptimizeSystemInstruction } = require(BUILD + '/lib/optimizer')

async function tailorTests() {
  console.log('\n=== tailoring: keywords, levels and the guarantee ===')

  const kw = (term, extra = {}) => ({ term, kind: 'skill', required: true, aliases: [], ...extra })
  const has = (text, term, extra) => mentionsKeyword(text, kw(term, extra))

  check('Node.js matches NodeJS and Node JS, and the other way round',
    has('Built NodeJS services', 'Node.js') && has('Built Node JS services', 'Node.js') && has('Built Node.js services', 'NodeJS'))
  check('CI/CD matches CICD', has('Owned the CICD pipeline', 'CI/CD'))
  check('C++ is found as a whole term', has('Wrote C++ drivers', 'C++'))
  check('Java is not found inside JavaScript', !has('Wrote JavaScript for the web', 'Java'))
  check('Go is not found in go-to-market, but is in Go services',
    !has('Led the go-to-market plan', 'Go') && has('Wrote Go services', 'Go'))
  check('singular and plural match', has('Designed REST APIs', 'REST API'))
  check('an alias counts', has('Ran K8s clusters', 'Kubernetes', { aliases: ['K8s'] }))

  const doc = ResumeDocSchema.parse({
    name: 'Sam Rivera',
    summary: 'Backend engineer building reliable payment systems.',
    skills: [
      { category: 'Languages', items: ['Python', 'Java'] },
      { category: 'Tools & Cloud', items: ['Docker', 'AWS'] },
    ],
    experience: [
      {
        company: 'Payco', role: 'Software Engineer', dates: '2021 – Present',
        bullets: [
          'Built payment APIs in Python serving 2M requests a day',
          'Cut deploy time by 40% by containerizing services with Docker',
          'Mentored three junior engineers through code reviews',
        ],
      },
      {
        company: 'Shopster', role: 'Junior Developer', dates: '2019 – 2021',
        bullets: [
          'Maintained checkout services and fixed production incidents',
          'Wrote integration tests that caught regressions before release',
        ],
      },
    ],
    education: [{ school: 'State University', degree: 'B.S. Computer Science', details: ['Graduated with honours in distributed systems'] }],
  })
  const tex = renderResumeLatex(doc)
  const resume = parseLatexResume(tex, doc.name).resume
  const profile = standardProfile('hard')
  const keywords = [
    kw('Kubernetes', { kind: 'tool' }),
    kw('Terraform', { kind: 'tool' }),
    kw('Python'),
    kw('Docker', { kind: 'tool' }),
    kw('Kafka', { kind: 'tool', required: false }),
  ]
  const statusOf = (coverage, term) => coverage.statuses.find((s) => s.keyword.term === term).status
  const experience = resume.sections.find((s) => s.title === 'Experience').content
  const bullet = experience.find((l) => l.startsWith('Cut deploy time'))
  const mentored = experience.find((l) => l.startsWith('Mentored'))
  const maintained = experience.find((l) => l.startsWith('Maintained'))
  const eduLine = resume.sections.find((s) => s.title === 'Education').content.find((l) => l.startsWith('Graduated'))

  const before = keywordCoverage(resume, keywords)
  check('a keyword in a bullet is covered', statusOf(before, 'Docker') === 'covered' && statusOf(before, 'Python') === 'covered')
  check('keywords the resume lacks are missing', statusOf(before, 'Kubernetes') === 'missing' && statusOf(before, 'Terraform') === 'missing')
  check('the score counts required keywords double',
    before.requiredTotal === 4 && before.requiredPresent === 2 && before.score === Math.round((4 / 9) * 100),
    JSON.stringify({ required: before.requiredPresent + '/' + before.requiredTotal, score: before.score }))

  const change = {
    id: 'c1', sectionId: '', sectionTitle: 'Experience', original: bullet,
    proposed: 'Cut deploy time by 40\\% by moving services to \\textbf{Kubernetes}',
    reason: '', type: 'rewrite', approved: null,
  }
  const after = keywordCoverage(resume, keywords, [change])
  check('coverage reads the resume as the changes leave it',
    statusOf(after, 'Kubernetes') === 'covered' && statusOf(after, 'Docker') === 'skills_only',
    JSON.stringify(after.statuses.map((s) => [s.keyword.term, s.status])))

  const facts = dropFrozenSectionChanges(resume, [change, { ...change, id: 'c2', original: eduLine, proposed: 'Graduated with honours in Kubernetes' }], profile.coverage)
  check('a change to an education line is dropped', facts.kept.length === 1 && facts.dropped.length === 1 && facts.dropped[0].id === 'c2')

  const bulletChange = (id, original) => ({ ...change, id, original, proposed: original + ' using \\textbf{Kafka}' })
  const capped = capBulletChanges(resume, [bulletChange('a', bullet), bulletChange('b', mentored), bulletChange('c', maintained)], standardProfile('soft').coverage, 1)
  check('soft keeps at most one bullet change per role', capped.kept.map((c) => c.id).join(',') === 'a,c', capped.kept.map((c) => c.id).join(','))

  const lines = editableLines(resume, [change], profile.coverage)
  check('editable lines read as rewritten and leave out facts and headings',
    lines.some((l) => l.text.includes('Kubernetes')) && !lines.some((l) => l.text.startsWith('Graduated')) && !lines.some((l) => l.text.startsWith('[')))
  check('a copied list marker in "original" is forgiven', snapToLines([{ ...change, original: '- ' + maintained }], lines)[0].original === maintained)

  const fallback = addMissingKeywords(resume, [change], [kw('Terraform', { kind: 'tool' }), kw('Site Reliability Engineer', { kind: 'title' })], profile.coverage)
  const toolsChange = fallback.changes.find((c) => c.original.includes('Tools'))
  const summaryChange = fallback.changes.find((c) => c.sectionTitle === 'Summary')
  check('a missing tool is appended to the tools line',
    Boolean(toolsChange) && toolsChange.proposed.endsWith('Terraform') && toolsChange.type === 'add_keywords', toolsChange && toolsChange.proposed)
  check('a missing job title goes into the summary',
    Boolean(summaryChange) && summaryChange.proposed.includes('Site Reliability Engineer'), summaryChange && summaryChange.proposed)

  const prose = addMissingKeywords(resume, [], [kw('incident response', { kind: 'responsibility' })], profile.coverage)
  check('a missing responsibility is written into the summary, not a tools line',
    prose.changes.length === 1 && prose.changes[0].sectionTitle === 'Summary' &&
    /experienced in incident response/i.test(prose.changes[0].proposed),
    JSON.stringify(prose.changes.map((c) => [c.sectionTitle, c.proposed])))

  const groupGaps = findGroupGaps(resume, [change], profile.coverage, LEVELS.hard.bulletsOwed)
  check('hard owes two rewrites under every role, counted per role',
    groupGaps.length === 2 &&
    groupGaps[0].required === 2 && groupGaps[0].have === 1 && groupGaps[0].sectionTitle.includes('Payco') &&
    groupGaps[1].required === 2 && groupGaps[1].have === 0 && groupGaps[1].sectionTitle.includes('Shopster'),
    JSON.stringify(groupGaps.map((g) => [g.sectionTitle, g.have, g.required])))
  check('soft owes no rewrites, and hardest owes every bullet',
    findGroupGaps(resume, [], profile.coverage, LEVELS.soft.bulletsOwed).length === 0 &&
    findGroupGaps(resume, [change], profile.coverage, LEVELS.hardest.bulletsOwed).reduce((n, g) => n + g.required, 0) === 5)
  check('changes are labelled with the section their line is really in',
    labelSections(resume, [{ ...change, sectionId: 'x', sectionTitle: 'Wrong' }])[0].sectionTitle === 'Experience')
  const spliced = applyLatexChanges(tex, fallback.changes.map((c) => ({ original: c.original, proposed: c.proposed })))
  check('the fallback changes splice cleanly into the .tex',
    spliced.applied === fallback.changes.length && validateLatexDocument(spliced.latex).length === 0,
    JSON.stringify({ applied: spliced.applied, unmatched: spliced.unmatched, rejected: spliced.rejected }))
  check('after the fallback no required keyword is missing',
    keywordCoverage(resume, [kw('Terraform', { kind: 'tool' }), kw('Kubernetes', { kind: 'tool' })], fallback.changes).statuses.every((s) => s.status !== 'missing'))

  const bare = parseLatexResume(renderResumeLatex(ResumeDocSchema.parse({
    name: 'No Lines', experience: [{ company: 'X', role: 'Y', bullets: ['Did one solid thing for a long while'] }],
  })), 'bare').resume
  check('with no skills line or summary a keyword is reported, not forced into a bullet',
    addMissingKeywords(bare, [], [kw('Terraform')], profile.coverage).unplaced[0] === 'Terraform')

  const cleaned = parseKeywordResponse('```json\n' + JSON.stringify({
    jobTitle: 'Backend Engineer',
    keywords: [{ term: 'Kafka', kind: 'queue', required: 'yes' }, { term: 'kafka' }, { term: '<keyword exactly as the job description writes it>' }],
  }) + '\n```')
  check('keyword replies are cleaned: unknown kinds default, duplicates and placeholders go',
    cleaned.ok && cleaned.value.keywords.length === 1 && cleaned.value.keywords[0].kind === 'skill' && cleaned.value.keywords[0].required === true,
    JSON.stringify(cleaned))
  check('a keyword reply with no keywords is rejected', !parseKeywordResponse(JSON.stringify({ keywords: [] })).ok)

  const keywordCalls = []
  const keywordReplies = ['not json', JSON.stringify({ jobTitle: 'X', keywords: [{ term: 'Go', required: true }] })]
  const extracted = await extractJdKeywords({
    jobDescription: 'We need Go.',
    generate: async ({ prompt, temperature }) => { keywordCalls.push({ prompt, temperature }); return keywordReplies.shift() },
  })
  check('keyword extraction retries once, explaining the problem, at temperature 0',
    extracted.keywords[0].term === 'Go' && keywordCalls.length === 2 &&
    keywordCalls[1].prompt.includes('REJECTED') && keywordCalls.every((c) => c.temperature === 0))

  // A full hard run with a scripted model: the first pass rewrites one bullet and
  // tries to edit education; every follow-up pass returns nothing.
  const calls = []
  const scripted = async ({ systemInstruction, prompt, temperature }) => {
    calls.push({ systemInstruction, prompt, temperature })
    if (prompt.includes('## MISSING REQUIRED KEYWORDS') || prompt.includes('under-delivered') || prompt.includes('## THE PROBLEM')) {
      return JSON.stringify({ changes: [] })
    }
    return JSON.stringify({
      summary: 'Aligned with the platform role', companyName: 'Acme', keywordsAdded: ['Kubernetes'], sectionsModified: ['Experience'],
      changes: [
        { sectionId: 'section_2', sectionTitle: 'Experience', original: bullet, proposed: 'Cut deploy time by 40\\% by moving services to \\textbf{Kubernetes} with Docker', reason: 'Kubernetes', type: 'rewrite' },
        { sectionId: 'section_3', sectionTitle: 'Education', original: eduLine, proposed: 'Graduated with honours in Kubernetes and Terraform', reason: 'x', type: 'rewrite' },
      ],
    })
  }
  const result = await runOptimization({
    mode: 'optimize', level: 'hard', keywords: { jobTitle: 'Platform Engineer', company: '', keywords },
    profile, resume, jobDescription: 'Platform role: Kubernetes, Terraform, Python and Docker.',
    hardInstructions: '', softInstructions: '', provider: 'openrouter', generate: scripted,
  })
  const final = keywordCoverage(resume, keywords, result.changes)
  check('a tailoring run never returns a change to education', !result.changes.some((c) => c.original === eduLine))
  check('a tailoring run leaves no required keyword missing',
    final.statuses.every((s) => !s.keyword.required || s.status !== 'missing'),
    JSON.stringify(final.statuses.map((s) => [s.keyword.term, s.status])))
  check('the run reports the keywords and the starting coverage',
    Boolean(result.keywordReport) && result.keywordReport.jobTitle === 'Platform Engineer' && result.keywordReport.before.requiredPresent === 2)
  check('the tailoring prompt names the level and the required keywords',
    calls[0].systemInstruction.includes('TAILORING LEVEL: HARD') && calls[0].prompt.includes('- Terraform') && calls[0].temperature === 0.25)
  check('the keyword pass asked the model before falling back', calls.some((c) => c.prompt.includes('## MISSING REQUIRED KEYWORDS')))

  const ownerCalls = []
  const ownerResult = await runOptimization({
    mode: 'optimize', profile: PROFILES.gaurav, resume, jobDescription: 'A backend role with Python.',
    hardInstructions: '', softInstructions: '', provider: 'openrouter',
    generate: async (args) => { ownerCalls.push(args); return JSON.stringify({ changes: [] }) },
  })
  check("the owner's optimize flow still sends its own prompt, and no keyword pass runs",
    ownerCalls[0].systemInstruction === buildOptimizeSystemInstruction(PROFILES.gaurav) && ownerCalls[0].temperature === 0.2 &&
    !ownerCalls.some((c) => c.prompt.includes('MISSING REQUIRED KEYWORDS')) && ownerResult.keywordReport === undefined)
}

// ----------------------------------------------------------------- 12. billing
const signatures = require(BUILD + '/lib/billing/signatures')
const quota = require(BUILD + '/lib/billing/quota')
const { readWebhookEvent } = require(BUILD + '/lib/billing/events')
const plans = require(BUILD + '/lib/billing/plans')
const billingConfig = require(BUILD + '/lib/billing/config')

function billingTests() {
  console.log('\n=== billing: signatures, included runs and webhooks ===')

  // The expected digests were computed with openssl, not with the code under test:
  //   printf '%s' 'order_9A33XWu170gUtm|pay_29QQoUBi66xm2f' | openssl dgst -sha256 -hmac test_key_secret
  //   printf '%s' 'pay_29QQoUBi66xm2f|sub_00000000000001' | openssl dgst -sha256 -hmac test_key_secret
  //   printf '%s' '{"entity":"event","event":"payment.captured"}' | openssl dgst -sha256 -hmac test_webhook_secret
  const KEY = 'test_key_secret'
  const HOOK_KEY = 'test_webhook_secret'
  const order = {
    orderId: 'order_9A33XWu170gUtm', paymentId: 'pay_29QQoUBi66xm2f',
    signature: '05a90d99a226250bdd07dcbec806d936d0ac974af71513b19a36466e7f5eb3a3',
  }
  const sub = {
    subscriptionId: 'sub_00000000000001', paymentId: 'pay_29QQoUBi66xm2f',
    signature: '945d4db9fb1ee2774fad526e78a9f6b85b6d296385c522fd155fc92f6ee7bd69',
  }
  const hookBody = '{"entity":"event","event":"payment.captured"}'
  const hookSignature = 'a438afc6ce7006ee9db518386b03fa11af0ca64eee8a8978885697e4065e9581'

  check('an order payment signature matches the openssl digest', signatures.verifyOrderPayment(order, KEY))
  check('an order signature fails under another secret or for another payment',
    !signatures.verifyOrderPayment(order, 'other_secret') && !signatures.verifyOrderPayment({ ...order, paymentId: 'pay_somethingelse' }, KEY))
  check('a subscription signature puts the payment id first',
    signatures.verifySubscriptionPayment(sub, KEY) &&
    !signatures.verifySubscriptionPayment({ ...sub, signature: signatures.hmacSha256Hex(KEY, sub.subscriptionId + '|' + sub.paymentId) }, KEY))
  check('a webhook signature covers the raw body, as text or as bytes',
    signatures.verifyWebhook(hookBody, hookSignature, HOOK_KEY) && signatures.verifyWebhook(Buffer.from(hookBody), hookSignature, HOOK_KEY))
  check('a re-serialised or altered body fails',
    !signatures.verifyWebhook(JSON.stringify(JSON.parse(hookBody), null, 2), hookSignature, HOOK_KEY) &&
    !signatures.verifyWebhook(hookBody.replace('captured', 'failed'), hookSignature, HOOK_KEY))
  check('short, empty or missing signatures and secrets fail without throwing',
    !signatures.verifyWebhook(hookBody, 'abc', HOOK_KEY) && !signatures.verifyWebhook(hookBody, '', HOOK_KEY) &&
    !signatures.verifyWebhook(hookBody, hookSignature, '') && !signatures.verifyOrderPayment({ ...order, signature: '' }, KEY))

  const state = (subscription, free, credits) => ({ subscription, free, credits })
  check('a run spends Pro runs first, then free runs, then credits',
    quota.runSources(state({ used: 0, limit: 100 }, { used: 0, limit: 5 }, 3)).join() === 'subscription,free,credits')
  check('sources with nothing left are skipped',
    quota.runSources(state({ used: 100, limit: 100 }, { used: 5, limit: 5 }, 2)).join() === 'credits' &&
    quota.runSources(state(null, { used: 5, limit: 5 }, 0)).length === 0)
  check('runs left adds every source up, and an overdrawn source counts as none',
    quota.runsLeft(state({ used: 98, limit: 100 }, { used: 7, limit: 5 }, 4)) === 6)

  const lateSeptember = new Date('2026-09-30T23:30:00Z')
  check('counters are per UTC month and start again on the 1st',
    quota.buckets.freeRuns(lateSeptember) === 'runs:2026-09' &&
    quota.nextMonthStart(lateSeptember).toISOString() === '2026-10-01T00:00:00.000Z' &&
    quota.nextMonthStart(new Date('2026-12-15T12:00:00Z')).toISOString() === '2027-01-01T00:00:00.000Z')
  check('a renewal starts a fresh Pro counter',
    quota.buckets.subscriptionRuns('sub_1', new Date('2026-09-01T00:00:00Z'), lateSeptember) !==
    quota.buckets.subscriptionRuns('sub_1', new Date('2026-10-01T00:00:00Z'), lateSeptember))

  const cycleEnd = new Date('2026-10-01T00:00:00Z')
  const entitles = (status, at) => quota.subscriptionEntitles({ status, currentEnd: cycleEnd }, new Date(at))
  check('active and retrying plans give runs; unpaid, halted and cancelled ones do not',
    entitles('active', '2026-09-20T00:00:00Z') && entitles('pending', '2026-09-20T00:00:00Z') &&
    ['created', 'authenticated', 'halted', 'cancelled', 'completed', 'expired', 'paused'].every((s) => !entitles(s, '2026-09-20T00:00:00Z')))
  check('a plan still counts for three days past its cycle, while a late renewal arrives, then stops',
    entitles('active', '2026-10-03T23:00:00Z') && !entitles('active', '2026-10-04T01:00:00Z'))
  check('paying accounts get the higher import limit', quota.importLimit(true) > quota.importLimit(false))

  const captured = readWebhookEvent({
    entity: 'event', event: 'payment.captured', created_at: 1757700000, contains: ['payment'],
    payload: { payment: { entity: { id: 'pay_A1', entity: 'payment', amount: 9900, currency: 'INR', status: 'captured', order_id: 'order_B2', notes: [] } } },
  })
  check('payment.captured is read as a payment for its order',
    captured.kind === 'order_payment' && captured.payment.orderId === 'order_B2' && captured.payment.amount === 9900, JSON.stringify(captured))

  const charged = readWebhookEvent({
    entity: 'event', event: 'subscription.charged', created_at: 1757700000,
    payload: {
      subscription: { entity: { id: 'sub_C3', plan_id: 'plan_D4', status: 'active', current_start: 1757700000, current_end: 1760292000, notes: { user_id: 'google-123' } } },
      payment: { entity: { id: 'pay_E5', amount: 19900, currency: 'INR', status: 'captured', order_id: 'order_F6' } },
    },
  })
  check('subscription.charged carries the state, the cycle, the account and the payment',
    charged.kind === 'subscription' && charged.subscription.status === 'active' && charged.subscription.userId === 'google-123' &&
    charged.subscription.currentEnd.getTime() === 1760292000 * 1000 && charged.payment !== null && charged.payment.id === 'pay_E5' &&
    charged.eventAt.getTime() === 1757700000 * 1000, JSON.stringify(charged))

  const garbled = readWebhookEvent({
    event: 'subscription.charged', created_at: 1757700000,
    payload: { subscription: { entity: { id: 'sub_C3', plan_id: 'plan_D4', status: 'active', notes: [] } }, payment: { entity: { id: 42 } } },
  })
  check('a malformed payment does not hide the subscription update, and empty notes name no account',
    garbled.kind === 'subscription' && garbled.payment === null && garbled.subscription.userId === null, JSON.stringify(garbled))
  check('other events, orderless payments and junk are ignored',
    readWebhookEvent({ event: 'refund.created', created_at: 1, payload: {} }).kind === 'ignore' &&
    readWebhookEvent('nonsense').kind === 'ignore' && readWebhookEvent(null).kind === 'ignore' &&
    readWebhookEvent({ event: 'payment.captured', created_at: 1, payload: { payment: { entity: { id: 'pay_1', amount: 1, currency: 'INR', status: 'captured' } } } }).kind === 'ignore')

  check('prices show as rupees', plans.formatPrice(9900) === '₹99' && plans.formatPrice(24950) === '₹249.50',
    plans.formatPrice(9900) + ' / ' + plans.formatPrice(24950))
  check('every pack has a unique id it can be found by',
    new Set(plans.CREDIT_PACKS.map((p) => p.id)).size === plans.CREDIT_PACKS.length &&
    plans.CREDIT_PACKS.every((p) => plans.findPack(p.id) === p) && plans.findPack('free_money') === undefined)

  const saved = { ...process.env }
  try {
    for (const name of ['NODE_ENV', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_PRO_PLAN_ID',
      'RAZORPAY_API_BASE', 'PLATFORM_AI_PROVIDER', 'PLATFORM_AI_MODEL', 'PLATFORM_AI_KEY', 'FREE_RUNS_PER_MONTH']) delete process.env[name]
    check('without Razorpay keys payments are off, and without a platform provider ResMod AI is off',
      billingConfig.razorpayConfig() === null && billingConfig.platformAiConfig() === null)

    Object.assign(process.env, { RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_API_BASE: 'http://localhost:4010/v1/' })
    const local = billingConfig.razorpayConfig()
    check('test keys are recognised, and a stand-in API is used outside production',
      local.testMode && local.apiBase === 'http://localhost:4010/v1' && local.webhookSecret === null && local.proPlanId === null, JSON.stringify(local))
    process.env.NODE_ENV = 'production'
    check('a stand-in API is never used in production', billingConfig.razorpayConfig().apiBase === 'https://api.razorpay.com/v1')

    process.env.PLATFORM_AI_PROVIDER = 'gemini'
    const keyless = billingConfig.platformAiConfig()
    Object.assign(process.env, { PLATFORM_AI_KEY: 'key', PLATFORM_AI_MODEL: 'gemini-2.5-flash' })
    const keyed = billingConfig.platformAiConfig()
    process.env.PLATFORM_AI_PROVIDER = 'puter'
    check('ResMod AI needs a key for a keyed provider, and is never the browser-only Puter',
      keyless === null && keyed !== null && keyed.model === 'gemini-2.5-flash' && billingConfig.platformAiConfig() === null)

    process.env.FREE_RUNS_PER_MONTH = 'lots'
    const junk = billingConfig.freeRunsPerMonth()
    process.env.FREE_RUNS_PER_MONTH = '0'
    check('FREE_RUNS_PER_MONTH can be 0, and junk falls back to the default',
      junk === plans.DEFAULT_FREE_RUNS_PER_MONTH && billingConfig.freeRunsPerMonth() === 0)
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]
    Object.assign(process.env, saved)
  }
}

importTests()
  .then(tailorTests)
  .then(billingTests)
  .then(summary, (err) => {
    check('the async tests ran to completion', false, err && err.stack)
    summary()
  })
