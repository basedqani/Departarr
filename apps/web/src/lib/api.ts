const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

function getToken(): string | null {
  return localStorage.getItem('token')
}

export function setToken(token: string): void {
  localStorage.setItem('token', token)
}

export function clearToken(): void {
  localStorage.removeItem('token')
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// Auth
export const api = {
  auth: {
    register: (data: { email: string; password: string; name: string }) =>
      request<{ token: string; user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request<User>('/auth/me'),
  },

  flights: {
    list: (when?: string) =>
      request<Flight[]>(`/flights${when ? `?when=${when}` : ''}`),
    get: (id: string) =>
      request<FlightWithEvents>(`/flights/${id}`),
    add: (data: { ident: string; date: string; tripId?: string }) =>
      request<Flight>('/flights', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/flights/${id}`, { method: 'DELETE' }),
    patch: (id: string, body: { seat?: string | null; confirmationCode?: string | null; tripId?: string | null }) =>
      request<Flight>(`/flights/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    position: (id: string) =>
      request<AircraftPosition>(`/flights/${id}/position`),
    getPhoto: async (id: string): Promise<AircraftPhoto | null> => {
      const token = localStorage.getItem('token')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'
      const res = await fetch(`${BASE_URL}/flights/${id}/photo`, { headers })
      if (res.status === 204) return null
      if (!res.ok) return null
      return res.json() as Promise<AircraftPhoto>
    },
    share: (id: string) =>
      request<{ token: string; url: string }>(`/flights/${id}/share`, { method: 'POST' }),
    revokeShare: (id: string) =>
      request<void>(`/flights/${id}/share`, { method: 'DELETE' }),
  },

  trips: {
    list: () => request<Trip[]>('/trips'),
    get: (id: string) => request<TripWithFlights>(`/trips/${id}`),
    create: (data: { name: string; startDate?: string; endDate?: string }) =>
      request<Trip>('/trips', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; startDate?: string; endDate?: string }) =>
      request<Trip>(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/trips/${id}`, { method: 'DELETE' }),
    addFlight: (tripId: string, flightId: string) =>
      request<Flight>(`/trips/${tripId}/flights`, { method: 'POST', body: JSON.stringify({ flightId }) }),
  },

  share: {
    get: (token: string) =>
      request<{ flight?: FlightWithEvents; trip?: TripWithFlights }>(`/share/${token}`),
    pushSubscribe: (token: string, sub: PushSubscriptionJSON) =>
      request<{ ok: boolean }>(`/share/${token}/push-subscribe`, { method: 'POST', body: JSON.stringify(sub) }),
    pushUnsubscribe: (token: string, endpoint: string) =>
      request<void>(`/share/${token}/push-subscribe`, { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  },

  push: {
    getVapidKey: () => request<{ publicKey: string }>('/push/vapid-public-key'),
    subscribe: (sub: PushSubscriptionJSON) =>
      request<void>('/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
    unsubscribe: (endpoint: string) =>
      request<void>('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  },

  calendar: {
    sync: () => request<{ flightsFound: number }>('/calendar/sync', { method: 'POST' }),
  },

  settings: {
    get: () => request<Record<string, string | null>>('/settings'),
    set: (key: string, value: string) =>
      request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  },
}

// Types
export interface User {
  id: string
  email: string
  name: string
  isAdmin: boolean
  createdAt: string
}

export interface Flight {
  id: string
  userId: string
  tripId: string | null
  ident: string
  faFlightId: string | null
  airlineIata: string | null
  flightNumber: string | null
  origin: string
  destination: string
  departureScheduled: string
  departureEstimated: string | null
  departureActual: string | null
  arrivalScheduled: string
  arrivalEstimated: string | null
  arrivalActual: string | null
  // OOOI fields
  takeoffScheduled: string | null
  takeoffEstimated: string | null
  takeoffActual: string | null
  landingScheduled: string | null
  landingEstimated: string | null
  landingActual: string | null
  // Booking details
  seat: string | null
  confirmationCode: string | null
  status: string
  gateDeparture: string | null
  gateArrival: string | null
  terminalDeparture: string | null
  terminalArrival: string | null
  baggageClaim: string | null
  aircraftType: string | null
  registration: string | null
  lastPolledAt: string | null
  createdAt: string
  trip?: { id: string; name: string } | null
}

export interface AircraftPhoto {
  url: string
  link: string
  photographer: string
}

export interface FlightEvent {
  id: string
  flightId: string
  eventType: string
  oldValue: string | null
  newValue: string | null
  occurredAt: string
}

export interface FlightWithEvents extends Flight {
  events: FlightEvent[]
}

export interface Trip {
  id: string
  userId: string
  name: string
  startDate: string | null
  endDate: string | null
  createdAt: string
}

export interface TripWithFlights extends Trip {
  flights: Flight[]
}

export interface AircraftPosition {
  icao24: string
  callsign: string
  latitude: number
  longitude: number
  altitude: number
  velocity: number
  heading: number
  onGround: boolean
  lastContact: number
}

export interface PushSubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
