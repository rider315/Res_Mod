import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { AIProvider } from '@/types/resume'
import { apiKeyName, getProvider, isValidProvider } from '@/lib/providers'
import { decryptSecret, encryptSecret } from '@/lib/secrets'
import {
  parseStoredPlatformAi,
  PlatformAiConfig,
  platformAiFromEnv,
  resolveStoredPlatformAi,
  StoredPlatformAi,
} from '@/lib/billing/config'
import type { PlatformAiStatus } from '@/lib/billing/types'

/**
 * ResMod AI as the owner chooses it in AI settings: the provider, model and key
 * every regular account runs on: they have no AI settings of their own.
 *
 * The setting lives in the database, one row per deployment environment, so a
 * local dev server never changes the live site's AI even though both share one
 * database. PLATFORM_AI_* environment variables, when set, take precedence.
 */

const SETTING_KEY = `platform_ai@${process.env.VERCEL_ENV || 'local'}`

/** A saved change reaches every server instance within this long. */
const CACHE_MS = 15_000

interface Setting {
  stored: StoredPlatformAi | null
  updatedAt: Date | null
}

let cache: { at: number; setting: Setting } | null = null

async function readSetting(fresh = false): Promise<Setting> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.setting
  const [row] = await getDb()
    .select({ value: schema.appSettings.value, updatedAt: schema.appSettings.updatedAt })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SETTING_KEY))
    .limit(1)
  const setting = { stored: parseStoredPlatformAi(row?.value), updatedAt: row?.updatedAt ?? null }
  cache = { at: Date.now(), setting }
  return setting
}

/** The model every regular account runs on, or null while ResMod AI is off. */
export async function getPlatformAi(): Promise<PlatformAiConfig | null> {
  const fromEnv = platformAiFromEnv()
  if (fromEnv) return fromEnv
  try {
    const { stored } = await readSetting()
    return resolveStoredPlatformAi(stored, process.env, decryptSecret)
  } catch (err) {
    console.error('[platform-ai] the setting could not be read:', err instanceof Error ? err.message : err)
    return null
  }
}

/** What the owner's AI settings show. Never includes the key. */
export async function getPlatformAiStatus(): Promise<PlatformAiStatus> {
  const { stored, updatedAt } = await readSetting(true)
  const provider = stored && isValidProvider(stored.provider) ? stored.provider : null
  return {
    current:
      stored && provider
        ? {
            provider,
            model: stored.model,
            keySource: stored.keySource,
            keyHint: stored.keyHint ?? null,
            updatedAt: updatedAt?.toISOString() ?? null,
          }
        : null,
    working: resolveStoredPlatformAi(stored, process.env, decryptSecret) !== null,
    overriddenByEnv: platformAiFromEnv() !== null,
  }
}

/** A choice from AI settings that can't be saved, with the reason to show the owner. */
export class PlatformAiSettingError extends Error {}

/**
 * The stored form of a provider, model and key picked in AI settings. A blank
 * key means the provider's own key on this server, when it has one.
 */
export function storedSettingFor(provider: AIProvider, model: string, apiKey: string): StoredPlatformAi {
  const config = getProvider(provider)
  const key = apiKey.trim()
  if (!config.needsKey) return { provider, model, keySource: 'server' }
  if (key) return { provider, model, keySource: 'saved', encryptedKey: encryptSecret(key), keyHint: key.slice(-4) }
  if (config.envVar && process.env[config.envVar]?.trim()) return { provider, model, keySource: 'server' }
  throw new PlatformAiSettingError(
    `Add your ${apiKeyName(config)} above first: this server has no ${config.envVar ?? 'key'} to use instead.`
  )
}

export async function savePlatformAi(stored: StoredPlatformAi, userId: string): Promise<void> {
  await getDb()
    .insert(schema.appSettings)
    .values({ key: SETTING_KEY, value: stored, updatedBy: userId })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: stored, updatedBy: userId, updatedAt: new Date() },
    })
  cache = null
}

export async function clearPlatformAi(): Promise<void> {
  await getDb().delete(schema.appSettings).where(eq(schema.appSettings.key, SETTING_KEY))
  cache = null
}
