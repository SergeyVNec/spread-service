import type { ExchangeId } from '@spread/shared'
import { REDIS_KEY_STATS, REDIS_STATS_TTL_SEC } from '@spread/shared'
import { getSpreadStats } from '@spread/db/queries/spreads.queries.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

interface CachedStats {
  mean: number
  stdDev: number
  count: number
  updatedAt: number
}

/**
 * Двухуровневый кеш статистики спреда:
 *   L1: In-process Map (быстро, без сети)
 *   L2: Redis (между рестартами)
 *   L3: TimescaleDB (источник правды)
 */
export class StatsCache {
  // L1 in-process кеш
  private cache = new Map<string, CachedStats>()
  // Предотвращение параллельных запросов к БД для одного ключа
  private pending = new Map<string, Promise<CachedStats | null>>()

  async get(
    symbol: string,
    exchangeLong: ExchangeId,
    exchangeShort: ExchangeId,
  ): Promise<{ mean: number; stdDev: number } | null> {
    const key = REDIS_KEY_STATS(symbol, exchangeLong, exchangeShort)

    // L1 — in-process
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.updatedAt < REDIS_STATS_TTL_SEC * 1000) {
      return cached
    }

    // L2 — Redis
    const redis = getRedis()
    const redisVal = await redis.get(key).catch(() => null)
    if (redisVal) {
      try {
        const parsed: CachedStats = JSON.parse(redisVal)
        this.cache.set(key, parsed)
        return parsed
      } catch {}
    }

    // L3 — DB (один запрос, даже если пришли одновременно)
    if (this.pending.has(key)) {
      return this.pending.get(key)!
    }

    const fetchPromise = this.fetchFromDb(symbol, exchangeLong, exchangeShort, key)
      .finally(() => this.pending.delete(key))

    this.pending.set(key, fetchPromise)
    return fetchPromise
  }

  private async fetchFromDb(
    symbol: string,
    exchangeLong: ExchangeId,
    exchangeShort: ExchangeId,
    key: string,
  ): Promise<CachedStats | null> {
    try {
      const stats = await getSpreadStats({ symbol, exchangeLong, exchangeShort, days: 5 })
      if (!stats) return null

      const entry: CachedStats = { ...stats, updatedAt: Date.now() }

      // Сохраняем в L1 + L2
      this.cache.set(key, entry)
      const redis = getRedis()
      await redis.set(key, JSON.stringify(entry), 'EX', REDIS_STATS_TTL_SEC).catch(() => {})

      logger.debug({ symbol, exchangeLong, exchangeShort, ...stats }, 'Stats refreshed from DB')
      return entry
    } catch (err) {
      logger.warn({ symbol, exchangeLong, exchangeShort, err }, 'Failed to fetch stats from DB')
      return null
    }
  }

  /** Инвалидировать все записи (вызвать после массового обновления данных) */
  invalidateAll(): void {
    this.cache.clear()
  }

  /** Получить все ключи статистики для bulk-обновления */
  getCacheSize(): number {
    return this.cache.size
  }
}
