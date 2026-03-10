import type { SpreadSnapshot } from '@spread/shared'
import {
  REDIS_CHANNEL_OPPORTUNITIES,
  REDIS_CHANNEL_TICKERS,
  REDIS_KEY_TICKER,
} from '@spread/shared'
import type { ExchangeId, Ticker } from '@spread/shared'
import { getRedisPub, getRedis } from '../redis.js'
import { logger } from '../logger.js'

/** TTL последнего тикера в Redis (30 секунд) */
const TICKER_TTL_SEC = 30

export class SpreadPublisher {
  /**
   * Публикует топ возможностей в Redis Pub/Sub.
   * API-сервер подписан на этот канал и отправляет данные в WebSocket.
   */
  async publishOpportunities(opportunities: SpreadSnapshot[]): Promise<void> {
    if (opportunities.length === 0) return

    const pub = getRedisPub()
    const payload = JSON.stringify({
      ts:   Date.now(),
      data: opportunities.slice(0, 50),  // топ-50 в канал
    })

    try {
      await pub.publish(REDIS_CHANNEL_OPPORTUNITIES, payload)
      logger.debug({ count: opportunities.length }, 'Opportunities published to Redis')
    } catch (err) {
      logger.error({ err }, 'Failed to publish opportunities')
    }
  }

  /**
   * Кеш последних тикеров — для API-сервера (GET /coins/:symbol).
   * Пишем в Redis как строки, не через Pub/Sub.
   */
  async cacheTickers(allTickers: Map<ExchangeId, Map<string, Ticker>>): Promise<void> {
    const redis = getRedis()
    const pipeline = redis.pipeline()

    for (const [exchangeId, tickerMap] of allTickers) {
      for (const [symbol, ticker] of tickerMap) {
        const key = REDIS_KEY_TICKER(exchangeId, symbol)
        pipeline.set(key, JSON.stringify(ticker), 'EX', TICKER_TTL_SEC)
      }
    }

    try {
      await pipeline.exec()
    } catch (err) {
      logger.warn({ err }, 'Failed to cache tickers in Redis')
    }
  }

  /**
   * Публикует отдельный тикер в канал (для WebSocket подписок на конкретную пару).
   */
  async publishTicker(ticker: Ticker): Promise<void> {
    const pub = getRedisPub()
    const channel = `${REDIS_CHANNEL_TICKERS}:${ticker.symbol}`
    try {
      await pub.publish(channel, JSON.stringify(ticker))
    } catch {
      // non-critical
    }
  }
}
