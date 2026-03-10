import type { Ticker, ExchangeId } from '../types/index.js'
import type { SpreadSnapshot } from '../types/spread.types.js'

export const TAKER_FEE: Record<ExchangeId, number> = {
  mexc:    0.0002,  // 0.02%
  binance: 0.0004,  // 0.04%
  bybit:   0.00055, // 0.055%
  okx:     0.0005,  // 0.05%
  gate:    0.00075, // 0.075%
  bitget:  0.0006,  // 0.06%
  kucoin:  0.0006,  // 0.06%
}

export const MAKER_FEE: Record<ExchangeId, number> = {
  mexc:    0.0,     // 0% (maker rebate на некоторых парах)
  binance: 0.0002,
  bybit:   0.0002,
  okx:     0.0002,
  gate:    0.0002,
  bitget:  0.0002,
  kucoin:  0.0002,
}

/**
 * Рассчитывает спред между двумя тикерами.
 * Всегда: longExchange имеет меньшую цену (мы покупаем дешевле),
 *         shortExchange имеет большую цену (мы продаём дороже).
 */
export function calcSpread(
  longTicker: Ticker,
  shortTicker: Ticker,
): Omit<SpreadSnapshot, 'zScore' | 'score' | 'isOpportunity' | 'timestamp'> {
  const priceLong  = longTicker.ask   // покупаем по аску
  const priceShort = shortTicker.bid  // продаём по биду

  const spreadAbs = priceShort - priceLong
  const spreadPct = (spreadAbs / priceLong) * 100

  // Суммарная стоимость входа+выхода (2 ноги × 2 стороны)
  const entryFeePct = (TAKER_FEE[longTicker.exchange] + TAKER_FEE[shortTicker.exchange]) * 100
  const exitFeePct  = entryFeePct  // симметричный выход
  const totalFeePct = entryFeePct + exitFeePct

  const spreadNetPct = spreadPct - totalFeePct

  // Фандинг-эдж: если оба фандинга работают в нашу пользу
  // Long позиция: получаем фандинг если rate < 0, платим если rate > 0
  // Short позиция: получаем фандинг если rate > 0, платим если rate < 0
  let fundingEdgePct: number | undefined
  if (longTicker.fundingRate !== undefined && shortTicker.fundingRate !== undefined) {
    // Для пары long/short: нам выгоден short когда rate > 0
    // и long когда rate < 0. Считаем net funding за 8h × 3 × 365 = APY
    const netFunding8h = shortTicker.fundingRate - longTicker.fundingRate
    fundingEdgePct = netFunding8h * 3 * 365 * 100  // APY %
  }

  return {
    engineType:       'cex-futures',
    symbol:           longTicker.symbol,
    exchangeLong:     longTicker.exchange,
    exchangeShort:    shortTicker.exchange,
    priceLong,
    priceShort,
    spreadAbs,
    spreadPct,
    spreadNetPct,
    fundingRateLong:  longTicker.fundingRate,
    fundingRateShort: shortTicker.fundingRate,
    fundingEdgePct,
  }
}

/**
 * Z-score: насколько текущий спред аномален относительно исторической средней.
 * Z > 2.0 — спред аномально высокий (хорошая возможность для входа).
 * Z < -2.0 — спред аномально отрицательный.
 */
export function calcZScore(current: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0
  return (current - mean) / stdDev
}

/**
 * Среднее и стандартное отклонение массива значений.
 */
export function calcStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return { mean, stdDev: Math.sqrt(variance) }
}

/**
 * Перцентиль текущего значения в массиве.
 */
export function calcPercentile(current: number, values: number[]): number {
  if (values.length === 0) return 50
  const sorted = [...values].sort((a, b) => a - b)
  const below = sorted.filter(v => v <= current).length
  return (below / sorted.length) * 100
}

/**
 * Минимальный спред для безубытка (с учётом комиссий).
 */
export function calcBreakEven(
  exchangeLong: ExchangeId,
  exchangeShort: ExchangeId,
): number {
  return (
    (TAKER_FEE[exchangeLong] + TAKER_FEE[exchangeShort]) * 2 * 100  // entry + exit
  )
}
