# Flighty Feature Parity

> Last updated: 2026-06-14
> Departarr is a self-hosted, open-source PWA (React + Vite + Fastify + SQLite + Docker).
> Flighty is a native iOS/macOS app. This document tracks how Flighty's features map to
> what Departarr has, can build, or must treat as out of scope.

---

## Already Built ✅

### Flight tracking with live status
Real-time status updates (delays, gate changes, departure, arrival) via AeroDataBox,
FlightAware, and OpenSky. Covers the same core live-data loop that Flighty centers on.

### Flight history / passport stats
Past-flights "passport" view with cumulative stats: total miles, time in air, airports
visited, airlines flown. Mirrors Flighty's Passport tab.

### Push notifications
Gate changes, delays, departure, arrival, and baggage-claim alerts. Notification
triggers for shared viewers are also implemented (co-traveler notifications).

### Boarding-pass card UI
Tear-stub card design per flight with airline logo, origin/destination, times, and
status badge. Visually close to Flighty's card layout.

### Globe map with great-circle route arc
Interactive 3-D globe showing the flight path. Flighty shows a similar arc map.

### Trip grouping / multi-city trip view
Flights can be grouped into trips, giving a multi-leg itinerary view.

### Share flight with others (co-traveler tracking)
Share a flight link; viewers receive push notifications for the same live events.
Equivalent to Flighty's "Share" and follower notification feature.

### Airline logos
Logo assets per carrier, shown on cards and trip views.

### Google Calendar import with flight detection
Detects flight itineraries in calendar events and auto-imports them.

### PWA (installable, offline cache, service worker)
Installable on iOS/Android home screen via browser PWA prompt. Service worker caches
the shell for offline viewing of already-loaded data.

### Tail number tracking
AeroDataBox and FlightAware both return tail/registration numbers; Departarr stores
and displays this per flight.

---

## Feasible to Build 🔨

### Connection Assistant — tight-connection warnings
Warns when a connecting flight is at risk given current delays on the inbound leg.

How: For each trip with consecutive legs, compare the scheduled/updated arrival of
leg N with the scheduled departure of leg N+1 at the same airport. If the gap falls
below a configurable buffer (e.g. 45 min domestic, 60 min international) flag it as
tight. On each live-status poll, re-evaluate and trigger a push notification if the
connection tips into danger. No external API needed — pure arithmetic over data
already in SQLite.

### Weather at destination
Shows current and forecast weather for the destination airport around the arrival time.

How: Call a free/open weather API (Open-Meteo is fully free with no key; OpenWeatherMap
free tier also works). Use the airport's lat/lon (store a small IATA→lat-lon table or
pull from AeroDataBox's airport endpoint). Fetch an hourly forecast; display the window
±2 hours around estimated arrival. Cache aggressively — one fetch per flight per hour
is fine.

### Carbon footprint estimate
Estimates CO₂ for each flight leg.

How: Use the ICAO Carbon Emissions Calculator methodology (public): CO₂ ≈ distance_km
× seat_class_factor × aircraft_type_factor ÷ load_factor. Aircraft type comes from
AeroDataBox. Distance is the great-circle arc already computed for the globe map.
Present as kg CO₂ per passenger on the boarding-pass card. No external service needed.

### Travel time to airport
Shows how long it takes to get from the user's saved home location to the departure
airport, keyed to the flight's departure time.

How: Store a "home address" in user settings. On flight detail load, call a free
routing API (OpenRouteService or Nominatim + OSRM) or simply embed a Google Maps deep
link pre-filled with the airport as destination and a "leave by" time. Full routing
requires a mapping API; the deep-link approach is zero-infrastructure.

### Multi-city trip view enhancements
The trip grouping skeleton exists; extend it with a timeline/itinerary view showing
layover durations, connection risk badges, and total journey time.

How: Derive layover duration from consecutive leg arrival/departure times already in
the DB. Render a vertical timeline component. Integrate the Connection Assistant badge
(see above) inline on each layover row.

### Flight search / price tracking (basic)
Let users search for a flight by route or flight number to add it before departure.

How: AeroDataBox's `/flights/search` and `/flights/number/{number}/{date}` endpoints
support flight lookup by number/route and return schedule data. Wire a search box in
the "Add Flight" flow. Price tracking is a separate problem (see Partially Feasible).

---

## Partially Feasible ⚠️

### Seat maps
Show an interactive cabin map with seat selection/marking.

Constraints: Seat-map data (cabin layout per aircraft registration) is not freely
available. The best open option is SeatGuru's web pages (scrapeable but fragile and
against ToS). AeroDataBox does not provide seat maps. A static lookup table of common
aircraft types (737-800, A320, etc.) could cover ~70% of flights but would be
inaccurate for reconfigurations. Feasible if limited to "approximate layout for
aircraft family" without real-time seat availability; not feasible for live seat
selection.

### Airline lounge info
Show lounge locations and access rules for the departure/arrival airport.

Constraints: No authoritative free API for lounge data. LoungeBuddy (acquired by
AmEx) is private. A manually maintained JSON dataset of major hub lounges is feasible
but labor-intensive and will go stale. Feasible as a community-maintained static
dataset bundled with Departarr; not feasible as live/authoritative data.

### Alternate flight suggestions when cancelled/delayed
When a flight is cancelled or severely delayed, suggest alternative flights on the
same route.

Constraints: Knowing *available* alternatives requires either a GDS (Amadeus, Sabre —
expensive/credentialed) or a consumer flight-search API (Skyscanner, Kayak — partner
programs, not self-hostable for production). AeroDataBox can show other scheduled
flights on the same route for the day (feasible), but cannot show seat availability
or pricing. Feasible as a "here are other scheduled departures today" list; not
feasible as a true rebooking assistant with availability/price.

### Flight search with price tracking
Monitor a route for price drops and alert the user.

Constraints: Real-time fare data requires airline or GDS access. No free, self-hostable
price API exists. Google Flights Explore and Kayak Explore are consumer tools, not
APIs. Feasible only as a deep link to Google Flights / Skyscanner for the user to
check manually; automated price polling would violate those services' ToS.

---

## Out of Scope ❌

### Live Activity / Dynamic Island during flight
Shows a live flight progress bar on the iOS Lock Screen and Dynamic Island, updated
in real time without opening the app.

Why out of scope: Live Activities are an iOS 16+ native API (ActivityKit /
WidgetKit). A PWA has no access to ActivityKit. This requires a native Swift app
distributed through the App Store. Not achievable in a web/PWA architecture.

### Home screen widget (iOS / Android)
Glanceable widget on the device home screen showing next flight status.

Why out of scope: iOS widgets require WidgetKit (Swift/Xcode). Android widgets require
an APK with AppWidgetProvider. Neither is accessible from a PWA or web app. The PWA
can be installed to the home screen but cannot render a native widget. On Android,
PWA shortcuts exist but are not true widgets.

### Gate maps / airport terminal maps
Visual maps of airport terminals showing gate locations, amenities, and walking
distances.

Why out of scope: High-quality terminal map data is proprietary. The main provider
(LocusLabs, now owned by Amadeus) licenses to airlines and airport apps under
commercial agreements. Open alternatives (OpenStreetMap indoor maps) exist for only
a handful of airports and are inconsistently maintained. Integrating even partial
coverage would require significant per-airport work with no reliable free data source.
Not a tractable problem for an open-source self-hosted project.
