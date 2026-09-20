/**
 * The panel.
 *
 * It owns no logic worth the name: it asks the service worker for things and
 * draws the answers. Everything that needs the account's key happens there, so
 * a bug in here can leak nothing.
 *
 * The shape of the screen follows the decision being made. Standing on a job
 * posting the question is "is this worth an hour of my evening", so the score
 * is the biggest thing on it. Tailoring and email are handed to the app,
 * because both need a review screen that a 380-pixel panel has no business
 * pretending to have.
 */

const $ = (id) => document.getElementById(id)

const send = (kind, payload = {}) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ kind, payload }, (reply) => {
      const failed = chrome.runtime.lastError
      if (failed) return reject(new Error(failed.message))
      if (!reply?.ok) return reject(Object.assign(new Error(reply?.error ?? 'Something went wrong.'), { status: reply?.status }))
      resolve(reply.data)
    })
  })

const state = {
  session: null,
  job: null,
  saved: null,
  tab: null,
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function showError(message) {
  const box = $('error')
  box.textContent = message
  box.hidden = !message
}

function showView(name) {
  $('view-connect').hidden = name !== 'connect'
  $('view-job').hidden = name !== 'job'
}

function drawAccount() {
  const button = $('account')
  if (!state.session) {
    button.hidden = true
    $('quota').textContent = ''
    return
  }
  button.hidden = false
  button.textContent = 'Disconnect'
  const { runsLeft, paying } = state.session.quota
  $('quota').textContent = paying ? `${runsLeft} tailorings left` : `${runsLeft} free tailorings left`
}

function drawResumes() {
  const select = $('resume')
  const resumes = state.session?.resumes ?? []
  select.innerHTML = ''
  if (resumes.length === 0) {
    const option = document.createElement('option')
    option.textContent = 'No resumes yet — import one in Chills'
    option.value = ''
    select.append(option)
    select.disabled = true
    $('score').disabled = true
    return
  }
  select.disabled = false
  $('score').disabled = false
  for (const resume of resumes) {
    const option = document.createElement('option')
    option.value = resume.id
    option.textContent = resume.title
    select.append(option)
  }
}

function drawJob() {
  const job = state.job
  $('job').hidden = !job?.ok
  $('nojob').hidden = Boolean(job?.ok)
  if (!job?.ok) return

  $('job-title').textContent = job.title || 'This posting'
  $('job-company').textContent = [job.company, job.location].filter(Boolean).join(' · ')
  // Saying how it was read is not decoration: when a board changes its markup
  // and the text goes wrong, this line is what tells you which path to fix.
  $('job-source').textContent = `${job.source} · read from ${job.how === 'json-ld' ? 'the page’s own data' : job.how === 'adapter' ? 'the page layout' : 'the page text'}`
  $('save').textContent = state.saved ? 'Saved ✓' : 'Save job'
  $('save').disabled = Boolean(state.saved)
}

function drawScore(result) {
  $('result').hidden = false
  const value = $('score-value')
  value.textContent = result.score
  value.classList.toggle('low', result.score >= 45 && result.score < 70)
  value.classList.toggle('bad', result.score < 45)

  $('score-required').textContent = `${result.requiredPresent} of ${result.requiredTotal} required keywords`
  $('score-all').textContent = `${result.present} of ${result.total} in all`
  $('meter-fill').style.width = `${result.score}%`

  const missing = $('missing')
  missing.innerHTML = ''
  if (result.missing.length === 0) return
  const title = document.createElement('p')
  title.className = 'missing-title'
  title.textContent = 'Not in your resume yet'
  const chips = document.createElement('div')
  chips.className = 'chips'
  for (const entry of result.missing) {
    const chip = document.createElement('span')
    chip.className = `chip${entry.required ? ' required' : ''}`
    chip.textContent = entry.term
    chip.title = entry.status === 'skills_only' ? 'Listed under skills, but no bullet backs it' : 'Missing'
    chips.append(chip)
  }
  missing.append(title, chips)
}

// ── Doing ───────────────────────────────────────────────────────────────────

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

async function loadSession() {
  try {
    state.session = await send('session')
    drawAccount()
    drawResumes()
    showView('job')
    await readPage()
  } catch (err) {
    if (err.status === 401) {
      state.session = null
      drawAccount()
      showView('connect')
      return
    }
    showView('job')
    showError(err.message)
  }
}

async function readPage() {
  showError('')
  $('result').hidden = true
  state.job = null
  state.saved = null

  const tab = await currentTab()
  state.tab = tab
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $('job').hidden = true
    $('nojob').hidden = false
    $('permission').hidden = true
    return
  }

  try {
    const read = await send('read', { tabId: tab.id, url: tab.url })
    if (read.needsPermission) {
      $('permission').hidden = false
      $('permission-origin').textContent = read.origin
      $('job').hidden = true
      $('nojob').hidden = true
      return
    }
    $('permission').hidden = true
    state.job = read
    if (read.ok) {
      // Knowing it is already on the list turns "Save job" from a question
      // into a fact, which is the difference between one row and five.
      const found = await send('savedFor', { url: read.url }).catch(() => null)
      state.saved = found?.job ?? null
    }
    drawJob()
  } catch (err) {
    showError(err.message)
  }
}

