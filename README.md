# ResMod — ATS Resume Optimizer

Your resume is a LaTeX file in [resumes/](resumes/). Paste a job description and
the app parses that `.tex` into sections, asks an LLM for ATS-targeted rewrites,
lets you approve each change in a diff view, then splices the approved changes
into a **copy** of the LaTeX — the source file is never written to. Download the
`.tex`, open it in Overleaf, or compile it to PDF in one click.

## The resume is the source of truth

Each profile owns one file under `resumes/`. To change the base resume, edit that
file and reload the app.

The parser only offers the model text that lives inside one of three macros, so
anything you add must use them:

| Macro | Holds | Editable? |
| --- | --- | --- |
| `esumeSummary{...}` | the summary paragraph | yes |
| `\skillLine{...}` | one skills line | yes |
| `esumeItem{...}` | one bullet point | yes |
| `esumeSubheading{}{}{}{}` | employer, dates, role, location | **frozen** |
| `esumeProjectHeading{}{}` | project title, link, stack | **frozen** |
| `esumeGroupHeading{...}` | a client engagement inside one employer | **frozen** |

Frozen lines are still shown to the model — tagged `[Role]`, `[Project]`,
`[Group]` — so it knows which job a bullet belongs to, but any change targeting
one is discarded. Rewriting them would invent an employer or client.

Two safety layers sit between the model and the file. Rewrites are spliced into
the exact byte range of a macro argument rather than search-and-replaced, so a
sentence that appears twice cannot be edited in the wrong place. And every
fragment goes through an allow-list sanitizer that escapes `% & _ # < >`,
converts stray markdown to `	extbf{}`, and rejects anything containing a macro
outside a small formatting set — a job description is untrusted input, and
`\input` or `\write18` in a rewritten bullet would mean file or shell access at
compile time.

Run `npm run test:latex` after editing a template. It parses both resumes,
exercises the matcher, sanitizer and splicer, and writes a fuzz corpus to
`.pipeline-test/fuzz.tex` you can compile to confirm nothing breaks typesetting.

## Getting the PDF

No LaTeX install is assumed, so there are three routes:

- **Download .tex** — nothing leaves your machine. Compile it however you like.
- **Open in Overleaf** — posts the document to overleaf.com as a new project.
- **Compile PDF** — posts it to a LaTeX service (default `texlive.net`) and
  returns the PDF. Set `LATEX_COMPILE_URL` to point at your own texlive CGI.

The last two send your resume to a third party, so neither happens
automatically — only on an explicit click.

## Getting Started

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill it in, then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI providers

Eight providers are supported, all with a free path. **OpenRouter is the
default.** Switch providers any time from the **Settings** dialog (gear icon in
the header).

| Provider | Key needed | Env var | Free tier | Get a key |
| --- | --- | --- | --- | --- |
| OpenRouter (default) | yes | `OPENROUTER_API_KEY` | many `:free` models | <https://openrouter.ai/keys> |
| Gemini | yes | `GEMINI_API_KEY` | daily request limits | <https://aistudio.google.com/apikey> |
| SambaNova | yes | `SAMBANOVA_API_KEY` | free with rate limits | <https://cloud.sambanova.ai> |
| Puter | **no** | — | free allowance, then user-pays | — |
| Cerebras | yes | `CEREBRAS_API_KEY` | strict per-minute token limits | <https://cloud.cerebras.ai> |
| Groq | yes | `GROQ_API_KEY` | generous daily limits | <https://console.groq.com/keys> |
| Mistral | yes | `MISTRAL_API_KEY` | free "Experiment" tier | <https://console.mistral.ai/api-keys> |
| Ollama | **no** | — | completely free, local | <https://ollama.com/download> |

Keys are stored **per provider**, so switching providers never clobbers another
key. Resolution order per request: **Settings value → provider env var → error.**
Keys entered in Settings live in your browser's localStorage and are never
persisted server-side.

Everything is added through one registry — [lib/providers.ts](lib/providers.ts).
Adding another OpenAI-compatible provider is a single entry there.

### The two that need no key

**Puter** runs in your browser via `puter.js`. There is no API key: you sign in
to your own Puter account once (button in Settings) and usage bills to that
account. Because of that, when Puter is selected the prompt building, the model
call, and the response parsing all happen client-side — the request never
touches the server. The prompt modules are dynamically imported so they only
load for users who actually pick Puter.

**Ollama** talks to a model running on your own machine. Install Ollama, run
`ollama pull llama3.1`, and whatever you've pulled shows up in the model picker.
Set `OLLAMA_BASE_URL` if it isn't on the default port.

### Picking a model

Every provider gets the same picker: live catalogue, search, a "Free only"
filter, a curated shortlist on top, and a box to paste any model id. **Test
connection** validates the key and confirms the selected model exists before you
spend a real run on it.

The resume prompts are large (full resume + job description + a long system
prompt) and the response must be strict JSON, so prefer models with 32K+ context.
The adapter handles the rough edges automatically: it retries without JSON mode
for models that don't support `response_format`, retries without `max_tokens` for
models that cap completions lower, backs off on 429s, and repairs truncated JSON
where it can.

Providers retire model ids regularly — the built-in shortlists are only offline
fallbacks. The live picker is always the source of truth.

## Environment variables

See `.env.example` for the full list. Beyond the AI keys you need Google OAuth
credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), plus `NEXTAUTH_SECRET`
and `NEXTAUTH_URL`. Google is used for **sign-in only** — the app requests just
the `openid`, `email` and `profile` scopes and never touches Docs or Drive.
`LATEX_COMPILE_URL` is optional and only affects the Compile PDF button.

## Project layout

```
app/api/optimize      ATS keyword optimization run
app/api/revamp        aggressive full-resume rewrite
app/api/ai/models     proxies each provider's model catalogue for the picker
app/api/ai/test       validates a key/model without spending tokens
app/api/resume/load   read a profile's .tex and parse it into sections
app/api/resume/apply  splice approved changes into a copy of the .tex
app/api/resume/compile  optional PDF build via an external LaTeX service
resumes/*.tex         the resumes themselves — the source of truth
lib/latex/parse.ts    .tex -> sections + the byte ranges that may be edited
lib/latex/match.ts    resolves a model's quote back to one editable span
lib/latex/sanitize.ts escaping + the macro allow-list
lib/latex/apply.ts    the splice, plus whole-document validation
lib/profiles/*.ts     per-resume layout rules (which sections are frozen, quotas)
lib/providers.ts      the provider registry — add new providers here
lib/ai-provider.ts    server dispatch: one OpenAI-compatible adapter + Gemini
lib/puter.ts          browser-side Puter client (no API key)
lib/json-repair.ts    tolerant JSON extraction, shared by server and browser
lib/optimizer.ts      optimize prompt + response validation (client-safe)
lib/revamper.ts       revamp prompt + response validation (client-safe)
lib/settings-storage.ts  per-provider keys and models in localStorage
scripts/latex-pipeline-test.js  npm run test:latex
```
