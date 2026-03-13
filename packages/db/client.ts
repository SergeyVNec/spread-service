import pg from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { Database } from './types.js'

const { Pool } = pg

let _db: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!_db) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,              // держим пул маленьким — движок теперь батчует запросы
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error', err)
    })

    _db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
      log(event) {
        if (event.level === 'error') {
          console.error('[DB] Query error:', event.error)
        }
      },
    })
  }
  return _db
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy()
    _db = null
  }
}