async function ensureSaved() {
  if (state.saved) return state.saved
  const job = state.job
  const { job: saved } = await send('capture', {
    job: {
      url: job.url,
      source: job.source,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
    },
  })
  state.saved = saved
  drawJob()
  return saved
}

function busy(button, label) {
  const was = button.textContent
  button.disabled = true
  button.textContent = label
  return () => {
    button.disabled = false
    button.textContent = was
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

$('connect').addEventListener('click', async () => {
  const done = busy($('connect'), 'Connecting…')
  $('connect-error').hidden = true
  try {
    state.session = await send('connect')
    drawAccount()
    drawResumes()
    showView('job')
    await readPage()
  } catch (err) {
    $('connect-error').textContent = err.message
    $('connect-error').hidden = false
  } finally {
    done()
  }
})

$('account').addEventListener('click', async () => {
  await send('disconnect')
  state.session = null
  drawAccount()
  showView('connect')
})

$('grant').addEventListener('click', async () => {
  const { granted } = await send('grant', { url: state.tab?.url ?? '' })
  if (granted) await readPage()
})

$('reread').addEventListener('click', readPage)

$('score').addEventListener('click', async () => {
  const done = busy($('score'), 'Reading the job…')
  showError('')
  try {
    // Saving first means the number has somewhere to live, so the saved list
    // can be ranked by fit later without paying to read the job again.
    const saved = await ensureSaved()
    const result = await send('score', {
      resumeId: $('resume').value,
      jobDescription: state.job.description,
      jobId: saved?.id,
    })
    drawScore(result)
  } catch (err) {
    showError(err.message)
  } finally {
    done()
  }
})

$('save').addEventListener('click', async () => {
  const done = busy($('save'), 'Saving…')
  showError('')
  try {
    await ensureSaved()
  } catch (err) {
    showError(err.message)
  } finally {
    done()
    drawJob()
  }
})

for (const [id, where] of [
  ['tailor', 'tailor'],
  ['outreach', 'outreach'],
]) {
  $(id).addEventListener('click', async () => {
    const done = busy($(id), 'Opening…')
    showError('')
    try {
      const saved = await ensureSaved()
      await send('openInChills', { jobId: saved.id, where })
    } catch (err) {
      showError(err.message)
    } finally {
      done()
    }
  })
}

// Opens the list of everything saved, not a job: there is no one job here to
// mean. It used to send an empty id at the tailor screen, which the app threw
// away, so the button opened a dashboard and did nothing it said.
$('open-saved').addEventListener('click', () => send('openInChills', { where: 'jobs' }).catch(() => {}))

// Following the user between tabs is the whole point of a side panel: the
// posting on screen and the panel beside it must be the same job.
chrome.tabs.onActivated.addListener(() => {
  if (state.session) readPage()
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete' && state.session && tabId === state.tab?.id) readPage()
})

loadSession()
