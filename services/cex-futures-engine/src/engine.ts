import type { ExchangeId } from '@spread/shared'
import { ExchangeScanner }    from './scanner/exchange-scanner'
import { SpreadCalculator }   from './calculator/spread-calculator'
import { StatsCache }         from './calculator/stats-cache'
import { SpreadPublisher }    from './storage/publisher'
import { DbWriter }           from './storage/db-writer'
import { config }             from './config'
import { logger }             from './logger'

export class CexFuturesEngine {
  private scanner    = new ExchangeScanner()
  private calculator = new SpreadCalculator()
  private statsCache = new StatsCache()
  private publisher  = new SpreadPublisher()
  private dbWriter   = new DbWriter()

  private scanTimer: NodeJS.Timeout | null = null
  private isRunning = false
  private cycleCount = 0

  async start(): Promise<void> {
    logger.info('Starting CexFuturesEngine...')

    await this.scanner.init()
    this.dbWriter.start()

    // Первый цикл сразу
    await this.runCycle()

    // Последующие циклы по интервалу
    this.scanTimer = setInterval(
      () => void this.runCycle(),
      config.SCAN_INTERVAL_MS,
    )

    this.isRunning = true
    logger.info({ interval: config.SCAN_INTERVAL_MS }, 'CexFuturesEngine running')
  }

  async stop(): Promise<void> {
    logger.info('Stopping CexFuturesEngine...')

    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }

    await this.dbWriter.forceFlush()
    this.isRunning = false
    logger.info('CexFuturesEngine stopped')
  }

  private async runCycle(): Promise<void> {
    const cycleStart = Date.now()
    this.cycleCount++

    try {
      // 1. Получить тикеры со всех бирж параллельно
      const allTickers = await this.scanner.fetchAllTickers()

      if (allTickers.size === 0) {
        logger.warn('No tickers received, skipping cycle')
        return
      }

      // 2. Получить/обновить статистику (Z-score)
      //    Для производительности — обновляем кеш раз в 10 минут
      const statsMap = await this.buildStatsMap(allTickers)

      // 3. Рассчитать все спреды
      const snapshots = this.calculator.computeAll(allTickers, statsMap)

      // 4. Публикация в Redis (для WebSocket в API-сервере)
      const opportunities = snapshots.filter(s => s.isOpportunity)
      await Promise.all([
        this.publisher.publishOpportunities(opportunities),
        this.publisher.cacheTickers(allTickers),
      ])

      // 5. Буферизовать в БД
      this.dbWriter.enqueue(snapshots)

      const elapsed = Date.now() - cycleStart
      logger.info({
        cycle:         this.cycleCount,
        exchanges:     allTickers.size,
        snapshots:     snapshots.length,
        opportunities: opportunities.length,
        elapsedMs:     elapsed,
        topScore:      opportunities[0]?.score,
        topSymbol:     opportunities[0]?.symbol,
        topPair:       opportunities[0]
          ? `${opportunities[0].exchangeLong}→${opportunities[0].exchangeShort}`
          : undefined,
      }, 'Scan cycle complete')

    } catch (err) {
      logger.error({ err, cycle: this.cycleCount }, 'Scan cycle failed')
    }
  }

  /**
   * Строим карту статистики для всех актуальных пар.
   * Используем StatsCache — обращается к БД только раз в 10 минут.
   */
  private async buildStatsMap(
    allTickers: Map<ExchangeId, Map<string, unknown>>,
  ): Promise<Map<string, { mean: number; stdDev: number }>> {
    const statsMap = new Map<string, { mean: number; stdDev: number }>()
    const exchanges = Array.from(allTickers.keys())

    // Собираем уникальные символы
    const symbols = new Set<string>()
    for (const tickerMap of allTickers.values()) {
      for (const sym of tickerMap.keys()) symbols.add(sym)
    }

    // Параллельно запрашиваем статистику для всех пар
    const fetches: Array<Promise<void>> = []

    for (const symbol of symbols) {
      for (let i = 0; i < exchanges.length; i++) {
        for (let j = 0; j < exchanges.length; j++) {
          if (i === j) continue
          const exLong  = exchanges[i]!
          const exShort = exchanges[j]!

          if (!allTickers.get(exLong)?.has(symbol)) continue
          if (!allTickers.get(exShort)?.has(symbol)) continue

          const key = `${symbol}:${exLong}:${exShort}`

          fetches.push(
            this.statsCache
              .get(symbol, exLong, exShort)
              .then(stats => { if (stats) statsMap.set(key, stats) })
              .catch(() => {})  // не критично если одна пара упала
          )
        }
      }
    }

    await Promise.all(fetches)
    return statsMap
  }

  isHealthy(): boolean {
    return this.isRunning && this.cycleCount > 0
  }

  getStats() {
    return {
      isRunning:  this.isRunning,
      cycleCount: this.cycleCount,
      cacheSize:  this.statsCache.getCacheSize(),
    }
  }
}
