/**
 * Turning the optimized .tex into a PDF.
 *
 * There is no LaTeX toolchain assumed on the machine running this, so
 * compilation is delegated to a LaTeX-as-a-service endpoint. That means the
 * document leaves this machine, which is why it is never automatic: the API
 * route behind it only runs when the user explicitly clicks "Compile PDF", and
 * the UI says where the document is going. Downloading the .tex and opening it
 * in Overleaf stays available as the path where nothing is sent anywhere by us.
 *
 * Point LATEX_COMPILE_URL at a self-hosted texlive CGI to keep it in-house.
 */

const DEFAULT_ENDPOINT = 'https://texlive.net/cgi-bin/latexcgi'

/** Where the .tex is sent for compilation, so the UI can name it honestly. */
export function compileEndpoint(): string {
  return process.env.LATEX_COMPILE_URL || DEFAULT_ENDPOINT
}

export function compileHost(): string {
  try {
    return new URL(compileEndpoint()).host
  } catch {
    return compileEndpoint()
  }
}

export type CompileResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; log: string }

/**
 * Compile `source` with pdfLaTeX.
 *
 * The service takes a multipart form describing a small file tree; a resume is
 * a single self-contained file, so one entry is enough. That entry must be named
 * `document.tex`: latexcgi treats it as the main file and refuses any tree
 * without one ("Bad form type / Bad Form: no main document").
 */
export async function compileLatexToPdf(source: string): Promise<CompileResult> {
  const form = new FormData()
  form.append('filename[]', 'document.tex')
  form.append('filecontents[]', source)
  form.append('engine', 'pdflatex')
  form.append('return', 'pdf')

  let response: Response
  try {
    response = await fetch(compileEndpoint(), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      log: `Could not reach the LaTeX compiler at ${compileHost()}: ${reason}`,
    }
  }

  const type = response.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await response.arrayBuffer())

  // A successful build comes back as the PDF itself; a failed one comes back as
  // the pdflatex log, which is far more useful to show than a status code.
  if (response.ok && (type.includes('application/pdf') || buffer.subarray(0, 5).toString() === '%PDF-')) {
    return { ok: true, pdf: buffer }
  }

  const log = buffer.toString('utf8')
  return { ok: false, log: extractLatexErrors(log) || log.slice(0, 4000) }
}

/**
 * Pull the lines that actually say what went wrong out of a pdflatex log.
 * The raw log is thousands of lines of package chatter.
 */
export function extractLatexErrors(log: string): string {
  const lines = log.split(/\r?\n/)
  const interesting: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^! /.test(line) || /^l\.\d+/.test(line) || /LaTeX Error/.test(line)) {
      interesting.push(...lines.slice(i, i + 3).filter(Boolean))
      interesting.push('')
    }
  }

  return interesting.join('\n').trim().slice(0, 4000)
}
