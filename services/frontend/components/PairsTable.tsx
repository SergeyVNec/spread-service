'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useWebSocket } from './useWebSocket'
import { fetchOpportunities, getWsUrl } from '@/lib/api'
import type { SpreadOpportunity } from '@/lib/api'
import clsx from 'clsx'

type RowKey = string
type FlashMap = Record<RowKey, 'green' | 'red' | null>

function rowKey(r: SpreadOpportunity) {
  return `${r.symbol}:${r.exchange_long}:${r.exchange_short}`
}

function scoreColor(score: number) {
  if (score >= 70) return 'text-green'
  if (score >= 50) return 'text-yellow'
  return 'text-muted'
}

function scoreBarColor(score: number) {
  if (score >= 70) return 'bg-green'
  if (score >= 50) return 'bg-yellow'
  return 'bg-muted'
}

function ExchangeBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    mexc:    'bg-blue/10 text-blue border-blue/20',
    bybit:   'bg-yellow/10 text-yellow border-yellow/20',
    binance: 'bg-yellow/10 text-yellow border-yellow/20',
    bitget:  'bg-purple/10 text-purple border-purple/20',
    okx:     'bg-green/10 text-green border-green/20',
    gate:    'bg-red/10 text-red border-red/20',
  }
  const key = (name ?? '').toLowerCase()
  const cls = colors[key] ?? 'bg-dim text-muted border-border'
  return (
    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium uppercase tracking-wider', cls)}>
      {name ?? '—'}
    </span>
  )
}

export default function PairsTable() {
  const [rows, setRows] = useState<SpreadOpportunity[]>([])
  const [flash, setFlash] = useState<FlashMap>({})
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const prevRef = useRef<Record<RowKey, SpreadOpportunity>>({})

  // Initial load
  useEffect(() => {
    fetchOpportunities(50).then(data => {
      setRows(data)
      const map: Record<RowKey, SpreadOpportunity> = {}
      data.forEach(r => { map[rowKey(r)] = r })
      prevRef.current = map
    })
  }, [])

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as { type: string; data?: SpreadOpportunity[] }
    if (msg.type === 'connected') { setConnected(true); return }
    if (msg.type !== 'opportunities' || !Array.isArray(msg.data)) return

    const incoming = (msg.data as SpreadOpportunity[]).filter(
      r => r && r.symbol && r.exchange_long && r.exchange_short
    )
    const newFlash: FlashMap = {}

    incoming.forEach(r => {
      const key = rowKey(r)
      const prev = prevRef.current[key]
      if (prev) {
        const newSpread = parseFloat(r.spread_pct)
        const oldSpread = parseFloat(prev.spread_pct)
        newFlash[key] = newSpread > oldSpread ? 'green' : newSpread < oldSpread ? 'red' : null
      }
      prevRef.current[key] = r
    })

    setRows(incoming)
    setFlash(newFlash)
    setLastUpdate(new Date())

    // Clear flash after animation
    setTimeout(() => setFlash({}), 600)
  }, [])

  useWebSocket(getWsUrl(), handleMessage)

  return (
    <div className="animate-fade-in">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-xs font-medium text-muted uppercase tracking-widest">
            Live Opportunities
          </h1>
          <span className="font-mono text-xs text-muted bg-dim px-2 py-0.5 rounded">
            {rows.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono text-muted">
          <span className={clsx('flex items-center gap-1.5', connected ? 'text-green' : 'text-red')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green animate-pulse' : 'bg-red')} />
            {connected ? 'WS Connected' : 'Connecting...'}
          </span>
          {lastUpdate && (
            <span className="text-muted">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                {['Symbol', 'Long', 'Short', 'Spread%', 'Net%', 'Z-Score', 'Score', 'Updated'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-muted font-medium uppercase tracking-wider text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row)
                const spread = parseFloat(row.spread_pct)
                const netSpread = parseFloat(row.spread_net_pct)
                const zScore = parseFloat(row.z_score)
                const score = parseFloat(row.score)
                const flashCls = flash[key] === 'green' ? 'flash-green' : flash[key] === 'red' ? 'flash-red' : ''

                return (
                  <tr
                    key={key}
                    className={clsx(
                      'border-b border-border/50 hover:bg-dim/50 transition-colors cursor-pointer group',
                      flashCls
                    )}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/pair/${encodeURIComponent(key)}`} className="block">
                        <span className="text-bright font-semibold group-hover:text-green transition-colors">
                          {row.symbol}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <ExchangeBadge name={row.exchange_long} />
                    </td>
                    <td className="px-4 py-3">
                      <ExchangeBadge name={row.exchange_short} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-green font-semibold">
                        {spread.toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={netSpread > 0 ? 'text-green' : 'text-red'}>
                        {netSpread.toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'font-semibold',
                        zScore >= 2 ? 'text-green' : zScore >= 1 ? 'text-yellow' : 'text-muted'
                      )}>
                        {zScore.toFixed(2)}σ
                      </span>
                    </td>
                    <td className="px-4 py-3 w-32">
                      <div className="flex items-center gap-2">
                        <span className={clsx('font-semibold w-6 text-right', scoreColor(score))}>
                          {score.toFixed(0)}
                        </span>
                        <div className="score-bar flex-1">
                          <div
                            className={clsx('score-bar-fill', scoreBarColor(score))}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted text-[10px]">
                      {new Date(row.time).toLocaleTimeString()}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted">
                    Loading opportunities...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
