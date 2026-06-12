import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface FlightUpdateMessage {
  type: 'flight_update'
  flightId: string
  ident: string
  eventType: string
  message: string
}

export function useFlightUpdates(): void {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    function connect(): void {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${protocol}://${location.host}/ws?token=${encodeURIComponent(token!)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as FlightUpdateMessage
          if (msg.type === 'flight_update') {
            // Invalidate relevant queries
            void queryClient.invalidateQueries({ queryKey: ['flights'] })
            void queryClient.invalidateQueries({ queryKey: ['flight', msg.flightId] })
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        // Reconnect after 5s
        reconnectRef.current = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [queryClient])
}
