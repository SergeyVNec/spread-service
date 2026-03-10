import type { ExchangeId } from './exchange.types.js'
import type { EngineType } from './spread.types.js'

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'post-only'
export type OrderStatus = 'pending' | 'open' | 'filled' | 'partial' | 'cancelled' | 'rejected'
export type PositionStatus = 'open' | 'closed' | 'partial'
export type CloseReason = 'manual' | 'stop-loss' | 'take-profit' | 'funding-flip' | 'error'

export interface Order {
  id: string
  positionId?: string
  exchange: ExchangeId
  exchangeOrderId?: string
  symbol: string
  side: OrderSide
  orderType: OrderType
  quantity: number
  price?: number         // для limit
  status: OrderStatus
  filledQty: number
  avgFillPrice?: number
  fee?: number
  feeCurrency?: string
  createdAt: Date
  updatedAt: Date
}

export interface Position {
  id: string
  engineType: EngineType
  symbol: string
  status: PositionStatus
  // Параметры входа
  openedAt: Date
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  entrySpreadPct: number
  sizeUsd: number
  leverage: number
  // Текущее состояние (обновляется в реальном времени)
  currentSpreadPct?: number
  unrealizedPnl: number
  realizedPnl: number
  fundingEarned: number
  feesPaid: number
  // Закрытие
  closedAt?: Date
  exitSpreadPct?: number
  closeReason?: CloseReason
  // Связанные ордера
  orders?: Order[]
}

export interface OpenPositionRequest {
  engineType: EngineType
  symbol: string
  exchangeLong: ExchangeId
  exchangeShort: ExchangeId
  sizeUsd: number
  leverage?: number
  orderType?: OrderType
  limitPriceLong?: number   // для limit ордера
  limitPriceShort?: number
}
