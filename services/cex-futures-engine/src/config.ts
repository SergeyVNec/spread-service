import { z } from 'zod'

const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Exchange API keys (все необязательные — без ключей работаем в read-only)
  MEXC_API_KEY:       z.string().optional(),
  MEXC_API_SECRET:    z.string().optional(),
  BINANCE_API_KEY:    z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BYBIT_API_KEY:      z.string().optional(),
  BYBIT_API_SECRET:   z.string().optional(),
  OKX_API_KEY:        z.string().optional(),
  OKX_API_SECRET:     z.string().optional(),
  OKX_PASSPHRASE:     z.string().optional(),
  GATE_API_KEY:       z.string().optional(),
  GATE_API_SECRET:    z.string().optional(),
  BITGET_API_KEY:     z.string().optional(),
  BITGET_API_SECRET:  z.string().optional(),
  BITGET_PASSPHRASE:  z.string().optional(),

  // Параметры сканирования
  MIN_VOLUME_USD:     z.coerce.number().default(0),
  MIN_NET_SPREAD_PCT: z.coerce.number().default(0),
  SCAN_INTERVAL_MS:   z.coerce.number().default(5_000),
  DB_WRITE_INTERVAL_MS: z.coerce.number().default(10_000),

  // Окружение
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

function loadConfig() {
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    console.error('[Config] Invalid environment variables:')
    console.error(result.error.flatten().fieldErrors)
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
export type Config = typeof config
