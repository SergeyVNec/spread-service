import ccxt from 'ccxt'
import type { ExchangeId, ExchangeMarket, Ticker } from '@spread/shared'
import { CEX_FUTURES_EXCHANGES } from '@spread/shared'
import { config } from '../config.js'
import { logger } from '../logger.js'

type CcxtExchange = InstanceType<typeof ccxt.Exchange>

const CCXT_IDS: Record<ExchangeId, string> = {
  mexc:         'mexc',
  binance:      'binanceusdm',   // USDM фьючерсы
  bybit:        'bybit',
  okx:          'okx',
  gate:         'gateio',
  bitget:       'bitget',
  kucoin:       'kucoinfutures',
  bingx:        'bingx',
  hyperliquid:  'hyperliquid',
  aster:        'aster',
}

const API_KEYS: Record<ExchangeId, { apiKey?: string; secret?: string; password?: string }> = {
  mexc:        { apiKey: config.MEXC_API_KEY,    secret: config.MEXC_API_SECRET },
  binance:     { apiKey: config.BINANCE_API_KEY, secret: config.BINANCE_API_SECRET },
  bybit:       { apiKey: config.BYBIT_API_KEY,   secret: config.BYBIT_API_SECRET },
  okx:         { apiKey: config.OKX_API_KEY,     secret: config.OKX_API_SECRET, password: config.OKX_PASSPHRASE },
  gate:        { apiKey: config.GATE_API_KEY,    secret: config.GATE_API_SECRET },
  bitget:      { apiKey: config.BITGET_API_KEY,  secret: config.BITGET_API_SECRET, password: config.BITGET_PASSPHRASE },
  kucoin:      {},
  bingx:       {},
  hyperliquid: {},
  aster:       {},
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

          for (const [, mRaw] of Object.entries(rawMarkets)) {
            const m = mRaw as Record<string, unknown> | undefined
            if (!m) continue
            // Берём только USDT-маржированные бессрочные контракты
            if (!m['active']) continue
            if (!['USDT', 'USDC'].includes(m['settle'] as string) && !['USDT', 'USDC'].includes(m['quote'] as string)) continue
            if (m['type'] !== 'swap' && m['type'] !== 'future') continue
            if (m['expiry'] !== undefined && m['expiry'] !== null) continue  // только perps

            const base  = (m['base']  as string | undefined) ?? ''
            const quote = (m['quote'] as string | undefined) ?? ''
            if (!base || !quote) continue

            const market: ExchangeMarket = {
              exchange:     id,
              symbol:       (m['symbol']       as string) ?? '',
              rawSymbol:    (m['id']            as string) ?? '',
              baseAsset:    base,
              quoteAsset:   quote,
              marketType:   'futures',
              isActive:     (m['active']        as boolean) ?? true,
              contractSize: m['contractSize']   as number | undefined,
              minOrderSize: (m['limits'] as any)?.amount?.min,
              maxOrderSize: (m['limits'] as any)?.amount?.max,
              tickSize:     (m['precision'] as any)?.price,
              stepSize:     (m['precision'] as any)?.amount,
              maxLeverage:  (m['limits'] as any)?.leverage?.max,
              settleCurrency: m['settle'] as string | undefined,
            }

            // Нормализуем символ: 'BTC/USDT:USDT' → 'BTC/USDT', 'BTC/USDC:USDC' → 'BTC/USDC'
            const rawSym = (m['symbol'] as string | undefined) ?? `${base}/${quote}`
            const normalizedSymbol = rawSym.includes(':') ? rawSym.split(':')[0]! : `${base}/${quote}`
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
            // ccxt всегда заполняет t.symbol в формате 'BTC/USDT:USDT' для фьючерсов
            // Нормализуем убирая settle часть: 'BTC/USDT:USDT' → 'BTC/USDT'
            const sym = (t.symbol ?? rawSymbol) as string
            const normalizedSymbol = sym.includes(':') ? sym.split(':')[0]! : sym
            if (!this.commonSymbols.has(normalizedSymbol)) continue
            if (!t.bid || !t.ask) continue  // минимальное требование — наличие стакана

            const vol = t.quoteVolume ?? (t.baseVolume && t.last ? t.baseVolume * t.last : 0)

            const info = t.info as Record<string, unknown>

            tickerMap.set(normalizedSymbol, {
              exchange:      id,
              symbol:        normalizedSymbol,
              rawSymbol,
              marketType:    'futures',
              price:         t.last!,
              bid:           t.bid!,
              ask:           t.ask!,
              volume24h:     vol,
              openInterest:  typeof info['openInterest'] === 'number' ? info['openInterest'] : undefined,
              fundingRate:   typeof info['fundingRate'] === 'number' ? info['fundingRate'] : undefined,
              nextFundingAt: info['nextFundingTime']
                ? new Date(Number(info['nextFundingTime']))
                : undefined,
              markPrice:     typeof info['markPrice'] === 'number' ? info['markPrice'] : undefined,
              indexPrice:    typeof info['indexPrice'] === 'number' ? info['indexPrice'] : undefined,
              timestamp:     new Date(t.timestamp ?? Date.now()),
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
