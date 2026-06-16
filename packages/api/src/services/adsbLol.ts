/**
 * ADSB.lol free transponder tracking service.
 * No API key required. Polls https://api.adsb.lol for live aircraft positions.
 */

const BASE_URL = "https://api.adsb.lol";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 45_000;
const STALE_THRESHOLD_SECONDS = 60;

export interface AdsbPosition {
  icao24: string;            // ICAO hex (lowercase)
  registration: string | null;
  callsign: string | null;
  latitude: number | null;
  longitude: number | null;
  altitudeFt: number | null; // null if "ground" string or unavailable
  groundSpeedKnots: number;  // 0 if not moving
  onGround: boolean;         // true if gnd=true OR alt_baro="ground"
  heading: number | null;
  seenSecondsAgo: number;    // how stale the data is
  isStale: boolean;          // true if seenSecondsAgo > 60
}

interface AcEntry {
  hex?: string;
  reg?: string;
  flight?: string;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  gnd?: boolean;
  seen?: number;
  seen_pos?: number;
}

interface AdsbLolResponse {
  ac: AcEntry[];
  total: number;
  now: number;
  msg: string;
}

// Simple in-memory cache keyed by ICAO hex
const _cache = new Map<string, { data: AdsbPosition | null; fetchedAt: number }>();

/** Fetch with a 10-second AbortController timeout. Returns null on error. */
async function fetchWithTimeout(url: string): Promise<AdsbLolResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.error(`[adsbLol] HTTP ${res.status} for ${url}`);
      return null;
    }
    return (await res.json()) as AdsbLolResponse;
  } catch (err) {
    console.error(`[adsbLol] Fetch error for ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Convert a raw AcEntry to an AdsbPosition. */
function mapAcEntry(ac: AcEntry): AdsbPosition {
  const onGround = ac.gnd === true || ac.alt_baro === "ground";
  const altitudeFt =
    typeof ac.alt_baro === "number" ? ac.alt_baro : null;

  const seenSecondsAgo = ac.seen ?? 0;

  return {
    icao24: (ac.hex ?? "").toLowerCase(),
    registration: ac.reg?.trim() || null,
    callsign: ac.flight?.trim() || null,
    latitude: ac.lat ?? null,
    longitude: ac.lon ?? null,
    altitudeFt,
    groundSpeedKnots: ac.gs ?? 0,
    onGround,
    heading: ac.track ?? null,
    seenSecondsAgo,
    isStale: seenSecondsAgo > STALE_THRESHOLD_SECONDS,
  };
}

/** Pick the freshest (lowest `seen`) entry from an array. */
function freshest(ac: AcEntry[]): AcEntry | null {
  if (ac.length === 0) return null;
  return ac.reduce((best, curr) =>
    (curr.seen ?? Infinity) < (best.seen ?? Infinity) ? curr : best
  );
}

/** Fetch by ICAO hex (e.g. "a1b2c3"). Returns null if no result or error. */
async function fetchByIcao(icaoHex: string): Promise<AdsbPosition | null> {
  const normalized = icaoHex.toLowerCase().replace(/^0+/, "");

  const cached = _cache.get(normalized);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const resp = await fetchWithTimeout(`${BASE_URL}/v2/icao/${normalized}`);
  const best = resp && resp.total > 0 ? freshest(resp.ac) : null;
  const data = best ? mapAcEntry(best) : null;

  _cache.set(normalized, { data, fetchedAt: Date.now() });
  return data;
}

/** Fetch by registration (e.g. "N12345"). Returns null if no result or error. */
async function fetchByRegistration(registration: string): Promise<AdsbPosition | null> {
  const normalized = registration.trim().toUpperCase();
  const resp = await fetchWithTimeout(`${BASE_URL}/v2/registration/${encodeURIComponent(normalized)}`);
  const best = resp && resp.total > 0 ? freshest(resp.ac) : null;
  return best ? mapAcEntry(best) : null;
}

/** Fetch by callsign/flight ident (e.g. "AA2083"). Returns null if no result or error. */
async function fetchByCallsign(callsign: string): Promise<AdsbPosition | null> {
  const normalized = callsign.replace(/\s+/g, "").toUpperCase();
  const resp = await fetchWithTimeout(`${BASE_URL}/v2/callsign/${encodeURIComponent(normalized)}`);
  const best = resp && resp.total > 0 ? freshest(resp.ac) : null;
  return best ? mapAcEntry(best) : null;
}

/**
 * Look up the live ADS-B position for an aircraft.
 *
 * Resolution order:
 * 1. ICAO hex (fastest, cached 45 s)
 * 2. Registration
 * 3. Callsign/flight ident
 *
 * Returns `null` if the aircraft cannot be found or all lookups fail.
 */
export async function getAdsbPosition(opts: {
  icaoHex?: string | null;
  registration?: string | null;
  callsign?: string | null;
}): Promise<AdsbPosition | null> {
  if (opts.icaoHex) {
    const pos = await fetchByIcao(opts.icaoHex);
    if (pos) return pos;
  }

  if (opts.registration) {
    const pos = await fetchByRegistration(opts.registration);
    if (pos) return pos;
  }

  if (opts.callsign) {
    const pos = await fetchByCallsign(opts.callsign);
    if (pos) return pos;
  }

  return null;
}

/**
 * Returns true if the aircraft is taxiing or rolling on the ground
 * at a speed suggesting it is about to take off (> 15 knots ground speed).
 */
export function isTaxiingOrRolling(pos: AdsbPosition): boolean {
  return pos.onGround && pos.groundSpeedKnots > 15;
}

/**
 * Returns true if the aircraft has just lifted off — no longer on the ground
 * and is more than 100 ft above field elevation.
 */
export function hasLiftedOff(pos: AdsbPosition): boolean {
  return !pos.onGround && pos.altitudeFt !== null && pos.altitudeFt > 100;
}

/**
 * Haversine great-circle distance in kilometres between two lat/lon points.
 *
 * @param lat1 Latitude of point A in decimal degrees
 * @param lon1 Longitude of point A in decimal degrees
 * @param lat2 Latitude of point B in decimal degrees
 * @param lon2 Longitude of point B in decimal degrees
 * @returns Distance in kilometres
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.asin(Math.sqrt(a));
}
