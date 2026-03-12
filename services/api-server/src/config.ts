import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL:    z.string().default('redis://localhost:6379'),
  PORT:         z.coerce.number().default(3000),
  HOST:         z.string().default('0.0.0.0'),
  NODE_ENV:     z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL:    z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN:  z.string().default('*'),
})

function loadConfig() {
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    console.error('[Config] Invalid env:', result.error.flatten().fieldErrors)
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
export type Config = typeof config
