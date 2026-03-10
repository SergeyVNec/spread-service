import ccxt from 'ccxt'
import type { ExchangeId, ExchangeMarket, Ticker } from '@spread/shared'
import { CEX_FUTURES_EXCHANGES } from '@spread/shared'
import { config } from '../config'
import { logger } from '../logger'

type CcxtExchange = InstanceType<typeof ccxt.Exchange>

const CCXT_IDS: Record<ExchangeId, string> = {
  mexc:    'mexc',
  binance: 'binanceusdm',   // USDM фьючерсы
  bybit:   'bybit',
  okx:     'okx',
  gate:    'gateio',
  bitget:  'bitget',
  kucoin:  'kucoinfutures',
}

const API_KEYS: Record<ExchangeId, { apiKey?: string; secret?: string; password?: string }> = {
  mexc:    { apiKey: config.MEXC_API_KEY,    secret: config.MEXC_API_SECRET },
  binance: { apiKey: config.BINANCE_API_KEY, secret: config.BINANCE_API_SECRET },
  bybit:   { apiKey: config.BYBIT_API_KEY,   secret: config.BYBIT_API_SECRET },
  okx:     { apiKey: config.OKX_API_KEY,     secret: config.OKX_API_SECRET, password: config.OKX_PASSPHRASE },
  gate:    { apiKey: config.GATE_API_KEY,    secret: config.GATE_API_SECRET },
  bitget:  { apiKey: config.BITGET_API_KEY,  secret: config.BITGET_API_SECRET, password: config.BITGET_PASSPHRASE },
  kucoin:  {},
}

export class ExchangeScanner {
  private exchanges = new Map<ExchangeId, CcxtExchange>()
  // Список торгуемых символов (нормализованный) по бирже
  private markets = new Map<ExchangeId, Map<string, ExchangeMarket>>()
  // Пересечение символов — есть на 2+ биржах
  private commonSymbols = new Set<string>()

  async init(): Promise<void> {
    logger.info('Initialising exchange connections...')

    await Promise.all(
      CEX_FUTURES_EXCHANGES.map(id => this.initExchange(id))
    )

    await this.loadMarkets()
    this.buildCommonSymbols()

    logger.info(
      { exchanges: CEX_FUTURES_EXCHANGES.length, symbols: this.commonSymbols.size },
      'ExchangeScanner ready'
    )
  }

  private async initExchange(id: ExchangeId): Promise<void> {
    try {
      const ccxtId = CCXT_IDS[id]
      const ExchangeClass = (ccxt as unknown as Record<string, new (config: object) => CcxtExchange>)[ccxtId]
      if (!ExchangeClass) {
        logger.warn({ id }, 'Exchange class not found in ccxt, skipping')
        return
      }

      const keys = API_KEYS[id]
      const instance = new ExchangeClass({
        apiKey:   keys.apiKey,
        secret:   keys.secret,
        password: keys.password,
        options: {
          defaultType: 'swap',  // бессрочные фьючерсы
        },
      })

      this.exchanges.set(id, instance)
      logger.debug({ id }, 'Exchange instance created')
    } catch (err) {
      logger.error({ id, err }, 'Failed to init exchange')
    }
  }

  private async loadMarkets(): Promise<void> {
    await Promise.all(
      Array.from(this.exchanges.entries()).map(async ([id, ex]) => {
        try {
          const rawMarkets = await ex.loadMarkets()
          const marketMap = new Map<string, ExchangeMarket>()

          for (const [, m] of Object.entries(rawMarkets)) {
            if (!m) continue
            // Берём только USDT-маржированные бессрочные контракты
            if (!m.active) continue
            if (m.settle !== 'USDT' && m.quote !== 'USDT') continue
            if (m.type !== 'swap' && m.type !== 'future') continue
            if (m.expiry !== undefined && m.expiry !== null) continue  // только perps

            const market: ExchangeMarket = {
              exchange:     id,
              symbol:       m.symbol ?? '',
              rawSymbol:    m.id ?? '',
              baseAsset:    m.base ?? '',
              quoteAsset:   m.quote ?? '',
              marketType:   'futures',
              isActive:     m.active ?? true,
              contractSize: m.contractSize as number | undefined,
              minOrderSize: m.limits?.amount?.min as number | undefined,
              maxOrderSize: m.limits?.amount?.max as number | undefined,
              tickSize:     m.precision?.price as number | undefined,
              stepSize:     m.precision?.amount as number | undefined,
              maxLeverage:  m.limits?.leverage?.max as number | undefined,
              settleCurrency: m.settle as string | undefined,
            }

            // Нормализуем символ: 'BTC/USDT:USDT' → 'BTC/USDT'
            const normalizedSymbol = `${m.base ?? ''}/${m.quote ?? ''}`
            if (normalizedSymbol === '/') continue
            marketMap.set(normalizedSymbol, market)
          }

          this.markets.set(id, marketMap)
          logger.info({ id, count: marketMap.size }, 'Markets loaded')
        } catch (err) {
          logger.error({ id, err }, 'Failed to load markets')
        }
      })
    )
  }

