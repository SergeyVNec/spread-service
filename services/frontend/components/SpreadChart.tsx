'use client'
import { useEffect, useRef, useState } from 'react'
import { fetchCandles } from '@/lib/api'
import type { SpreadCandle } from '@/lib/api'

interface Props {
  symbol: string
  exchangeLong: string
  exchangeShort: string
}

const RESOLUTIONS = ['1m', '5m', '15m', '1h', '4h'] as const
type Resolution = typeof RESOLUTIONS[number]

export default function SpreadChart({ symbol, exchangeLong, exchangeShort }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [resolution, setResolution] = useState<Resolution>('5m')
  const [candles, setCandles] = useState<SpreadCandle[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ min: 0, max: 0, avg: 0, last: 0 })

  useEffect(() => {
    setLoading(true)
    fetchCandles(symbol, exchangeLong, exchangeShort, resolution).then(data => {
      setCandles(data)
      if (data.length > 0) {
        const vals = data.map(c => c.close)
        setStats({
          min: Math.min(...vals),
          max: Math.max(...vals),
          avg: vals.reduce((a, b) => a + b, 0) / vals.length,
          last: vals[vals.length - 1],
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [symbol, exchangeLong, exchangeShort, resolution])

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    import('lightweight-charts').then((lc) => {
      const { createChart, CrosshairMode, LineStyle } = lc

      // Clear previous chart
      containerRef.current!.innerHTML = ''

      const chart = createChart(containerRef.current!, {
        width: containerRef.current!.offsetWidth,
        height: 340,
        layout: {
          background: { color: '#0f0f17' },
          textColor: '#4a4a6a',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: '#1a1a2e', style: LineStyle.Dotted },
          horzLines: { color: '#1a1a2e', style: LineStyle.Dotted },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1a1a2e' },
        timeScale: {
          borderColor: '#1a1a2e',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: true,
        handleScale: true,
      })

      const areaSeries = chart.addAreaSeries({
        lineColor: '#00d4aa',
        topColor: 'rgba(0, 212, 170, 0.15)',
        bottomColor: 'rgba(0, 212, 170, 0)',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (p: number) => p.toFixed(4) + '%',
          minMove: 0.0001,
        },
      })

      const avgLine = chart.addLineSeries({
        color: '#ffcc44',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
      })

      const avg = stats.avg

      // UTCTimestamp must be integer seconds
      // API may return ms or seconds — detect by magnitude
      const toUTCSec = (t: number): number => {
        const n = Math.floor(t)
        // If > year 2100 in seconds (4102444800), it's probably milliseconds
        return n > 4102444800 ? Math.floor(n / 1000) : n
      }

      // Sort by time ascending, deduplicate
      const seen = new Set<number>()
      const spreadData = candles
        .map(c => ({ time: toUTCSec(c.time), value: c.close }))
        .sort((a, b) => a.time - b.time)
        .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
        .map(c => ({ time: c.time as unknown as import('lightweight-charts').Time, value: c.value }))

      const avgData = spreadData.map(c => ({ time: c.time, value: avg }))

      areaSeries.setData(spreadData)
      avgLine.setData(avgData)
      chart.timeScale().fitContent()

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.offsetWidth })
      })
      ro.observe(containerRef.current!)

      return () => { ro.disconnect(); chart.remove() }
    })
  }, [candles, stats.avg])

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Current', value: stats.last.toFixed(4) + '%', cls: 'text-green' },
          { label: 'Average', value: stats.avg.toFixed(4) + '%', cls: 'text-yellow' },
          { label: 'Min',     value: stats.min.toFixed(4) + '%', cls: 'text-muted' },
          { label: 'Max',     value: stats.max.toFixed(4) + '%', cls: 'text-bright' },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-lg p-4">
            <div className="text-[10px] font-mono text-muted uppercase tracking-wider mb-1">{s.label}</div>
            <div className={`text-lg font-mono font-semibold ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Resolution */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted uppercase tracking-wider mr-2">Resolution</span>
        {RESOLUTIONS.map(r => (
          <button
            key={r}
            onClick={() => setResolution(r)}
            className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
              resolution === r
                ? 'bg-green/10 border-green/30 text-green'
                : 'bg-surface border-border text-muted hover:text-text hover:border-dim'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="border border-border rounded-lg overflow-hidden bg-surface">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted">
            Spread % · {symbol} · {exchangeLong} → {exchangeShort}
          </span>
          <span className="text-[10px] font-mono text-muted">{candles.length} candles</span>
        </div>
        {loading ? (
          <div className="h-[340px] flex items-center justify-center text-muted font-mono text-sm">
            Loading chart...
          </div>
        ) : candles.length === 0 ? (
          <div className="h-[340px] flex items-center justify-center text-muted font-mono text-sm">
            No data available
          </div>
        ) : (
          <div ref={containerRef} className="w-full" />
        )}
      </div>
    </div>
  )
}
