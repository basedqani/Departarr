import { useState, useEffect } from 'react'

interface FlightTimes {
  departureScheduled: string
  departureEstimated?: string | null
  departureActual?: string | null
  arrivalScheduled: string
  arrivalEstimated?: string | null
  arrivalActual?: string | null
  status: string
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const seconds = totalSeconds % 60

  if (ms >= 60 * 60 * 1000) {
    // >= 1 hour: show "Xh Ym" (omit minutes if 0)
    if (minutes === 0) return `${hours}h`
    return `${hours}h ${minutes}m`
  }
  if (ms >= 2 * 60 * 1000) {
    // >= 2 min but < 1 hour: show "Xm"
    return `${totalMinutes}m`
  }
  // < 2 min: show "Xm Ys"
  return `${totalMinutes}m ${seconds}s`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatRelativeDay(date: Date): string {
  const now = new Date()
  // Compare calendar days
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((dateStart.getTime() - todayStart.getTime()) / 86400_000)

  if (dayDiff === 1) return 'tomorrow'
  if (dayDiff > 1 && dayDiff < 7) return `in ${dayDiff} days`
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function computeCountdown(flight: FlightTimes): string {
  const now = Date.now()
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')

  const depTime = new Date(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled).getTime()
  const arrTime = new Date(flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()

  if (st === 'cancelled') return 'Cancelled'
  if (st === 'diverted') return 'Diverted'

  if ((st === 'arrived' || st === 'landed') && flight.arrivalActual) {
    return `Landed ${timeAgo(flight.arrivalActual)}`
  }

  if (st === 'en-route' || st === 'departed') {
    if (arrTime > now) return `Lands in ${formatDuration(arrTime - now)}`
    return 'Landing soon'
  }

  if (st === 'boarding') {
    if (depTime > now) return `Boarding · Departs in ${formatDuration(depTime - now)}`
    return 'Boarding · Departing soon'
  }

  // scheduled / unknown
  if (depTime > now) {
    const diff = depTime - now
    if (diff > 24 * 60 * 60 * 1000) return `Departs ${formatRelativeDay(new Date(depTime))}`
    return `Departs in ${formatDuration(diff)}`
  }

  return 'Departing soon'
}

function getTickInterval(flight: FlightTimes): number {
  const now = Date.now()
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')

  // Terminal states don't need ticking
  if (st === 'cancelled' || st === 'diverted') return 0
  if ((st === 'arrived' || st === 'landed') && flight.arrivalActual) return 0

  const depTime = new Date(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled).getTime()
  const arrTime = new Date(flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()

  const relevantTime = (st === 'en-route' || st === 'departed') ? arrTime : depTime
  const diff = relevantTime - now

  if (diff < 2 * 60 * 1000) return 1_000   // < 2 min: tick every second
  if (diff < 60 * 60 * 1000) return 10_000  // < 1 hour: tick every 10s
  return 60_000                               // otherwise: tick every 60s
}

export function useCountdown(flight: FlightTimes): string {
  const [text, setText] = useState(() => computeCountdown(flight))

  useEffect(() => {
    const interval = getTickInterval(flight)
    if (interval === 0) return

    const id = setInterval(() => {
      setText(computeCountdown(flight))
    }, interval)

    return () => clearInterval(id)
  }, [flight])

  return text
}
