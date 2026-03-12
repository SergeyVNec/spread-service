import type { FastifyInstance } from 'fastify'
import { subscribe, unsubscribe, getStats } from './manager'

export async function wsRoutes(app: FastifyInstance) {

  /**
   * ws://host/ws
   *
   * Клиент после коннекта шлёт JSON сообщение для подписки:
   * { "action": "subscribe", "channel": "opportunities" }
   * { "action": "subscribe", "channel": "spread:BTC/USDT:mexc:bybit" }
   * { "action": "unsubscribe", "channel": "opportunities" }
   * { "action": "ping" }
   */
  app.get('/ws', { websocket: true }, (socket, _req) => {
    // Отправляем приветствие
    socket.send(JSON.stringify({
      type: 'connected',
      message: 'Spread Service WebSocket',
      channels: ['opportunities', 'spread:<symbol>:<exchangeLong>:<exchangeShort>'],
    }))

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.action === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
          return
        }

        if (msg.action === 'subscribe' && msg.channel) {
          subscribe(msg.channel, socket)
          socket.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }))
          return
        }

        if (msg.action === 'unsubscribe' && msg.channel) {
          // Отписываем только от конкретного канала
          socket.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }))
          return
        }

        socket.send(JSON.stringify({ type: 'error', message: 'Unknown action' }))
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      }
    })

    socket.on('close', () => {
      unsubscribe(socket)
    })
  })

  // Статус WebSocket подключений
  app.get('/ws/stats', async () => getStats())
}
