// IATA → [lat, lon] for common airports.
// This is a static lookup table — extend it by adding entries here.
// Coordinates are approximate centroid of each airport.
export const AIRPORT_COORDS: Record<string, [number, number]> = {
  // USA — domestic
  ATL: [33.6407, -84.4277], LAX: [33.9425, -118.4081], ORD: [41.9742, -87.9073],
  DFW: [32.8998, -97.0403], DEN: [39.8561, -104.6737], JFK: [40.6413, -73.7781],
  SFO: [37.6213, -122.379], SEA: [47.4502, -122.3088], LAS: [36.0840, -115.1537],
  MCO: [28.4312, -81.3081], EWR: [40.6895, -74.1745], PHX: [33.4373, -112.0078],
  IAH: [29.9902, -95.3368], MIA: [25.7959, -80.2870], BOS: [42.3656, -71.0096],
  MSP: [44.8848, -93.2223], DTW: [42.2124, -83.3534], CLT: [35.2140, -80.9431],
  PHL: [39.8729, -75.2437], LGA: [40.7773, -73.8726], BWI: [39.1754, -76.6682],
  SLC: [40.7884, -111.9778], DCA: [38.8512, -77.0402], MDW: [41.7868, -87.7522],
  SAN: [32.7336, -117.1897], TPA: [27.9755, -82.5332], PDX: [45.5898, -122.5951],
  HNL: [21.3245, -157.9251], STL: [38.7487, -90.3700], BNA: [36.1245, -86.6782],
  AUS: [30.1975, -97.6664], MCI: [39.2976, -94.7139], OAK: [37.7213, -122.2208],
  SJC: [37.3626, -121.9290], RDU: [35.8801, -78.7880], SMF: [38.6954, -121.5908],
  PIT: [40.4915, -80.2329], CVG: [39.0489, -84.6678], CLE: [41.4117, -81.8498],
  IND: [39.7173, -86.2944], CMH: [39.9980, -82.8919], MKE: [42.9472, -87.8966],
  MSY: [29.9934, -90.2580], RSW: [26.5362, -81.7552], JAX: [30.4941, -81.6879],
  BUF: [42.9405, -78.7322], ALB: [42.7483, -73.8017], ORF: [36.8976, -76.0183],
  // International
  LHR: [51.4775, -0.4614], CDG: [49.0097, 2.5479], AMS: [52.3086, 4.7639],
  FRA: [50.0379, 8.5622], MAD: [40.4983, -3.5676], BCN: [41.2974, 2.0833],
  FCO: [41.8003, 12.2389], MUC: [48.3538, 11.7861], ZRH: [47.4647, 8.5492],
  DXB: [25.2532, 55.3657], DOH: [25.2609, 51.6138], AUH: [24.4330, 54.6511],
  SIN: [1.3644, 103.9915], HKG: [22.3080, 113.9185], NRT: [35.7648, 140.3864],
  HND: [35.5493, 139.7798], ICN: [37.4602, 126.4407], PEK: [40.0799, 116.6031],
  PVG: [31.1443, 121.8083], SYD: [-33.9461, 151.1772], MEL: [-37.6733, 144.8430],
  BKK: [13.6811, 100.7475], KUL: [2.7456, 101.7099], DEL: [28.5665, 77.1031],
  BOM: [19.0896, 72.8656], YYZ: [43.6772, -79.6306], YVR: [49.1967, -123.1815],
  GRU: [-23.4356, -46.4731], EZE: [-34.8222, -58.5358], SCL: [-33.3930, -70.7858],
  LIM: [-12.0219, -77.1143], BOG: [-4.1698, -73.6690], MEX: [19.4363, -99.0721],
  CUN: [21.0365, -86.8771], GDL: [20.5218, -103.3110],
}

// IATA → IANA timezone string.
// Used for formatting notification times in the local timezone of the airport.
// Fall back to UTC if not listed.
export const AIRPORT_TZ: Record<string, string> = {
  // USA — Eastern
  ATL: 'America/New_York', JFK: 'America/New_York', LGA: 'America/New_York',
  EWR: 'America/New_York', MIA: 'America/New_York', MCO: 'America/New_York',
  BOS: 'America/New_York', PHL: 'America/New_York', CLT: 'America/New_York',
  DTW: 'America/New_York', BWI: 'America/New_York', DCA: 'America/New_York',
  TPA: 'America/New_York', PIT: 'America/New_York', BUF: 'America/New_York',
  JAX: 'America/New_York', ORF: 'America/New_York', ALB: 'America/New_York',
  CVG: 'America/New_York', CMH: 'America/New_York', RDU: 'America/New_York',
  // USA — Central
  ORD: 'America/Chicago', DFW: 'America/Chicago', MDW: 'America/Chicago',
  IAH: 'America/Chicago', MSP: 'America/Chicago', BNA: 'America/Chicago',
  MCI: 'America/Chicago', STL: 'America/Chicago', MSY: 'America/Chicago',
  MKE: 'America/Chicago', IND: 'America/Indiana/Indianapolis',
  // USA — Mountain
  DEN: 'America/Denver', SLC: 'America/Denver', PHX: 'America/Phoenix',
  // USA — Pacific
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  LAS: 'America/Los_Angeles', PDX: 'America/Los_Angeles', SAN: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles', SJC: 'America/Los_Angeles', SMF: 'America/Los_Angeles',
  // USA — Hawaii
  HNL: 'Pacific/Honolulu',
  // USA — Other
  RSW: 'America/New_York', CLE: 'America/New_York',
  // Canada
  YYZ: 'America/Toronto', YVR: 'America/Vancouver',
  // Europe
  LHR: 'Europe/London', CDG: 'Europe/Paris', AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin', MAD: 'Europe/Madrid', BCN: 'Europe/Madrid',
  FCO: 'Europe/Rome', MUC: 'Europe/Berlin', ZRH: 'Europe/Zurich',
  // Middle East
  DXB: 'Asia/Dubai', DOH: 'Asia/Qatar', AUH: 'Asia/Dubai',
  // Asia-Pacific
  SIN: 'Asia/Singapore', HKG: 'Asia/Hong_Kong', NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai',
  PVG: 'Asia/Shanghai', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne',
  BKK: 'Asia/Bangkok', KUL: 'Asia/Kuala_Lumpur', DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  // Latin America
  GRU: 'America/Sao_Paulo', EZE: 'America/Argentina/Buenos_Aires',
  SCL: 'America/Santiago', LIM: 'America/Lima', MEX: 'America/Mexico_City',
  CUN: 'America/Cancun', GDL: 'America/Mexico_City',
}
