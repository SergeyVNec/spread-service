import type { SpreadSnapshot } from '@spread/shared'
import { insertSpreadSnapshots } from '@spread/db'
import { config } from '../config'
import { logger } from '../logger'

/**
 * Буферизирует снапшоты и пишет в БД батчами каждые DB_WRITE_INTERVAL_MS.
 * Это снижает нагрузку на PostgreSQL при высокой частоте обновлений.
 */
export class DbWriter {
  private buffer: SpreadSnapshot[] = []
  private timer: NodeJS.Timeout | null = null
  private isFlushInProgress = false

  start(): void {
    this.timer = setInterval(
      () => void this.flush(),
      config.DB_WRITE_INTERVAL_MS,
    )
    logger.info({ interval: config.DB_WRITE_INTERVAL_MS }, 'DbWriter started')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Добавить снапшоты в буфер.
   * Записываем все (для истории), не только opportunity.
   */
  enqueue(snapshots: SpreadSnapshot[]): void {
    this.buffer.push(...snapshots)
  }

  private async flush(): Promise<void> {
    if (this.isFlushInProgress || this.buffer.length === 0) return

    this.isFlushInProgress = true
    const batch = this.buffer.splice(0, this.buffer.length)

    try {
      await insertSpreadSnapshots(batch)
      logger.debug({ count: batch.length }, 'Snapshots written to DB')
    } catch (err) {
      logger.error({ err, count: batch.length }, 'Failed to write snapshots to DB — data lost')
    } finally {
      this.isFlushInProgress = false
    }
  }

  /** Принудительный flush при завершении процесса */
  async forceFlush(): Promise<void> {
    this.stop()
    await this.flush()
  }
}
