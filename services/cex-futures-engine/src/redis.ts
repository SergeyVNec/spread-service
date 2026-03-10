import IORedis from 'ioredis'
import { config } from './config'
import { logger } from './logger'

type RedisClient = InstanceType<typeof IORedis>

let _redis: RedisClient | null = null
let _redisPub: RedisClient | null = null

export function getRedis(): RedisClient {
  if (!_redis) {
    _redis = new IORedis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })
    _redis.on('error', (err: unknown) => logger.error({ err }, '[Redis] connection error'))
    _redis.on('connect', () => logger.info('[Redis] connected'))
  }
  return _redis
}

/** Отдельный клиент для публикации (best practice с ioredis) */
export function getRedisPub(): RedisClient {
  if (!_redisPub) {
    _redisPub = new IORedis(config.REDIS_URL, { lazyConnect: true })
    _redisPub.on('error', (err: unknown) => logger.error({ err }, '[Redis:pub] error'))
  }
  return _redisPub
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([_redis?.quit(), _redisPub?.quit()])
  _redis = null
  _redisPub = null
}
