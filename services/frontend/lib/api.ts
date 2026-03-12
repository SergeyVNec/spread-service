export interface SpreadOpportunity {
  time: string
  engine_type: string
  symbol: string
  exchange_long: string
  exchange_short: string
  price_long: string
  price_short: string
  spread_abs: string
  spread_pct: string
  spread_net_pct: string
  funding_rate_long: string | null
  funding_rate_short: string | null
  funding_edge_pct: string | null
  z_score: string
  score: string
  is_opportunity: boolean
}

export interface PairRow {
  symbol: string
  exchange_long: string
  exchange_short: string
  avg_spread_pct: number
  avg_spread_net_pct: number
  max_score: number
  sample_count: number
  opportunity_count: number
}

export interface SpreadCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface SpreadStats {
  mean: number
  std: number
  min: number
  max: number
  count: number
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://spread.46.225.6.40.nip.io'

export async function fetchOpportunities(limit = 30): Promise<SpreadOpportunity[]> {
  const r = await fetch(`${API_BASE}/api/v1/spreads/opportunities?limit=${limit}`, { next: { revalidate: 0 } })
  const j = await r.json()
  return j.data ?? []
}

export async function fetchPairs(): Promise<PairRow[]> {
  const r = await fetch(`${API_BASE}/api/v1/spreads/pairs`, { next: { revalidate: 0 } })
  const j = await r.json()
  return j.data ?? []
}

export async function fetchCandles(
  symbol: string,
  exchangeLong: string,
  exchangeShort: string,
  resolution = '5m'
): Promise<SpreadCandle[]> {
  const params = new URLSearchParams({ symbol, exchangeLong, exchangeShort, resolution })
  const r = await fetch(`${API_BASE}/api/v1/spreads/candles?${params}`, { next: { revalidate: 0 } })
  const j = await r.json()
  return j.data ?? []
}

export function getWsUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://spread.46.225.6.40.nip.io')
    .replace(/^http/, 'ws')
  return `${base}/ws`
}
