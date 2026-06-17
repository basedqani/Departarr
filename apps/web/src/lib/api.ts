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
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
    list: async (when?: string): Promise<Flight[]> => {
      const cacheKey = when === 'today' ? 'departarr_cache_flights_today'
        : when === 'upcoming' ? 'departarr_cache_flights_upcoming'
        : null
      try {
        let result: Flight[]
        if (!when) {
          result = await request<Flight[]>('/flights')
        } else {
          // Send the client's local date and UTC-offset so the server can compute
          // correct day boundaries regardless of the server's own timezone.
          const localDate = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
          const tzOffset = new Date().getTimezoneOffset() // minutes behind UTC
          result = await request<Flight[]>(`/flights?when=${when}&localDate=${localDate}&tzOffset=${tzOffset}`)
        }
        if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(result))
        return result
      } catch (err) {
        if (!navigator.onLine && cacheKey) {
          const cached = localStorage.getItem(cacheKey)
          if (cached) return JSON.parse(cached) as Flight[]
        }
        throw err
      }
    },
    get: (id: string) =>
      request<FlightWithEvents>(`/flights/${id}`),
    lookup: (ident: string, date: string) =>
      request<FlightPreview>(`/flights/lookup?ident=${encodeURIComponent(ident)}&date=${encodeURIComponent(date)}`),
    lookupAll: (ident: string, date: string) =>
      request<FlightPreview[]>(`/flights/lookup-all?ident=${encodeURIComponent(ident)}&date=${encodeURIComponent(date)}`),
    add: (data: { ident: string; date: string; tripId?: string; origin?: string; dest?: string }) =>
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
      const res = await fetch(`${BASE}/flights/${id}/photo`, { headers })
      if (res.status === 204) return null
      if (!res.ok) return null
      return res.json() as Promise<AircraftPhoto>
    },
    connections: () =>
      request<ConnectionResult[]>('/flights/connections'),
    share: (id: string) =>
      request<{ token: string; url: string }>(`/flights/${id}/share`, { method: 'POST' }),
    revokeShare: (id: string) =>
      request<void>(`/flights/${id}/share`, { method: 'DELETE' }),
    weather: (id: string, unit: 'F' | 'C' = 'F') =>
      request<WeatherResult>(`/flights/${id}/weather?units=${unit === 'F' ? 'imperial' : 'metric'}`),
    deletePast: () =>
      request<{ deleted: number }>('/flights/past', { method: 'DELETE' }),
  },

  trains: {
    list: async (when?: string): Promise<Train[]> => {
      const cacheKey = when === 'today' ? 'departarr_cache_trains_today'
        : when === 'upcoming' ? 'departarr_cache_trains_upcoming'
        : null
      try {
        let result: Train[]
        if (!when) {
          result = await request<Train[]>('/trains')
        } else {
          const localDate = new Date().toLocaleDateString('en-CA')
          const tzOffset = new Date().getTimezoneOffset()
          result = await request<Train[]>(`/trains?when=${when}&localDate=${localDate}&tzOffset=${tzOffset}`)
        }
        if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(result))
        return result
      } catch (err) {
        if (!navigator.onLine && cacheKey) {
          const cached = localStorage.getItem(cacheKey)
          if (cached) return JSON.parse(cached) as Train[]
        }
        throw err
      }
    },
    get: (id: string) => request<TrainWithEvents>(`/trains/${id}`),
    lookup: (number: string, date: string) => request<TrainPreview>(`/trains/lookup?number=${encodeURIComponent(number)}&date=${encodeURIComponent(date)}`),
    add: (data: { trainNumber: string; date: string; tripId?: string; origin?: string; destination?: string; boardingStop?: { code: string; schDep?: string } }) =>
      request<Train>('/trains', { method: 'POST', body: JSON.stringify(data) }),
    patch: (id: string, body: { seat?: string | null; confirmationCode?: string | null; tripId?: string | null }) =>
      request<Train>(`/trains/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => request<void>(`/trains/${id}`, { method: 'DELETE' }),
    weather: (id: string, unit: 'F' | 'C' = 'F') =>
      request<WeatherResult>(`/trains/${id}/weather?units=${unit === 'F' ? 'imperial' : 'metric'}`),
    share: (id: string) =>
      request<{ token: string; url: string }>(`/trains/${id}/share`, { method: 'POST' }),
    revokeShare: (id: string) =>
      request<void>(`/trains/${id}/share`, { method: 'DELETE' }),
  },

  trips: {
    list: () => request<TripListItem[]>('/trips'),
    get: (id: string) => request<TripWithLegs>(`/trips/${id}`),
    create: (data: { name: string; startDate?: string; endDate?: string }) =>
      request<Trip>('/trips', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; startDate?: string; endDate?: string }) =>
      request<Trip>(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/trips/${id}`, { method: 'DELETE' }),
    addFlight: (tripId: string, flightId: string) =>
      request<Flight>(`/trips/${tripId}/flights`, { method: 'POST', body: JSON.stringify({ flightId }) }),
    addTrain: (tripId: string, trainId: string) =>
      request<Train>(`/trips/${tripId}/trains`, { method: 'POST', body: JSON.stringify({ trainId }) }),
  },

  share: {
    get: (token: string) =>
      request<{ flight?: FlightWithEvents; trip?: TripWithLegs; train?: TrainWithEvents }>(`/share/${token}`),
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
    test: () => request<{ ok: boolean }>('/push/test', { method: 'POST' }),
    simulate: (flightId: string) => request<{ ok: boolean; steps: number; totalMs: number }>(`/push/simulate/${flightId}`, { method: 'POST' }),
  },

  calendar: {
    sync: () => request<{ flightsFound: number; trainsFound: number }>('/calendar/sync', { method: 'POST' }),
  },

  settings: {
    get: () => request<SettingsResponse>('/settings'),
    set: (key: string, value: string) =>
      request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  },

  features: {
    get: () => request<Features>('/features'),
  },
}

