// Amtrak station codes with approximate coordinates [lat, lon]
export const AMTRAK_STATION_COORDS: Record<string, [number, number]> = {
  // Northeast Corridor & Northeast Regional
  'NYP': [40.7506, -73.9971], // New York Penn Station
  'WAS': [38.8972, -77.0061], // Washington Union Station
  'PHL': [39.9566, -75.1821], // Philadelphia 30th Street Station
  'BAL': [39.2959, -76.6178], // Baltimore Penn Station
  'NWK': [40.7351, -74.1646], // Newark Penn Station
  'BOS': [42.3656, -71.0597], // Boston South Station
  'BBY': [42.3424, -71.1072], // Boston Back Bay
  'PVD': [41.8237, -71.4128], // Providence
  'NHV': [41.2989, -72.9270], // New Haven
  'NLC': [41.3597, -72.1023], // New London
  'MYS': [41.3557, -72.5459], // Mystic
  'KGN': [41.4899, -71.5162], // Kingston RI
  'RTE': [42.2275, -71.1771], // Route 128
  'TRE': [40.2171, -74.7429], // Trenton
  'MPD': [40.5611, -74.3187], // Metropark
  'WIL': [39.7391, -75.5464], // Wilmington DE
  'ABE': [40.6084, -75.4902], // Allentown/Bethlehem/Easton
  'ALB': [42.7427, -73.7570], // Albany-Rensselaer
  'HAR': [40.2732, -76.8867], // Harrisburg
  'LAN': [40.0379, -76.3055], // Lancaster
  'SPG': [42.1073, -72.5921], // Springfield MA
  'CVS': [38.0285, -78.4767], // Charlottesville
  'RVR': [37.5407, -77.4360], // Richmond Staples Mill
  'LYH': [37.4138, -79.1422], // Lynchburg
  'RGH': [35.7796, -78.6382], // Raleigh
  'GBO': [36.0726, -79.7920], // Greensboro
  'HAM': [35.9557, -80.0053], // High Point
  'SAB': [35.6729, -80.4745], // Salisbury NC
  'CLT': [35.2271, -80.8431], // Charlotte

  // Empire Service / Lake Shore Limited / Maple Leaf
  'BUF': [42.8766, -78.8784], // Buffalo-Depew
  'ROC': [43.1566, -77.6116], // Rochester
  'SYR': [43.0456, -76.1461], // Syracuse
  'UCA': [43.1009, -75.2324], // Utica
  'SAR': [43.0784, -73.7853], // Saratoga Springs

  // Chicago Hub
  'CHI': [41.8789, -87.6359], // Chicago Union Station

  // California Zephyr / Empire Builder / Southwest Chief
  'DEN': [39.7392, -104.9903], // Denver Union Station
  'SLC': [40.7608, -111.8910], // Salt Lake City
  'OGD': [41.2230, -111.9738], // Ogden
  'RNO': [39.5296, -119.8138], // Reno
  'GJT': [39.0639, -108.5506], // Grand Junction
  'GLW': [39.5505, -107.3248], // Glenwood Springs
  'EMY': [37.8324, -122.2852], // Emeryville
  'SAC': [38.5816, -121.4944], // Sacramento
  'DAV': [38.5449, -121.7405], // Davis
  'MTZ': [38.0193, -121.9024], // Martinez
  'SPK': [47.6588, -117.4260], // Spokane
  'MCI': [39.0997, -94.5786], // Kansas City
  'TOP': [39.0473, -95.6752], // Topeka
  'LNK': [40.8136, -96.7026], // Lincoln NE
  'OMA': [41.2565, -95.9345], // Omaha
  'STL': [38.6270, -90.1994], // St. Louis
  'CHM': [40.1164, -88.2434], // Champaign-Urbana

  // Empire Builder
  'MSD': [44.9778, -93.2650], // St. Paul-Minneapolis
  'WNO': [44.0499, -91.6404], // Winona MN
  'LCR': [43.8036, -91.2396], // La Crosse
  'TOM': [43.9543, -91.1943], // Tomah WI
  'MKE': [43.0389, -87.9065], // Milwaukee

  // Coast Starlight / Cascades
  'SEA': [47.5993, -122.3303], // Seattle King Street
  'TAC': [47.2366, -122.4275], // Tacoma
  'OLY': [47.0573, -122.9036], // Olympia-Lacey
  'CTB': [46.6887, -122.9641], // Centralia
  'KEL': [46.1120, -122.9046], // Kelso-Longview
  'VAN': [45.6312, -122.6661], // Vancouver WA
  'PDX': [45.5231, -122.6765], // Portland
  'SAL': [44.9429, -123.0351], // Salem
  'ALY': [44.6313, -123.1044], // Albany OR
  'EUG': [44.0521, -123.0868], // Eugene
  'KFH': [42.2249, -121.7817], // Klamath Falls
  'DUN': [41.7400, -122.6382], // Dunsmuir
  'RDD': [40.5865, -122.3917], // Redding
  'CKS': [39.7285, -122.2030], // Chico
  'SNJ': [37.3382, -121.8863], // San Jose
  'SLO': [35.2828, -120.6596], // San Luis Obispo
  'SBA': [34.4208, -119.6982], // Santa Barbara
  'OXN': [34.1975, -119.1771], // Oxnard
  'LAX': [34.0056, -118.1713], // Los Angeles Union Station

  // Pacific Surfliner
  'FUL': [33.8703, -117.9253], // Fullerton
  'ANA': [33.8367, -117.9143], // Anaheim
  'SNA': [33.7175, -117.8311], // Santa Ana
  'OSD': [33.1581, -117.3506], // Oceanside
  'SAN': [32.7157, -117.1611], // San Diego

  // Sunset Limited / Texas Eagle
  'ELP': [31.7619, -106.4850], // El Paso
  'SAT': [29.4241, -98.4936], // San Antonio
  'AUS': [30.2672, -97.7431], // Austin
  'FTW': [32.7555, -97.3308], // Fort Worth
  'DAL': [32.7767, -96.7970], // Dallas
  'NOL': [29.9511, -90.0715], // New Orleans

  // City of New Orleans / Crescent / Silver Service
  'JAC': [30.3322, -81.6557], // Jacksonville
  'SAV': [32.0809, -81.0912], // Savannah
  'FLO': [34.1954, -79.7626], // Florence SC
  'MIA': [25.8103, -80.1898], // Miami
  'TPA': [27.9506, -82.4572], // Tampa

  // Wolverine / Blue Water / Pere Marquette
  'DET': [42.3197, -83.0409], // Detroit
  'ANN': [42.2805, -83.7481], // Ann Arbor
  'JAX': [42.2480, -84.4008], // Jackson MI
  'KAL': [42.2922, -85.5861], // Kalamazoo
  'BTL': [42.3178, -85.2517], // Battle Creek
  'ETG': [42.7395, -84.5520], // East Lansing
  'FLN': [43.0145, -83.6880], // Flint
  'PIT': [40.4397, -79.9959], // Pittsburgh

  // Cardinal
  'SPI': [39.7817, -89.6501], // Springfield IL
  'CIN': [39.1031, -84.5120], // Cincinnati

  // Heartland Flyer
  'OKC': [35.4676, -97.5164], // Oklahoma City

  // Vermonter
  'SAV2': [42.8406, -73.4012], // Saratoga Springs (alt)
}

