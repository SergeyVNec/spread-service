import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spread Monitor',
  description: 'CEX Futures Spread Monitor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg">
        {/* Top nav */}
        <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-[1600px] mx-auto px-4 h-12 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
              <span className="font-mono text-sm font-semibold text-bright tracking-widest uppercase">
                Spread Monitor
              </span>
              <span className="text-muted font-mono text-xs">CEX Futures</span>
            </div>
            <div className="flex items-center gap-4 font-mono text-xs text-muted">
              <span id="live-indicator" className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
                LIVE
              </span>
            </div>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
