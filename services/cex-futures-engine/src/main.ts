import { CexFuturesEngine } from './engine'
import { closeDb }          from '@spread/db'
import { closeRedis }       from './redis'
import { logger }           from './logger'
import http                 from 'node:http'

const engine = new CexFuturesEngine()

// ---------------------------------------------------------------------------
// Health-check HTTP server (для Kubernetes readiness/liveness probe)
// ---------------------------------------------------------------------------
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const healthy = engine.isHealthy()
    const stats   = engine.getStats()
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'starting', ...stats }))
    return
  }
  if (req.url === '/metrics') {
    // Пока пустой endpoint — prom-client будет добавлен в следующей итерации
    res.writeHead(200).end('# metrics\n')
    return
  }
  res.writeHead(404).end()
})

healthServer.listen(3001, () => {
  logger.info('Health server listening on :3001')
})

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  logger.info('=== CEX Futures Engine starting ===')

  try {
    await engine.start()
  } catch (err) {
    logger.fatal({ err }, 'Failed to start engine')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received')

  try {
    await engine.stop()
    await closeDb()
    await closeRedis()
    healthServer.close()
    logger.info('Graceful shutdown complete')
    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'Error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT',  () => void shutdown('SIGINT'))

process.on('uncaughtException',  (err) => logger.fatal({ err }, 'Uncaught exception'))
process.on('unhandledRejection', (reason) => logger.fatal({ reason }, 'Unhandled rejection'))

void main()
