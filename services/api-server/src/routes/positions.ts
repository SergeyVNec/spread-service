import type { FastifyInstance } from 'fastify'
import { getDb } from '@spread/db'

export async function positionsRoutes(app: FastifyInstance) {

  /**
   * GET /api/v1/positions
   * Список позиций (открытые + последние закрытые)
   */
  app.get('/api/v1/positions', async (req, reply) => {
    const q = req.query as { status?: string; limit?: string }
    const db = getDb()

    let query = db
      .selectFrom('positions')
      .selectAll()
      .orderBy('opened_at', 'desc')
      .limit(Math.min(parseInt(q.limit ?? '50'), 200))

    if (q.status) {
      query = query.where('status', '=', q.status)
    }

    const rows = await query.execute()
    return reply.send({ data: rows, count: rows.length })
  })

  /**
   * GET /api/v1/positions/:id
   * Одна позиция с ордерами
   */
  app.get('/api/v1/positions/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const position = await db
      .selectFrom('positions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (!position) return reply.status(404).send({ error: 'Position not found' })

    const orders = await db
      .selectFrom('orders')
      .selectAll()
      .where('position_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute()

    return reply.send({ data: { ...position, orders } })
  })

  /**
   * GET /api/v1/positions/summary
   * Сводка PnL: реализованный, нереализованный, фандинг, комиссии
   */
  app.get('/api/v1/positions/summary', async (_req, reply) => {
    const db = getDb()

    const summary = await db
      .selectFrom('positions')
      .select(qb => [
        qb.fn.sum('realized_pnl').as('total_realized_pnl'),
        qb.fn.sum('unrealized_pnl').as('total_unrealized_pnl'),
        qb.fn.sum('funding_earned').as('total_funding_earned'),
        qb.fn.sum('fees_paid').as('total_fees_paid'),
        qb.fn.count('id').as('total_positions'),
        qb.fn.sum<number>(
          qb.case()
            .when('status', '=', 'open').then(1 as unknown as never)
            .else(0 as unknown as never)
            .end()
        ).as('open_positions'),
      ])
      .executeTakeFirst()

    return reply.send({ data: summary })
  })
}
