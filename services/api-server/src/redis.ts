import IORedis from 'ioredis'
import { config } from './config'

type RedisClient = InstanceType<typeof IORedis>

let _redis: RedisClient | null = null
let _redisSub: RedisClient | null = null

export function getRedis(): RedisClient {
  if (!_redis) {
    _redis = new IORedis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })
    _redis.on('error', err => console.error('[Redis] error', err))
  }
  return _redis
}

/** Отдельный клиент для подписки — нельзя использовать один и тот же */
export function getRedisSub(): RedisClient {
  if (!_redisSub) {
    _redisSub = new IORedis(config.REDIS_URL, { lazyConnect: true })
    _redisSub.on('error', err => console.error('[Redis:sub] error', err))
  }
  return _redisSub
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([_redis?.quit(), _redisSub?.quit()])
  _redis = null
  _redisSub = null
}
