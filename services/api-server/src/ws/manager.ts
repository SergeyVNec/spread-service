import type { WebSocket } from 'ws'
import { getRedisSub } from '../redis'
import { REDIS_CHANNEL_OPPORTUNITIES } from '@spread/shared'

type WsClient = WebSocket

// Подписки клиентов: channel → Set<WebSocket>
const subscriptions = new Map<string, Set<WsClient>>()

/**
 * Зарегистрировать клиента на канал.
 * channel примеры:
 *   'opportunities'                         — все сигналы
 *   'spread:BTC/USDT:mexc:bybit'            — конкретная пара
 */
export function subscribe(channel: string, ws: WsClient): void {
  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set())
  }
  subscriptions.get(channel)!.add(ws)
}

export function unsubscribe(ws: WsClient): void {
  for (const clients of subscriptions.values()) {
    clients.delete(ws)
  }
}

export function broadcast(channel: string, data: unknown): void {
  const clients = subscriptions.get(channel)
  if (!clients || clients.size === 0) return

  const payload = JSON.stringify(data)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload)
    }
  }
}

export function getStats() {
  let total = 0
  const channels: Record<string, number> = {}
  for (const [ch, clients] of subscriptions) {
    channels[ch] = clients.size
    total += clients.size
  }
  return { total, channels }
}

/**
 * Запустить Redis → WebSocket bridge.
 * Подписывается на все нужные каналы Redis и форвардит сообщения клиентам.
 */
export async function startRedisBridge(): Promise<void> {
  const sub = getRedisSub()

  // Подписываемся на канал opportunities
  await sub.subscribe(REDIS_CHANNEL_OPPORTUNITIES)

  sub.on('message', (channel: string, message: string) => {
    try {
      const data = JSON.parse(message)

      if (channel === REDIS_CHANNEL_OPPORTUNITIES) {
        // Всем подписчикам 'opportunities'
        broadcast('opportunities', { type: 'opportunities', ...data })

        // Также рассылаем по конкретным парам
        if (Array.isArray(data.data)) {
          for (const snap of data.data) {
            const pairChannel = `spread:${snap.symbol}:${snap.exchangeLong}:${snap.exchangeShort}`
            broadcast(pairChannel, { type: 'spread', data: snap })
          }
        }
      }
    } catch {
      // ignore malformed messages
    }
  })
}
