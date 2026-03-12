import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import { config } from './config'
import { getRedis, getRedisSub, closeRedis } from './redis'
import { getDb, closeDb } from '@spread/db'
import { spreadsRoutes } from './routes/spreads'
import { positionsRoutes } from './routes/positions'
import { wsRoutes } from './ws/routes'
import { startRedisBridge } from './ws/manager'

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    base: { service: 'api-server' },
  },
})

async function main() {
  // Плагины
  await app.register(fastifyCors, { origin: config.CORS_ORIGIN })
  await app.register(fastifyWebsocket)

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
    env: config.NODE_ENV,
  }))

  // REST routes
  await app.register(spreadsRoutes)
  await app.register(positionsRoutes)

  // WebSocket routes
  await app.register(wsRoutes)

  // Подключиться к Redis и запустить bridge Redis → WS
  await getRedis().connect().catch(() => {}) // lazyConnect — игнорируем если уже подключён
  await getRedisSub().connect().catch(() => {})
  await startRedisBridge()

  app.log.info('Redis bridge started')

  // Запустить сервер
  await app.listen({ port: config.PORT, host: config.HOST })
  app.log.info(`API server listening on ${config.HOST}:${config.PORT}`)
}

// Graceful shutdown
async function shutdown() {
  app.log.info('Shutting down...')
  await app.close()
  await closeRedis()
  await closeDb()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
