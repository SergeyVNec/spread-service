export type ExchangeId =
  | 'mexc'
  | 'binance'
  | 'bybit'
  | 'okx'
  | 'gate'
  | 'bitget'
  | 'kucoin'

export type MarketType = 'futures' | 'spot' | 'dex'

export interface ExchangeConfig {
  id: ExchangeId
  name: string
  apiKey?: string
  apiSecret?: string
  passphrase?: string  // OKX
  sandbox?: boolean
  rateLimit: number    // ms между запросами
  makerFee: number     // в долях (0.0002 = 0.02%)
  takerFee: number
}

export interface Ticker {
  exchange: ExchangeId
  symbol: string        // normalized: 'BTC/USDT'
  rawSymbol: string     // как на бирже: 'BTCUSDT', 'BTC-USDT-SWAP'
  marketType: MarketType
  price: number
  bid: number
  ask: number
  volume24h: number
  openInterest?: number
  fundingRate?: number
  nextFundingAt?: Date
  markPrice?: number
  indexPrice?: number
  timestamp: Date
}

export interface ExchangeMarket {
  exchange: ExchangeId
  symbol: string
  rawSymbol: string
  baseAsset: string
  quoteAsset: string
  marketType: MarketType
  isActive: boolean
  contractSize?: number
  minOrderSize?: number
  maxOrderSize?: number
  tickSize?: number
  stepSize?: number
  maxLeverage?: number
  settleCurrency?: string
}
