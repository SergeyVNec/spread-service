import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

// ---------------------------------------------------------------------------
// TimescaleDB tables
// ---------------------------------------------------------------------------

export interface PriceTickTable {
  time:            Date
  symbol:          string
  exchange:        string
  market_type:     string
  price:           number
  bid:             number | null
  ask:             number | null
  volume_24h:      number | null
  open_interest:   number | null
  funding_rate:    number | null
  next_funding_at: Date | null
  mark_price:      number | null
  index_price:     number | null
}

export interface SpreadSnapshotTable {
  time:               Date
  engine_type:        string
  symbol:             string
  exchange_long:      string
  exchange_short:     string
  price_long:         number
  price_short:        number
  spread_abs:         number
  spread_pct:         number
  spread_net_pct:     number | null
  funding_rate_long:  number | null
  funding_rate_short: number | null
  funding_edge_pct:   number | null
  z_score:            number | null
  score:              number | null
  is_opportunity:     boolean
}

// ---------------------------------------------------------------------------
// Regular PostgreSQL tables
// ---------------------------------------------------------------------------

export interface PositionTable {
  id:               Generated<string>
  engine_type:      string
  symbol:           string
  status:           string
  opened_at:        Generated<Date>
  exchange_long:    string
  exchange_short:   string
  entry_spread_pct: number | null
  size_usd:         number | null
  leverage:         Generated<number>
  unrealized_pnl:   Generated<number>
  realized_pnl:     Generated<number>
  funding_earned:   Generated<number>
  fees_paid:        Generated<number>
  closed_at:        Date | null
  exit_spread_pct:  number | null
  close_reason:     string | null
  notes:            string | null
}

export interface OrderTable {
  id:                Generated<string>
  position_id:       string | null
  exchange:          string
  exchange_order_id: string | null
  symbol:            string
  side:              string
  order_type:        string
  quantity:          number | null
  price:             number | null
  status:            Generated<string>
  filled_qty:        Generated<number>
  avg_fill_price:    number | null
  fee:               number | null
  fee_currency:      string | null
  raw_response:      unknown | null
  created_at:        Generated<Date>
  updated_at:        Generated<Date>
}

export interface AlertConfigTable {
  id:               Generated<string>
  name:             string
  engine_type:      string | null
  symbol:           string | null
  condition_type:   string
  threshold:        number | null
  channel:          Generated<string>
  channel_config:   unknown | null
  cooldown_min:     Generated<number>
  is_active:        Generated<boolean>
  created_at:       Generated<Date>
}

export interface AlertEventTable {
  id:               Generated<string>
  alert_config_id:  string | null
  triggered_at:     Generated<Date>
  symbol:           string | null
  value:            number | null
  message:          string | null
}

// ---------------------------------------------------------------------------
// Kysely Database interface
// ---------------------------------------------------------------------------

export interface Database {
  price_ticks:        PriceTickTable
  spread_snapshots:   SpreadSnapshotTable
  positions:          PositionTable
  orders:             OrderTable
  alert_configs:      AlertConfigTable
  alert_events:       AlertEventTable
}

// Convenience types
export type SpreadSnapshotRow = Selectable<SpreadSnapshotTable>
export type InsertSpreadSnapshot = Insertable<SpreadSnapshotTable>
export type PositionRow = Selectable<PositionTable>
export type InsertPosition = Insertable<PositionTable>
