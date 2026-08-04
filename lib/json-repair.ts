/**
 * Tolerant JSON extraction for LLM output.
 *
 * Client-safe: no server-only imports, so the browser-side Puter path can use it
 * as well as the server-side providers.
 */

/**
 * Try to extract a valid JSON object from a string that may contain
 * markdown fences, explanatory text, or other wrapper content.
 */
export function extractJSON(text: string): string | null {
  if (!text || !text.trim()) return null

  let cleaned = text.trim()

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()

  // Try direct parse first
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // Continue to extraction strategies
  }

  // Strategy 1: Find the first { and last } to extract the JSON object
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Continue — might be truncated
    }
  }

  // Strategy 2: JSON was truncated (no closing }). Try to repair it.
  if (firstBrace !== -1) {
    const partial = cleaned.slice(firstBrace)
    const repaired = repairTruncatedJSON(partial)
    if (repaired) {
      try {
        JSON.parse(repaired)
        return repaired
      } catch {
        // Give up
      }
    }
  }

  return null
}

/**
 * Attempt to repair a truncated JSON string by closing open structures.
 * This handles the common case where the model's output was cut off mid-response.
 */
export function repairTruncatedJSON(partial: string): string | null {
  if (!partial.startsWith('{')) return null

  let repaired = partial.trim()

  // Remove any trailing incomplete string (ends mid-string without closing quote)
  // e.g., ..."reason": "this was trun
  repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/, '')
  repaired = repaired.replace(/,\s*"[^"]*":\s*$/, '')
  repaired = repaired.replace(/,\s*"[^"]*$/, '')
  // Remove trailing comma
  repaired = repaired.replace(/,\s*$/, '')

  // Count open brackets/braces and close them
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false

  for (const char of repaired) {
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '{') openBraces++
    if (char === '}') openBraces--
    if (char === '[') openBrackets++
    if (char === ']') openBrackets--
  }

  // If we're still inside a string, close it
  if (inString) {
    repaired += '"'
  }

  // Close open brackets and braces
  while (openBrackets > 0) { repaired += ']'; openBrackets-- }
  while (openBraces > 0) { repaired += '}'; openBraces-- }

  return repaired
}

/** Rough estimate: ~4 chars per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Shared error text for when a model's response can't be coerced into JSON —
 * almost always a truncated response or a model that ignores JSON instructions.
 */
export function invalidJsonMessage(provider: string, model?: string): string {
  const target = model ? `"${model}"` : `the selected ${provider} model`
  return (
    `The AI returned invalid JSON. This usually means ${target} was cut off mid-response ` +
    'or does not follow JSON instructions reliably. Pick a different model in Settings, ' +
    'or shorten the job description.'
  )
}
