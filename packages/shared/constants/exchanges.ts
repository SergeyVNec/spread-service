import type { ExchangeId } from '../types/index.js'

/** Биржи, поддерживаемые cex-futures движком */
export const CEX_FUTURES_EXCHANGES: ExchangeId[] = [
  'mexc',
  'binance',
  'bybit',
  'okx',
  'gate',
  'bitget',
  'kucoin',
  'bingx',
  'hyperliquid',
  'aster',
]

/** Минимальный объём 24h (USD) для включения пары в сканирование */
export const MIN_VOLUME_USD = 5_000_000

/** Минимальный чистый спред для сигнала (после комиссий) */
export const MIN_NET_SPREAD_PCT = 0.1

/** Минимальный Z-score для пометки как opportunity */
export const MIN_Z_SCORE = 1.5

/** Минимальный итоговый score */
export const MIN_SCORE = 40

/** Интервал поллинга тикеров через REST (мс) — fallback если нет WS */
export const REST_POLL_INTERVAL_MS = 5_000

/** Интервал записи snapshot в БД (мс) */
export const DB_WRITE_INTERVAL_MS = 10_000

/** Redis channel для публикации возможностей */
export const REDIS_CHANNEL_OPPORTUNITIES = 'cex-futures:opportunities'

/** Redis channel для тикеров (сырые данные) */
export const REDIS_CHANNEL_TICKERS = 'cex-futures:tickers'

/** Redis key prefix для кеша последних тикеров */
export const REDIS_KEY_TICKER = (exchange: ExchangeId, symbol: string) =>
  `ticker:${exchange}:${symbol}`

/** Redis key для кеша statistics (5d) */
export const REDIS_KEY_STATS = (symbol: string, exchangeLong: ExchangeId, exchangeShort: ExchangeId) =>
  `stats:${symbol}:${exchangeLong}:${exchangeShort}`

/** TTL для кеша статистики (10 минут) */
export const REDIS_STATS_TTL_SEC = 600
