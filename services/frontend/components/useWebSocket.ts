'use client'
import { useEffect, useRef, useCallback } from 'react'

type MsgHandler = (data: unknown) => void

export function useWebSocket(url: string, onMessage: MsgHandler) {
  const ws = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(url)
    ws.current = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: 'subscribe', channel: 'opportunities' }))
    }

    socket.onmessage = (e) => {
      try { onMsgRef.current(JSON.parse(e.data)) } catch {}
    }

    socket.onclose = () => {
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }

    socket.onerror = () => { socket.close() }
  }, [url])

  useEffect(() => {
    connect()
    return () => { ws.current?.close() }
  }, [connect])
}
