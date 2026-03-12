import type { FastifyInstance } from 'fastify'
import { getDb } from '@spread/db'
import { getSpreadCandles, getSpreadStats, getTopOpportunities } from '@spread/db'
import { getRedis } from '../redis'
import { REDIS_KEY_TICKER } from '@spread/shared'
import type { ExchangeId } from '@spread/shared'
import { sql } from 'kysely'

export async function spreadsRoutes(app: FastifyInstance) {

  /**
   * GET /api/v1/spreads/opportunities
   * Топ текущих возможностей (последние 30 сек)
   */
  app.get('/api/v1/spreads/opportunities', async (req, reply) => {
    const query = req.query as { limit?: string }
    const limit = Math.min(parseInt(query.limit ?? '20'), 100)

    const rows = await getTopOpportunities(limit)
    return reply.send({ data: rows, count: rows.length })
  })

  /**
   * GET /api/v1/spreads/candles?symbol=BTC/USDT&exchangeLong=mexc&exchangeShort=bybit&resolution=5m&from=...&to=...
   * OHLC свечи спреда для TradingView
   */
  app.get('/api/v1/spreads/candles', async (req, reply) => {
    const q = req.query as {
      symbol: string
      exchangeLong: string
      exchangeShort: string
      resolution?: string
      from?: string
      to?: string
    }

    if (!q.symbol || !q.exchangeLong || !q.exchangeShort) {
      return reply.status(400).send({ error: 'symbol, exchangeLong, exchangeShort are required' })
    }

    const resolution = (q.resolution ?? '5m') as '1m' | '5m' | '15m' | '1h' | '4h'
    const to   = q.to   ? new Date(parseInt(q.to) * 1000)   : new Date()
    const from = q.from ? new Date(parseInt(q.from) * 1000) : new Date(Date.now() - 24 * 60 * 60 * 1000)

    const candles = await getSpreadCandles({
      symbol:        q.symbol,
      exchangeLong:  q.exchangeLong as ExchangeId,
      exchangeShort: q.exchangeShort as ExchangeId,
      from,
      to,
      resolution,
    })

    return reply.send({ data: candles })
  })

  /**
   * GET /api/v1/spreads/stats?symbol=BTC/USDT&exchangeLong=mexc&exchangeShort=bybit
   * Z-score статистика за 5 дней
   */
  app.get('/api/v1/spreads/stats', async (req, reply) => {
    const q = req.query as {
      symbol: string
      exchangeLong: string
      exchangeShort: string
    }

    if (!q.symbol || !q.exchangeLong || !q.exchangeShort) {
      return reply.status(400).send({ error: 'symbol, exchangeLong, exchangeShort are required' })
    }

    const stats = await getSpreadStats({
      symbol:        q.symbol,
      exchangeLong:  q.exchangeLong as ExchangeId,
      exchangeShort: q.exchangeShort as ExchangeId,
      days:          5,
    })

    return reply.send({ data: stats })
  })

  /**
   * GET /api/v1/spreads/pairs
   * Все уникальные пары за последние 24h (для списка в UI)
   */
  app.get('/api/v1/spreads/pairs', async (_req, reply) => {
    const db = getDb()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const rows = await db
      .selectFrom('spread_snapshots')
      .select([
        'symbol',
        'exchange_long',
        'exchange_short',
        sql<number>`round(avg(spread_pct)::numeric, 4)`.as('avg_spread_pct'),
        sql<number>`round(avg(spread_net_pct)::numeric, 4)`.as('avg_spread_net_pct'),
        sql<number>`round(max(score)::numeric, 1)`.as('max_score'),
        sql<number>`count(*)`.as('sample_count'),
        sql<number>`sum(case when is_opportunity then 1 else 0 end)`.as('opportunity_count'),
      ])
      .where('time', '>=', since)
      .groupBy(['symbol', 'exchange_long', 'exchange_short'])
      .orderBy('max_score', 'desc')
      .limit(200)
      .execute()

    return reply.send({ data: rows, count: rows.length })
  })

  /**
   * GET /api/v1/tickers/:exchange/:symbol
   * Последний тикер из Redis кеша
   */
  app.get('/api/v1/tickers/:exchange/:symbol', async (req, reply) => {
    const { exchange, symbol } = req.params as { exchange: string; symbol: string }
    const redis = getRedis()

    // symbol в URL: BTC-USDT → нормализуем обратно в BTC/USDT
    const normalizedSymbol = symbol.replace('-', '/')
    const key = REDIS_KEY_TICKER(exchange as ExchangeId, normalizedSymbol)

    const val = await redis.get(key)
    if (!val) return reply.status(404).send({ error: 'Ticker not found or expired' })

    return reply.send({ data: JSON.parse(val) })
  })
}
