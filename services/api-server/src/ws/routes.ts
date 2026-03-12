import type { FastifyInstance } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import { subscribe, unsubscribe, getStats } from './manager'

export async function wsRoutes(app: FastifyInstance) {

  app.get('/ws', { websocket: true }, (connection: SocketStream, _req) => {
    const ws = connection.socket

    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Spread Service WebSocket',
      channels: ['opportunities', 'spread:<symbol>:<exchangeLong>:<exchangeShort>'],
    }))

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
          return
        }

        if (msg.action === 'subscribe' && msg.channel) {
          subscribe(msg.channel, ws)
          ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }))
          return
        }

        if (msg.action === 'unsubscribe' && msg.channel) {
          ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }))
          return
        }

        ws.send(JSON.stringify({ type: 'error', message: 'Unknown action' }))
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      }
    })

    ws.on('close', () => {
      unsubscribe(ws)
    })
  })

  app.get('/ws/stats', async () => getStats())
}
