import { sql } from 'kysely'
import { getDb } from '../client.js'
import type { ExchangeId } from '@spread/shared'
import type { SpreadCandle } from '@spread/shared'

/**
 * Получить OHLC свечи спреда для TradingView.
 * Использует pre-aggregated view spread_ohlc_1min.
 */
export async function getSpreadCandles(params: {
  symbol: string
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  from: Date
  to: Date
  resolution: '1m' | '5m' | '15m' | '1h' | '4h'
}): Promise<SpreadCandle[]> {
  const db = getDb()
  const { symbol, exchangeLong, exchangeShort, from, to, resolution } = params

  // Маппинг resolution → bucket
  const bucketMap: Record<string, string> = {
    '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes',
    '1h': '1 hour', '4h': '4 hours',
  }
  const bucket = bucketMap[resolution] ?? '5 minutes'

  const rows = await db
    .selectFrom('spread_snapshots')
    .select([
      sql<number>`extract(epoch from time_bucket(${sql.lit(bucket)}, time))`.as('time'),
      sql<number>`first(spread_pct, time)`.as('open'),
      sql<number>`max(spread_pct)`.as('high'),
      sql<number>`min(spread_pct)`.as('low'),
      sql<number>`last(spread_pct, time)`.as('close'),
    ])
    .where('symbol', '=', symbol)
    .where('exchange_long', '=', exchangeLong)
    .where('exchange_short', '=', exchangeShort)
    .where('time', '>=', from)
    .where('time', '<=', to)
    .groupBy(sql`time_bucket(${sql.lit(bucket)}, time)`)
    .orderBy(sql`time_bucket(${sql.lit(bucket)}, time)`)
    .execute()

  return rows.map(r => ({
    time:  r.time,
    open:  Number(r.open),
    high:  Number(r.high),
    low:   Number(r.low),
    close: Number(r.close),
  }))
}

/**
 * Получить статистику спреда за N дней (для Z-score).
 * Возвращает mean и stdDev по всем снапшотам.
 */
export async function getSpreadStats(params: {
  symbol: string
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  days?: number
}): Promise<{ mean: number; stdDev: number; count: number } | null> {
  const db = getDb()
  const { symbol, exchangeLong, exchangeShort, days = 5 } = params

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const row = await db
    .selectFrom('spread_snapshots')
    .select([
      sql<number>`avg(spread_pct)`.as('mean'),
      sql<number>`stddev(spread_pct)`.as('std_dev'),
      sql<number>`count(*)`.as('count'),
    ])
    .where('symbol', '=', symbol)
    .where('exchange_long', '=', exchangeLong)
    .where('exchange_short', '=', exchangeShort)
    .where('time', '>=', since)
    .executeTakeFirst()

  if (!row || Number(row.count) < 10) return null

  return {
    mean:   Number(row.mean),
    stdDev: Number(row.std_dev),
    count:  Number(row.count),
  }
}

/**
 * Batch-insert снапшотов (вызывается каждые 10 сек).
 */
export async function insertSpreadSnapshots(
  snapshots: Array<{
    engineType: string
    symbol: string
    exchangeLong: string
    exchangeShort: string
    priceLong: number
    priceShort: number
    spreadAbs: number
    spreadPct: number
    spreadNetPct?: number
    fundingRateLong?: number
    fundingRateShort?: number
    fundingEdgePct?: number
    zScore?: number
    score?: number
    isOpportunity: boolean
    timestamp: Date
  }>,
): Promise<void> {
  if (snapshots.length === 0) return
  const db = getDb()

  await db
    .insertInto('spread_snapshots')
    .values(
      snapshots.map(s => ({
        time:               s.timestamp,
        engine_type:        s.engineType,
        symbol:             s.symbol,
        exchange_long:      s.exchangeLong,
        exchange_short:     s.exchangeShort,
        price_long:         s.priceLong,
        price_short:        s.priceShort,
        spread_abs:         s.spreadAbs,
        spread_pct:         s.spreadPct,
        spread_net_pct:     s.spreadNetPct ?? null,
        funding_rate_long:  s.fundingRateLong ?? null,
        funding_rate_short: s.fundingRateShort ?? null,
        funding_edge_pct:   s.fundingEdgePct ?? null,
        z_score:            s.zScore ?? null,
        score:              s.score ?? null,
        is_opportunity:     s.isOpportunity,
      })),
    )
    .execute()
}

/**
 * Получить топ возможностей прямо сейчас.
 * DISTINCT ON гарантирует одну строку на пару (symbol, exchange_long, exchange_short)
 * с самым свежим снапшотом, затем сортируем по score.
 */
export async function getTopOpportunities(limit = 50) {
  const db = getDb()
  const since = new Date(Date.now() - 60_000) // последняя минута

  // Используем сырой SQL для DISTINCT ON (Postgres/TimescaleDB specific)
  const rows = await sql<{
    time: Date
    engine_type: string
    symbol: string
    exchange_long: string
    exchange_short: string
    price_long: number
    price_short: number
    spread_abs: number
    spread_pct: number
    spread_net_pct: number | null
    funding_rate_long: number | null
    funding_rate_short: number | null
    funding_edge_pct: number | null
    z_score: number | null
    score: number | null
    is_opportunity: boolean
  }>`
    SELECT * FROM (
      SELECT DISTINCT ON (symbol, exchange_long, exchange_short)
        *
      FROM spread_snapshots
      WHERE is_opportunity = true
        AND time >= ${since}
      ORDER BY symbol, exchange_long, exchange_short, time DESC
    ) latest
    ORDER BY score DESC NULLS LAST
    LIMIT ${limit}
  `.execute(getDb())

  return rows.rows
}
