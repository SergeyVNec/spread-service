import Redis from 'ioredis'
import { config } from './config.js'
import { logger } from './logger.js'

let _redis: Redis | null = null
let _redisPub: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })
    _redis.on('error', err => logger.error({ err }, '[Redis] connection error'))
    _redis.on('connect', () => logger.info('[Redis] connected'))
  }
  return _redis
}

/** Отдельный клиент для публикации (best practice с ioredis) */
export function getRedisPub(): Redis {
  if (!_redisPub) {
    _redisPub = new Redis(config.REDIS_URL, { lazyConnect: true })
    _redisPub.on('error', err => logger.error({ err }, '[Redis:pub] error'))
  }
  return _redisPub
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([_redis?.quit(), _redisPub?.quit()])
  _redis = null
  _redisPub = null
}