// GET /api/settings (admin). Recognised keys come back as masked strings,
// booleans (for BOOL_KEYS), or null when unset, plus a read-only usage summary.
export interface AeroApiUsage {
  month: string
  provider: string
  calls: number
  budget: number
}

export interface SettingsResponse {
  aeroapi_usage?: AeroApiUsage
  [key: string]: string | boolean | null | AeroApiUsage | undefined
}

export interface Features {
  googleCalendar: boolean
  flightAware: boolean
  aeroDataBox: boolean
  liveData: boolean
  provider: string
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

// Result of a non-persisting lookup (preview before the user confirms adding)
export interface FlightPreview {
  faFlightId?: string
  airlineIata?: string
  flightNumber?: string
  origin: string
  destination: string
  departureScheduled: string
  departureEstimated?: string | null
  arrivalScheduled: string
  arrivalEstimated?: string | null
  status: string
  gateDeparture?: string | null
  gateArrival?: string | null
  terminalDeparture?: string | null
  terminalArrival?: string | null
  aircraftType?: string | null
  registration?: string | null
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

// Leg summary as returned by GET /api/trips (list endpoint)
export interface TripLegSummary {
  id: string
  origin: string
  destination: string
  departureScheduled: string
  arrivalScheduled: string
  arrivalEstimated: string | null
  arrivalActual: string | null
  status: string
}

// Trip as returned by GET /api/trips (includes summarised legs)
export interface TripListItem extends Trip {
  flights: (TripLegSummary & { ident: string })[]
  trains: (TripLegSummary & { trainNumber: string; trainName: string | null })[]
}

export interface TripWithFlights extends Trip {
  flights: Flight[]
}

export interface TripWithLegs extends Trip {
  flights: Flight[]
  trains: Train[]
}

export interface Train {
  id: string
  userId: string
  tripId: string | null
  trainNumber: string
  trainName: string | null
  origin: string
  destination: string
  originName: string | null
  destinationName: string | null
  departureScheduled: string
  departureEstimated: string | null
  departureActual: string | null
  arrivalScheduled: string
  arrivalEstimated: string | null
  arrivalActual: string | null
  status: string
  stopsJson: string | null
  seat: string | null
  confirmationCode: string | null
  lastPolledAt: string | null
  createdAt: string
  trip?: { id: string; name: string } | null
}

export interface TrainStop {
  code: string
  name: string
  tz: string
  schArr: string | null
  schDep: string | null
  arr: string | null
  dep: string | null
  arrCmnt: string | null
  depCmnt: string | null
  status: string
  stopSequence: number
}

export interface TrainEvent {
  id: string
  trainId: string
  eventType: string
  oldValue: string | null
  newValue: string | null
  occurredAt: string
}

export interface TrainWithEvents extends Train {
  events: TrainEvent[]
}

export interface TrainPreview {
  trainNumber: string
  trainName: string | null
  origin: string
  destination: string
  originName: string | null
  destinationName: string | null
  departureScheduled: string
  arrivalScheduled: string
  stops: TrainStop[]
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

export interface WeatherResult {
  airport: string
  arrivalTime: string
  weather: { time: string; temp: number; code: number; wind: number; precip: number }[]
}

export interface ConnectionResult {
  flightId: string
  inboundFlightId: string
  minutesAvailable: number
  risk: 'green' | 'yellow' | 'red'
  arrivalTime: string
  departureTime: string
  airport: string
}
