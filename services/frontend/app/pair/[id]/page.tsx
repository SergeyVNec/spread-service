import Link from 'next/link'
import SpreadChart from '@/components/SpreadChart'

interface Props {
  params: { id: string }
}

export default function PairPage({ params }: Props) {
  // id = "SYMBOL:exchangeLong:exchangeShort"
  const decoded = decodeURIComponent(params.id)
  const parts = decoded.split(':')
  const symbol       = parts[0] ?? ''
  const exchangeLong = parts[1] ?? ''
  const exchangeShort= parts[2] ?? ''

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-xs font-mono text-muted hover:text-text transition-colors flex items-center gap-1"
        >
          ← Back
        </Link>
        <span className="text-muted">/</span>
        <span className="text-xs font-mono text-bright font-semibold">{symbol}</span>
        <div className="flex items-center gap-2 ml-2">
          <span className="px-2 py-0.5 rounded border border-blue/20 bg-blue/10 text-blue text-[10px] font-mono uppercase">
            {exchangeLong}
          </span>
          <span className="text-muted font-mono text-xs">→</span>
          <span className="px-2 py-0.5 rounded border border-yellow/20 bg-yellow/10 text-yellow text-[10px] font-mono uppercase">
            {exchangeShort}
          </span>
        </div>
      </div>

      <SpreadChart
        symbol={symbol}
        exchangeLong={exchangeLong}
        exchangeShort={exchangeShort}
      />
    </div>
  )
}
