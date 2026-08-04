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

Three providers are supported. **OpenRouter is the default** — one key gives you
access to 300+ models, including free ones.

| Provider | Env var | Where to get a key |
| --- | --- | --- |
| OpenRouter (default) | `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> |
| Gemini | `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> |
| Cerebras | `CEREBRAS_API_KEY` | <https://cloud.cerebras.ai> |

### OpenRouter setup

1. Create a key at <https://openrouter.ai/keys> (it starts with `sk-or-v1-`).
2. Either put it in `.env.local` as `OPENROUTER_API_KEY`, **or** paste it into the
   in-app **Settings** dialog (gear icon in the header) — that stores it in your
   browser's localStorage and never persists it server-side.
3. Pick a model in Settings. The picker loads OpenRouter's live catalogue, with a
   "Free only" filter, a search box, and a curated shortlist at the top. You can
   also paste any model id directly.
4. Hit **Test connection** to verify the key and model before running an
   optimization — it checks OpenRouter's `/key` endpoint, so it costs nothing.

`OPENROUTER_MODEL` in `.env.local` sets the fallback model when nothing is picked
in Settings. `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` are optional
attribution headers that make the app show up on your OpenRouter activity page.

Key resolution order per request: **Settings value → provider env var → error.**
Keys are kept separately per provider, so switching providers doesn't clobber
the other one.

### Choosing a model

The resume prompts are large (full resume + job description + a long system
prompt), and the response must be strict JSON. Prefer models with 32K+ context
that advertise `response_format` support — the shortlist in
`lib/openrouter-models.ts` only contains such models. If a model returns
unparseable JSON, the app repairs truncated responses where it can and otherwise
tells you to switch models.

OpenRouter retires model ids fairly often. The live picker always reflects
what's actually available; the hard-coded shortlist is only the offline fallback.

## Environment variables

See `.env.example` for the full list. Beyond the AI keys you need Google OAuth
credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) with the Docs and Drive
scopes enabled, plus `NEXTAUTH_SECRET` and `NEXTAUTH_URL`.

## Project layout

```
app/api/optimize    ATS keyword optimization run
app/api/revamp      aggressive full-resume rewrite
app/api/ai/models   proxies OpenRouter's model catalogue for the settings picker
app/api/ai/test     validates a key/model without spending tokens
app/api/docs/*      Google Docs copy / parse / apply / export
lib/ai-provider.ts  provider dispatch (OpenRouter, Gemini, Cerebras) + JSON repair
lib/optimizer.ts    optimize prompt + response validation
lib/revamper.ts     revamp prompt + response validation
```
