import type { ExchangeId, MarketType } from './exchange.types.js'

export type EngineType = 'cex-futures' | 'spot-futures' | 'dex-futures'

export interface SpreadSnapshot {
  id?: string
  engineType: EngineType
  symbol: string          // 'BTC/USDT'
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  priceLong: number
  priceShort: number
  spreadAbs: number       // priceShort - priceLong (абсолютный)
  spreadPct: number       // (priceShort - priceLong) / priceLong * 100
  spreadNetPct: number    // spreadPct - суммарные комиссии
  fundingRateLong?: number   // текущий фандинг на long стороне (% за 8h)
  fundingRateShort?: number  // текущий фандинг на short стороне
  fundingEdgePct?: number    // выгода от фандинга в % годовых
  zScore?: number         // насколько аномален vs 5-дневной истории
  score?: number          // итоговый score 0-100
  isOpportunity: boolean
  timestamp: Date
}

export interface SpreadStats {
  symbol: string
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  periodDays: number
  mean: number
  stdDev: number
  min: number
  max: number
  current: number
  zScore: number
  percentile: number    // текущий спред в каком перцентиле за период
  sampleCount: number
}

export interface SpreadOpportunity extends SpreadSnapshot {
  stats: SpreadStats
  estimatedEntryFee: number   // USD
  estimatedExitFee: number    // USD
  breakEvenSpreadPct: number  // минимальный спред для безубытка
  projectedPnlPct?: number    // если спред вернётся к среднему
  maxPositionUsd?: number     // ограничено ликвидностью
  notes: string[]             // ["Funding edge: +12% APY", "High Z-score: 2.8σ"]
}

// Для TradingView — OHLC по спреду
export interface SpreadCandle {
  time: number        // Unix timestamp
  open: number
  high: number
  low: number
  close: number
  mean?: number       // 5-дневная средняя
  zScoreHigh?: number // верхняя полоса +2σ
  zScoreLow?: number  // нижняя полоса -2σ
}
