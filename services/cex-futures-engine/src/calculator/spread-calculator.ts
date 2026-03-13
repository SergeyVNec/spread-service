import type { ExchangeId, Ticker } from '@spread/shared'
import type { SpreadSnapshot } from '@spread/shared'
import {
  calcSpread,
  calcZScore,
  calcStats,
  CEX_FUTURES_EXCHANGES,
} from '@spread/shared'
import { config } from '../config.js'
import { logger } from '../logger.js'

export class SpreadCalculator {
  /**
   * Из тикеров всех бирж генерирует все возможные пары (A→B, B→A)
   * и рассчитывает спред для каждой.
   */
  computeAll(
    allTickers: Map<ExchangeId, Map<string, Ticker>>,
    statsCache: Map<string, { mean: number; stdDev: number }>,
  ): SpreadSnapshot[] {
    const results: SpreadSnapshot[] = []
    const exchanges = CEX_FUTURES_EXCHANGES.filter(id => allTickers.has(id))

    // Берём все уникальные символы
    const symbols = new Set<string>()
    for (const tickerMap of allTickers.values()) {
      for (const sym of tickerMap.keys()) symbols.add(sym)
    }

    const now = new Date()

    for (const symbol of symbols) {
      // Собираем тикеры этого символа со всех бирж
      const available: Array<{ id: ExchangeId; ticker: Ticker }> = []

      for (const exId of exchanges) {
        const ticker = allTickers.get(exId)?.get(symbol)
        if (ticker) available.push({ id: exId, ticker })
      }

      if (available.length < 2) continue

      // Перебираем все пары (i, j) где i ≠ j
      for (let i = 0; i < available.length; i++) {
        for (let j = 0; j < available.length; j++) {
          if (i === j) continue

          const longSide  = available[i]!
          const shortSide = available[j]!

          const base = calcSpread(longSide.ticker, shortSide.ticker)

          // Берём Z-score из кеша (обновляется реже, из БД)
          const statsKey = `${symbol}:${longSide.id}:${shortSide.id}`
          const stats = statsCache.get(statsKey)
          const zScore = stats
            ? calcZScore(base.spreadPct, stats.mean, stats.stdDev)
            : undefined

          const score = this.calcScore(base, zScore, longSide.ticker, shortSide.ticker)
          const isOpportunity =
            base.spreadNetPct >= config.MIN_NET_SPREAD_PCT &&
            score >= 30

          results.push({
            ...base,
            zScore,
            score,
            isOpportunity,
            timestamp: now,
          })
        }
      }
    }

    // Сортируем по score desc
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    logger.debug(
      { total: results.length, opportunities: results.filter(r => r.isOpportunity).length },
      'Spreads computed'
    )

    return results
  }

  /**
   * Итоговый score 0-100.
   *
   * Факторы:
   *  - 30% Размер чистого спреда
   *  - 25% Z-score (аномальность vs история)
   *  - 20% Фандинг-эдж (если оба фандинга в нашу пользу)
   *  - 15% Ликвидность (объём)
   *  - 10% Качество bid-ask (tight spread на обеих биржах)
   */
  private calcScore(
    snap: ReturnType<typeof calcSpread>,
    zScore: number | undefined,
    longTicker: Ticker,
    shortTicker: Ticker,
  ): number {
    // 1. Спред (0-30)
    // 0.1% net → 10 очков, 0.5% → 30 очков (cap)
    const spreadScore = Math.min(snap.spreadNetPct / 0.5 * 30, 30)

    // 2. Z-score (0-25)
    // Z=1.5 → 10, Z=2.0 → 20, Z=3.0 → 25 (cap)
    const zScoreScore = zScore !== undefined
      ? Math.min(Math.max(zScore - 1.0, 0) / 2.0 * 25, 25)
      : 5  // нет истории — нейтральный бонус

    // 3. Фандинг-эдж (0-20)
    // 10% APY → 10 очков, 30% APY → 20 очков (cap)
    const fundingScore = snap.fundingEdgePct !== undefined && snap.fundingEdgePct > 0
      ? Math.min(snap.fundingEdgePct / 30 * 20, 20)
      : 0

    // 4. Ликвидность (0-15)
    // $10M 24h vol → 10, $100M → 15 (cap)
    const avgVol = (longTicker.volume24h + shortTicker.volume24h) / 2
    const liquidityScore = Math.min(Math.log10(Math.max(avgVol, 1e6)) / Math.log10(100e6) * 15, 15)

    // 5. Качество bid-ask (0-10)
    // Чем уже спред на бирже, тем лучше
    const longBidAskPct  = longTicker.ask  > 0 ? (longTicker.ask  - longTicker.bid)  / longTicker.ask  * 100 : 1
    const shortBidAskPct = shortTicker.ask > 0 ? (shortTicker.ask - shortTicker.bid) / shortTicker.ask * 100 : 1
    const avgBidAsk = (longBidAskPct + shortBidAskPct) / 2
    const bidAskScore = Math.max(10 - avgBidAsk * 100, 0)

    const total = spreadScore + zScoreScore + fundingScore + liquidityScore + bidAskScore
    return Math.round(Math.max(0, Math.min(100, total)))
  }
}