  /** Находим символы, присутствующие минимум на 2 биржах */
  private buildCommonSymbols(): void {
    const symbolCount = new Map<string, number>()

    for (const marketMap of this.markets.values()) {
      for (const symbol of marketMap.keys()) {
        symbolCount.set(symbol, (symbolCount.get(symbol) ?? 0) + 1)
      }
    }

    this.commonSymbols = new Set(
      Array.from(symbolCount.entries())
        .filter(([, count]) => count >= 2)
        .map(([symbol]) => symbol)
    )

    logger.info({ count: this.commonSymbols.size }, 'Common symbols across exchanges')
  }

  /** Получить тикеры со всех бирж для всех общих символов */
  async fetchAllTickers(): Promise<Map<ExchangeId, Map<string, Ticker>>> {
    const results = new Map<ExchangeId, Map<string, Ticker>>()

    await Promise.all(
      Array.from(this.exchanges.entries()).map(async ([id, ex]) => {
        try {
          const tickers = await ex.fetchTickers(undefined)  // все тикеры разом
          const tickerMap = new Map<string, Ticker>()

          for (const [rawSymbol, t] of Object.entries(tickers)) {
            // ccxt symbol формат: 'BTC/USDT:USDT' → нормализуем в 'BTC/USDT'
            // t.symbol всегда присутствует в ccxt Ticker
            const ccxtSymbol: string = t.symbol ?? rawSymbol
            // Берём часть до ':' если есть (perpetual swap формат)
            const normalizedSymbol = ccxtSymbol.includes(':')
              ? ccxtSymbol.split(':')[0]!
              : ccxtSymbol

            if (!this.commonSymbols.has(normalizedSymbol)) continue
            if (!t.last || !t.bid || !t.ask) continue

            // Фильтр по минимальному объёму
            const last = t.last as number
            const baseVol = t.baseVolume as number | undefined
            const vol = (t.quoteVolume as number | undefined) ?? (baseVol ? baseVol * last : 0)
            if (vol < config.MIN_VOLUME_USD) continue

            const info = t.info as Record<string, unknown>

            tickerMap.set(normalizedSymbol, {
              exchange:      id,
              symbol:        normalizedSymbol,
              rawSymbol,
              marketType:    'futures',
              price:         last,
              bid:           t.bid as number,
              ask:           t.ask as number,
              volume24h:     vol,
              openInterest:  typeof info['openInterest'] === 'number' ? info['openInterest'] : undefined,
              fundingRate:   typeof info['fundingRate'] === 'number' ? info['fundingRate'] : undefined,
              nextFundingAt: info['nextFundingTime']
                ? new Date(Number(info['nextFundingTime']))
                : undefined,
              markPrice:     typeof info['markPrice'] === 'number' ? info['markPrice'] : undefined,
              indexPrice:    typeof info['indexPrice'] === 'number' ? info['indexPrice'] : undefined,
              timestamp:     new Date((t.timestamp as number | undefined) ?? Date.now()),
            })
          }

          results.set(id, tickerMap)
          logger.debug({ id, count: tickerMap.size }, 'Tickers fetched')
        } catch (err) {
          logger.warn({ id, err }, 'Failed to fetch tickers, skipping exchange this cycle')
        }
      })
    )

    return results
  }

  getCommonSymbols(): Set<string> { return this.commonSymbols }
  getExchangeIds(): ExchangeId[]  { return Array.from(this.exchanges.keys()) }
}
