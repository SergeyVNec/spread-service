'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useWebSocket } from './useWebSocket'
import { fetchOpportunities, getWsUrl } from '@/lib/api'
import type { SpreadOpportunity } from '@/lib/api'
import clsx from 'clsx'

type RowKey = string
type FlashMap = Record<RowKey, 'green' | 'red' | null>
type Filter = 'all' | 'opportunity'

function rowKey(r: SpreadOpportunity) {
  return `${r.symbol}:${r.exchange_long}:${r.exchange_short}`
}
function safeFloat(v: string | null | undefined): number {
  const n = parseFloat(v ?? '0')
  return isNaN(n) ? 0 : n
}
function scoreColor(s: number) {
  return s >= 60 ? 'text-green' : s >= 40 ? 'text-yellow' : 'text-muted'
}
function scoreBarColor(s: number) {
  return s >= 60 ? 'bg-green' : s >= 40 ? 'bg-yellow' : 'bg-dim'
}

function ExchangeBadge({ name }: { name?: string | null }) {
  const colors: Record<string, string> = {
    mexc:    'bg-blue/10 text-blue border-blue/20',
    bybit:   'bg-yellow/10 text-yellow border-yellow/20',
    binance: 'bg-yellow/10 text-yellow border-yellow/20',
    bitget:  'bg-purple/10 text-purple border-purple/20',
    okx:     'bg-green/10 text-green border-green/20',
    gate:    'bg-red/10 text-red border-red/20',
  }
  const cls = colors[(name ?? '').toLowerCase()] ?? 'bg-dim text-muted border-border'
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
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const prevRef = useRef<Record<RowKey, SpreadOpportunity>>({})

  useEffect(() => {
    const load = () => {
      fetchOpportunities(200)
        .then(data => {
          const valid = data.filter(r => r?.symbol && r?.exchange_long && r?.exchange_short)
          if (valid.length === 0) return
          const byKey: Record<RowKey, SpreadOpportunity> = {}
          valid.forEach(r => {
            const key = rowKey(r)
            const ex = byKey[key]
            if (!ex || new Date(r.time) > new Date(ex.time)) byKey[key] = r
          })
          const deduped = Object.values(byKey).sort((a, b) => safeFloat(b.score) - safeFloat(a.score))
          setRows(deduped)
          prevRef.current = byKey
          setLastUpdate(new Date())
        })
        .catch(console.error)
    }
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleMessage = useCallback((data: unknown) => {
    try {
      const msg = data as { type: string; data?: SpreadOpportunity[] }
      if (msg.type === 'connected') { setConnected(true); return }
      if (msg.type === 'pong') return
      if (msg.type !== 'opportunities' || !Array.isArray(msg.data) || msg.data.length === 0) return

      const incoming = msg.data.filter(r => r?.symbol && r?.exchange_long && r?.exchange_short)
      if (incoming.length === 0) return

      const newFlash: FlashMap = {}
      incoming.forEach(r => {
        const key = rowKey(r)
        const prev = prevRef.current[key]
        if (prev) {
          const ns = safeFloat(r.spread_pct), os = safeFloat(prev.spread_pct)
          newFlash[key] = ns > os ? 'green' : ns < os ? 'red' : null
        }
        prevRef.current[key] = r
      })

      // Merge into existing rows (don't replace — WS may send only opportunities subset)
      setRows(prev => {
        const byKey = { ...prevRef.current }
        incoming.forEach(r => { byKey[rowKey(r)] = r })
        return Object.values(byKey).sort((a, b) => safeFloat(b.score) - safeFloat(a.score))
      })
      setFlash(newFlash)
      setLastUpdate(new Date())
      setTimeout(() => setFlash({}), 600)
    } catch (e) {
      console.error('WS error:', e)
    }
  }, [])

  useWebSocket(getWsUrl(), handleMessage)

  const filtered = rows.filter(r => {
    if (filter === 'opportunity' && !r.is_opportunity) return false
    if (search && !r.symbol.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const opportunityCount = rows.filter(r => r.is_opportunity).length

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-xs font-medium text-muted uppercase tracking-widest">All Pairs</h1>
          <span className="font-mono text-xs text-muted bg-dim px-2 py-0.5 rounded">{filtered.length}</span>
          {opportunityCount > 0 && (
            <span className="font-mono text-xs text-green bg-green/10 border border-green/20 px-2 py-0.5 rounded">
              ↑ {opportunityCount} opportunities
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search symbol..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-surface border border-border rounded px-3 py-1 text-xs font-mono text-text placeholder-muted focus:outline-none focus:border-dim w-40"
          />

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded p-0.5">
            {(['all', 'opportunity'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors',
                  filter === f ? 'bg-dim text-bright' : 'text-muted hover:text-text'
                )}
              >
                {f === 'all' ? 'All' : '⚡ Signals'}
              </button>
            ))}
          </div>

          {/* WS status */}
          <span className={clsx('flex items-center gap-1.5 text-xs font-mono', connected ? 'text-green' : 'text-muted')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green animate-pulse' : 'bg-dim')} />
            {connected ? 'WS' : 'Polling'}
          </span>
          {lastUpdate && <span className="text-xs font-mono text-muted">{lastUpdate.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-muted font-medium uppercase tracking-wider text-[10px] w-4"></th>
                {['Symbol','Long','Short','Spread%','Net%','Z-Score','Score','Updated'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-muted font-medium uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const key = rowKey(row)
                const spread = safeFloat(row.spread_pct)
                const net    = safeFloat(row.spread_net_pct)
                const z      = safeFloat(row.z_score)
                const score  = safeFloat(row.score)
                const fc     = flash[key] === 'green' ? 'flash-green' : flash[key] === 'red' ? 'flash-red' : ''
                const isOpp  = row.is_opportunity

                return (
                  <tr key={key} className={clsx(
                    'border-b border-border/50 hover:bg-dim/50 transition-colors cursor-pointer group',
                    fc,
                    isOpp && 'bg-green/[0.02]'
                  )}>
                    {/* Opportunity indicator */}
                    <td className="pl-3 pr-0 py-3">
                      {isOpp && <span className="text-green text-[10px]">⚡</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/pair/${encodeURIComponent(key)}`} className="block">
                        <span className={clsx('font-semibold group-hover:text-green transition-colors', isOpp ? 'text-bright' : 'text-text')}>
                          {row.symbol}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3"><ExchangeBadge name={row.exchange_long} /></td>
                    <td className="px-4 py-3"><ExchangeBadge name={row.exchange_short} /></td>
                    <td className="px-4 py-3">
                      <span className={isOpp ? 'text-green font-semibold' : 'text-text'}>
                        {spread.toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={net > 0 ? (isOpp ? 'text-green font-semibold' : 'text-green/60') : 'text-red/60'}>
                        {net.toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('font-semibold', z >= 2 ? 'text-green' : z >= 1 ? 'text-yellow' : 'text-muted')}>
                        {z.toFixed(2)}σ
                      </span>
                    </td>
                    <td className="px-4 py-3 w-32">
                      <div className="flex items-center gap-2">
                        <span className={clsx('font-semibold w-6 text-right', scoreColor(score))}>{score.toFixed(0)}</span>
                        <div className="score-bar flex-1">
                          <div className={clsx('score-bar-fill', scoreBarColor(score))} style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted text-[10px]">
                      {row.time ? new Date(row.time).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted">
                  {rows.length === 0 ? 'Loading...' : 'No pairs match filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
