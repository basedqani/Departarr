import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface FlightUpdateMessage {
  type: 'flight_update'
  flightId: string
  ident: string
  eventType: string
  message: string
}

// GEN-6 reconnect tuning: exponential backoff, capped, with a hard attempt
// limit so a permanently-failing socket (e.g. revoked token) stops hammering.
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const MAX_ATTEMPTS = 8

export function useFlightUpdates(): void {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let attempts = 0
    let stopped = false

    function connect(): void {
      if (stopped) return
      // Re-read the token each attempt: if it's gone (logout/expiry) stop
      // reconnecting instead of looping forever against an auth failure.
      const token = localStorage.getItem('token')
      if (!token) return

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        attempts = 0 // reset backoff on a successful connection
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as FlightUpdateMessage
          if (msg.type === 'flight_update') {
            void queryClient.invalidateQueries({ queryKey: ['flights'] })
            void queryClient.invalidateQueries({ queryKey: ['flight', msg.flightId] })
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        if (stopped) return
        // Stop if the token is gone or we've exhausted retry attempts.
        if (!localStorage.getItem('token')) return
        if (attempts >= MAX_ATTEMPTS) return
        const delay = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS)
        attempts += 1
        reconnectRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [queryClient])
}
