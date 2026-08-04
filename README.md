# ResMod — ATS Resume Optimizer

Paste a Google Docs resume link and a job description. The app copies the doc
(your original is never touched), parses it into sections, asks an LLM for
ATS-targeted rewrites, lets you approve each change in a diff view, then writes
the approved changes back into the copy and can export it as a PDF.

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
credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) with the Docs and Drive
scopes enabled, plus `NEXTAUTH_SECRET` and `NEXTAUTH_URL`.

## Project layout

```
app/api/optimize      ATS keyword optimization run
app/api/revamp        aggressive full-resume rewrite
app/api/ai/models     proxies each provider's model catalogue for the picker
app/api/ai/test       validates a key/model without spending tokens
app/api/docs/*        Google Docs copy / parse / apply / export
lib/providers.ts      the provider registry — add new providers here
lib/ai-provider.ts    server dispatch: one OpenAI-compatible adapter + Gemini
lib/puter.ts          browser-side Puter client (no API key)
lib/json-repair.ts    tolerant JSON extraction, shared by server and browser
lib/optimizer.ts      optimize prompt + response validation (client-safe)
lib/revamper.ts       revamp prompt + response validation (client-safe)
lib/settings-storage.ts  per-provider keys and models in localStorage
```