export function getAmtrakStation(code: string): { lat: number; lon: number } | null {
  const coords = AMTRAK_STATION_COORDS[code.toUpperCase()]
  if (!coords) return null
  return { lat: coords[0], lon: coords[1] }
}

// Station code → IANA timezone (used by backend to compute correct local midnight for GTFS times)
export const AMTRAK_STATION_TZ: Record<string, string> = {
  // Eastern
  NYP: 'America/New_York', WAS: 'America/New_York', PHL: 'America/New_York',
  BAL: 'America/New_York', NWK: 'America/New_York', BOS: 'America/New_York',
  BBY: 'America/New_York', PVD: 'America/New_York', NHV: 'America/New_York',
  NLC: 'America/New_York', MYS: 'America/New_York', KGN: 'America/New_York',
  RTE: 'America/New_York', TRE: 'America/New_York', MPD: 'America/New_York',
  WIL: 'America/New_York', ABE: 'America/New_York', ALB: 'America/New_York',
  HAR: 'America/New_York', LAN: 'America/New_York', SPG: 'America/New_York',
  CVS: 'America/New_York', RVR: 'America/New_York', LYH: 'America/New_York',
  RGH: 'America/New_York', GBO: 'America/New_York', HAM: 'America/New_York',
  SAB: 'America/New_York', CLT: 'America/New_York', BUF: 'America/New_York',
  ROC: 'America/New_York', SYR: 'America/New_York', UCA: 'America/New_York',
  SAR: 'America/New_York', PIT: 'America/New_York', CIN: 'America/New_York',
  DET: 'America/New_York', ANN: 'America/New_York', KAL: 'America/New_York',
  BTL: 'America/New_York', ETG: 'America/New_York', FLN: 'America/New_York',
  JAC: 'America/New_York', SAV: 'America/New_York', FLO: 'America/New_York',
  MIA: 'America/New_York', TPA: 'America/New_York', JAX: 'America/New_York',
  // Central
  CHI: 'America/Chicago', MCI: 'America/Chicago', STL: 'America/Chicago',
  CHM: 'America/Chicago', MSD: 'America/Chicago', MSP: 'America/Chicago',
  WNO: 'America/Chicago', LCR: 'America/Chicago', TOM: 'America/Chicago',
  MKE: 'America/Chicago', NOL: 'America/Chicago', SPI: 'America/Chicago',
  OKC: 'America/Chicago', TOP: 'America/Chicago', LNK: 'America/Chicago',
  OMA: 'America/Chicago', AUS: 'America/Chicago', SAT: 'America/Chicago',
  FTW: 'America/Chicago', DAL: 'America/Chicago',
  // Mountain
  DEN: 'America/Denver', GJT: 'America/Denver', GLW: 'America/Denver',
  SLC: 'America/Denver', OGD: 'America/Denver', ELP: 'America/Denver',
  // Pacific
  SEA: 'America/Los_Angeles', TAC: 'America/Los_Angeles', OLY: 'America/Los_Angeles',
  CTB: 'America/Los_Angeles', KEL: 'America/Los_Angeles', VAN: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles', SAL: 'America/Los_Angeles', ALY: 'America/Los_Angeles',
  EUG: 'America/Los_Angeles', KFH: 'America/Los_Angeles', DUN: 'America/Los_Angeles',
  RDD: 'America/Los_Angeles', CKS: 'America/Los_Angeles', EMY: 'America/Los_Angeles',
  SAC: 'America/Los_Angeles', DAV: 'America/Los_Angeles', MTZ: 'America/Los_Angeles',
  SNJ: 'America/Los_Angeles', SLO: 'America/Los_Angeles', SBA: 'America/Los_Angeles',
  OXN: 'America/Los_Angeles', LAX: 'America/Los_Angeles', FUL: 'America/Los_Angeles',
  ANA: 'America/Los_Angeles', SNA: 'America/Los_Angeles', OSD: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', RNO: 'America/Los_Angeles', SPK: 'America/Los_Angeles',
}

export function getAmtrakStationTzBackend(code: string): string {
  return AMTRAK_STATION_TZ[code.toUpperCase()] ?? 'America/Chicago'
}
