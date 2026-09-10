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

console.log('\n' + '='.repeat(46))
console.log('  ' + pass + ' passed, ' + fail + ' failed')
console.log('='.repeat(46))
process.exit(fail === 0 ? 0 : 1)
