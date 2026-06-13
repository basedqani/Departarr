const OPENSKY_BASE = 'https://opensky-network.org/api'

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

// IATA airline code → ICAO callsign prefix. OpenSky state vectors carry the
// ICAO callsign (e.g. "BAW178"), not the IATA flight number ("BA178"), so we
// translate before matching. Seeded from the OpenFlights airlines dataset
// (valid 3-letter ICAO codes only), with a curated set of majors taking
// precedence to guarantee the common carriers are always correct.
const IATA_TO_ICAO: Record<string, string> = {
  "04": "ABV", "0A": "GNT", "0B": "JOR", "0D": "DWT", "0P": "PYB", "10": "CNN", "13": "EAV", "1A": "AGT",
  "1E": "RGG", "1F": "CIF", "1I": "NVR", "1L": "OSY", "1T": "RNX", "20": "RNE", "2B": "ARD", "2F": "FTA",
  "2G": "CRG", "2J": "VBW", "2K": "GLG", "2L": "OAW", "2M": "MDV", "2N": "NTJ", "2P": "GAP", "2Q": "SNC",
  "2T": "HAM", "2U": "GIP", "2W": "WLC", "2Y": "AOW", "2Z": "CGN", "3C": "CEA", "3D": "PMK", "3G": "AYZ",
  "3J": "WZP", "3K": "JSA", "3L": "ISK", "3N": "URG", "3P": "TNM", "3Q": "CYH", "3R": "GAI", "3T": "URN",
  "3U": "CSC", "3V": "TAY", "3X": "GUI", "47": "VVN", "4A": "AKL", "4B": "BTQ", "4C": "ARE", "4D": "ASD",
  "4F": "ECE", "4G": "GZP", "4H": "UBD", "4K": "AAS", "4L": "MJX", "4M": "DSM", "4N": "ANT", "4R": "HHI",
  "4T": "BHP", "4U": "GWI", "4Y": "RBU", "5A": "AIP", "5B": "BSX", "5C": "ICL", "5D": "UDC", "5F": "CIR",
  "5G": "SSV", "5H": "FFV", "5J": "CEB", "5L": "RSU", "5M": "SIB", "5N": "AUL", "5T": "MPE", "5V": "UKW",
  "5W": "AEU", "5X": "UPS", "5Y": "GTI", "5Z": "VVC", "6A": "CHP", "6B": "BLX", "6E": "IGO", "6F": "MKD",
  "6G": "AWW", "6H": "ISR", "6J": "SNJ", "6K": "RIT", "6N": "NRD", "6Q": "SLL", "6R": "DRU", "6V": "CZV",
  "6W": "SOV", "6Z": "UKS", "76": "SJS", "77": "ZCS", "78": "XAN", "7B": "KJC", "7C": "JJA", "7E": "AWU",
  "7F": "FAB", "7G": "SFJ", "7H": "ERR", "7K": "KGL", "7L": "ERO", "7M": "ZTF", "7N": "CNA", "7P": "BTV",
  "7R": "SJM", "7T": "AGV", "7V": "ROB", "8A": "BMM", "8B": "BCC", "8C": "ATN", "8E": "BRG", "8F": "STP",
  "8H": "HFR", "8J": "JFU", "8L": "CGP", "8M": "MMM", "8N": "NKF", "8P": "PCO", "8R": "TIB", "8U": "AAW",
  "8V": "ACP", "8Y": "PBU", "8Z": "WVL", "9E": "FLG", "9F": "TLM", "9I": "INE", "9K": "KAP", "9L": "CJC",
  "9Q": "PBA", "9R": "NSE", "9S": "CQH", "9T": "ABS", "9U": "MLD", "9W": "JAI", "9Y": "KZK", "A3": "AEE",
  "A4": "SWD", "A5": "RLA", "A7": "MPD", "A8": "BGL", "A9": "TGZ", "AA": "AAL", "AB": "BER", "AC": "ACA",
  "AD": "AZU", "AE": "MDA", "AF": "AFR", "AG": "SSA", "AH": "DAH", "AI": "AIC", "AJ": "NIG", "AK": "AXM",
  "AL": "SYX", "AM": "AMX", "AN": "AAA", "AP": "ADH", "AQ": "AAH", "AR": "ARG", "AS": "ASA", "AT": "RAM",
  "AU": "AUT", "AV": "AVA", "AW": "AWM", "AX": "LOF", "AY": "FIN", "AZ": "AZA", "B2": "BRU", "B3": "BLV",
  "B4": "GSM", "B5": "FLT", "B6": "JBU", "B7": "UIA", "B8": "ERT", "B9": "BGD", "BA": "BAW", "BB": "SBS",
  "BC": "SKY", "BD": "BMA", "BE": "BEE", "BF": "RSR", "BG": "BBC", "BI": "RBA", "BJ": "LBT", "BK": "PDC",
  "BL": "PIC", "BN": "HZA", "BO": "BOU", "BP": "BOT", "BQ": "BQB", "BR": "EVA", "BS": "BIH", "BT": "BTI",
  "BU": "BUU", "BV": "BPA", "BW": "BWA", "BX": "ABL", "BY": "TOM", "BZ": "BSA", "C0": "CLW", "C2": "CAP",
  "C3": "QAX", "C4": "LIX", "C5": "UCA", "C6": "CJA", "C8": "WDY", "C9": "RUS", "CA": "CCA", "CB": "CCC",
  "CC": "MCK", "CE": "NTW", "CF": "SDR", "CG": "TOK", "CH": "BMJ", "CI": "CAL", "CJ": "CFE", "CK": "CKK",
  "CL": "CLH", "CM": "CMP", "CN": "YCP", "CP": "CPZ", "CQ": "KOL", "CS": "CMI", "CU": "CUB", "CV": "CVA",
  "CW": "CWM", "CX": "CPA", "CY": "CYP", "CZ": "CSN", "D1": "MDO", "D3": "DAO", "D4": "LID", "D5": "DAU",
  "D6": "ILN", "D7": "XAX", "D8": "DJB", "D9": "DNV", "DB": "BZH", "DC": "GAO", "DD": "NOK", "DE": "CFG",
  "DF": "MJG", "DG": "SRQ", "DH": "DSY", "DI": "BAG", "DJ": "PBN", "DK": "ELA", "DL": "DAL", "DN": "SGG",
  "DO": "DOA", "DP": "FCA", "DR": "BIE", "DT": "DTA", "DU": "NLH", "DV": "VSV", "DW": "UCR", "DX": "DTR",
  "DY": "NAX", "E0": "ESS", "E3": "DMO", "E4": "GIE", "E5": "RBG", "E7": "ESF", "E8": "GTA", "EA": "EAL",
  "EC": "TWN", "ED": "ABQ", "EF": "EFA", "EG": "JAA", "EH": "AKX", "EI": "EIN", "EJ": "NEA", "EK": "UAE",
  "EL": "ANK", "EM": "AEB", "EN": "DLA", "EO": "LHN", "EP": "IRC", "EQ": "TAE", "ER": "RWW", "ES": "EUV",
  "ET": "ETH", "EU": "EEA", "EV": "ASQ", "EW": "EWG", "EY": "ETD", "EZ": "EIA", "F1": "FBL", "F2": "FLM",
  "F3": "FSW", "F4": "NBK", "F6": "RCK", "F7": "BBO", "F9": "FFT", "FB": "LZB", "FC": "WBA", "FD": "AIQ",
  "FE": "WCP", "FF": "FRF", "FG": "AFG", "FH": "FHI", "FI": "ICE", "FJ": "FJI", "FK": "WTA", "FL": "TRS",
  "FM": "CSH", "FO": "ATM", "FP": "FRE", "FQ": "TCW", "FR": "RYR", "FS": "STU", "FT": "SRH", "FU": "FXX",
  "FV": "SDM", "FW": "IBX", "FX": "FOX", "FY": "FFM", "FZ": "FDB", "G0": "GHB", "G2": "VXG", "G3": "SEH",
  "G4": "AAY", "G7": "GJS", "G8": "GOW", "G9": "ABY", "GA": "GIA", "GB": "BZE", "GC": "GNR", "GD": "AHA",
  "GE": "TNA", "GF": "GBA", "GG": "GUY", "GH": "GLP", "GI": "IKA", "GJ": "EEU", "GL": "GRL", "GM": "GER",
  "GO": "KZU", "GP": "GDR", "GQ": "BSY", "GR": "AUR", "GS": "UPA", "GT": "GBL", "GV": "ARF", "GW": "KIL",
  "GX": "GXG", "GY": "GBK", "GZ": "RAR", "H2": "SKU", "H5": "RSY", "H6": "HAG", "H8": "KHB", "HA": "HAL",
  "HB": "HAR", "HC": "HYM", "HD": "ADO", "HE": "LGW", "HF": "HLF", "HG": "NLY", "HH": "AHO", "HJ": "AXF",
  "HM": "SEY", "HN": "HNX", "HO": "DKH", "HP": "AWE", "HQ": "HMY", "HR": "CUA", "HT": "IMP", "HU": "CHH",
  "HV": "TRA", "HW": "FHE", "HX": "CRK", "HY": "UZB", "HZ": "SOZ", "I2": "IBS", "I5": "IDS", "I6": "MXI",
  "I7": "PMW", "I9": "IBU", "IA": "IAW", "IB": "IBE", "IC": "IAC", "ID": "ITK", "IE": "SOL", "IF": "ISW",
  "IG": "ISS", "II": "UWW", "IJ": "SJO", "IK": "ITX", "IL": "ILW", "IM": "MNJ", "IN": "MAK", "IO": "IAA",
  "IP": "ISX", "IQ": "AUB", "IR": "IRA", "IT": "KFR", "IV": "JET", "IW": "WON", "IX": "AXB", "IY": "IYE",
  "IZ": "AIZ", "J2": "AHY", "J3": "PLR", "J6": "AOC", "J8": "BVT", "J9": "JZR", "JA": "BON", "JB": "JBA",
  "JC": "JEX", "JD": "JAS", "JE": "MNO", "JF": "JAF", "JI": "MDW", "JJ": "TAM", "JK": "JKK", "JL": "JAL",
  "JM": "AJM", "JN": "XLA", "JO": "JAZ", "JP": "ADR", "JQ": "JST", "JR": "JOY", "JS": "KOR", "JT": "LNI",
  "JU": "ASL", "JV": "BLS", "JW": "APW", "JX": "JSR", "JY": "AXZ", "JZ": "SKX", "K1": "KOQ", "K2": "ELO",
  "K4": "CKS", "K5": "SQH", "K7": "KBR", "K9": "KRI", "KA": "HDA", "KB": "DRK", "KC": "KZR", "KD": "KNI",
  "KE": "KAL", "KF": "BLF", "KG": "RAW", "KH": "KHK", "KI": "DHI", "KJ": "LAJ", "KK": "KKK", "KL": "KLM",
  "KM": "AMC", "KO": "AER", "KP": "DWA", "KQ": "KQA", "KR": "CWK", "KS": "PEN", "KT": "VKJ", "KU": "KAC",
  "KV": "MVD", "KX": "CAY", "KY": "KSY", "L2": "LYC", "L3": "LTO", "L4": "LJJ", "L5": "LTR", "L6": "MAI",
  "L8": "LBL", "LA": "LAN", "LC": "VLO", "LD": "AHK", "LE": "LTY", "LF": "NDC", "LG": "LGL", "LH": "DLH",
  "LI": "LIA", "LJ": "JNA", "LK": "LXR", "LL": "GRO", "LM": "LAM", "LN": "LAA", "LO": "LOT", "LP": "LPE",
  "LQ": "LMM", "LR": "LRC", "LS": "EXS", "LT": "LTU", "LU": "LXP", "LV": "LBC", "LW": "NMI", "LX": "SWR",
  "LY": "ELY", "M0": "MNG", "M3": "TUS", "M5": "KEN", "M6": "AJT", "M7": "MAA", "M8": "TNU", "M9": "MSI",
  "MA": "MAH", "MB": "MNB", "MC": "RCH", "MD": "MDG", "ME": "MEA", "MF": "CXA", "MG": "CCP", "MH": "MAS",
  "MI": "SLK", "MJ": "LPR", "MK": "MAU", "ML": "MAV", "MN": "CAW", "MO": "AUH", "MP": "MPH", "MQ": "EGF",
  "MR": "OME", "MS": "MSR", "MT": "TCX", "MU": "CES", "MV": "RML", "MW": "MYD", "MX": "MXA", "MY": "MWA",
  "MZ": "MNA", "N2": "DAG", "N3": "OMS", "N5": "SGY", "N6": "JEV", "N8": "NCR", "NB": "SNB", "NC": "NJS",
  "NE": "ESK", "NF": "AVN", "NG": "LDA", "NH": "ANA", "NI": "PGA", "NJ": "NGB", "NK": "NKS", "NL": "SAI",
  "NM": "DRD", "NN": "MOV", "NO": "AUS", "NP": "NIA", "NQ": "AJX", "NR": "JTO", "NT": "IBB", "NU": "JTA",
  "NV": "CRF", "NW": "NWA", "NX": "AMU", "NY": "FXI", "NZ": "ANZ", "O1": "OAB", "O6": "ONE", "O7": "OZJ",
  "O8": "OHK", "OA": "OAL", "OB": "ASZ", "OD": "MXD", "OE": "AOT", "OF": "FIF", "OH": "COM", "OI": "ORC",
  "OJ": "OLA", "OK": "CSA", "OL": "OLT", "OM": "MGL", "ON": "RON", "OO": "SKW", "OP": "PPL", "OQ": "CQN",
  "OR": "TFL", "OS": "AUA", "OT": "PEL", "OU": "CTN", "OV": "ELL", "OW": "EXK", "OX": "OEA", "OY": "OAE",
  "OZ": "AAR", "P5": "RPB", "P7": "REP", "P8": "MKG", "PA": "IPV", "PC": "PGT", "PD": "POE", "PE": "AEL",
  "PG": "BKP", "PH": "PAO", "PI": "PDT", "PJ": "SPM", "PK": "PIA", "PL": "PLI", "PM": "TOS", "PN": "CHB",
  "PO": "FPT", "PQ": "LOO", "PR": "PAL", "PS": "AUI", "PU": "PUA", "PV": "PNR", "PW": "PRF", "PX": "ANG",
  "PY": "SLM", "PZ": "LAP", "Q3": "QER", "Q4": "SAE", "Q5": "MLA", "Q6": "CDP", "Q8": "PEC", "Q9": "NAK",
  "QB": "GFG", "QD": "DOB", "QE": "ECC", "QF": "QFA", "QH": "FLZ", "QI": "CIM", "QK": "JZA", "QL": "RLN",
  "QM": "AML", "QN": "ARR", "QO": "OGN", "QQ": "UTY", "QR": "QTR", "QS": "TVS", "QT": "TPA", "QU": "UGX",
  "QV": "LAO", "QW": "BWG", "QX": "QXE", "QZ": "AWQ", "R0": "RPK", "R2": "ORB", "R3": "SYL", "R5": "MAC",
  "R7": "OCA", "R8": "RRJ", "R9": "CAM", "RA": "RNA", "RB": "SYR", "RC": "FLI", "RD": "RYN", "RE": "REA",
  "RF": "FWL", "RG": "VRN", "RH": "RPH", "RI": "MDL", "RJ": "RJA", "RK": "RKA", "RL": "RFJ", "RM": "RNY",
  "RN": "RAB", "RO": "ROT", "RP": "CHQ", "RQ": "KMF", "RR": "RXR", "RS": "SKV", "RU": "RUE", "RV": "CPN",
  "RW": "RPA", "RX": "RPO", "RY": "RAY", "S0": "SAL", "S2": "RSH", "S3": "BBR", "S4": "RZO", "S5": "TCF",
  "S7": "SBI", "S8": "SBD", "SA": "SAA", "SB": "ACI", "SC": "CDG", "SD": "SUD", "SE": "SEU", "SF": "DTH",
  "SG": "SEJ", "SH": "SHA", "SI": "SIH", "SJ": "SJY", "SK": "SAS", "SM": "MNP", "SN": "DAT", "SO": "SLC",
  "SP": "SAT", "SQ": "SIA", "SR": "SWR", "SS": "CRL", "ST": "GMI", "SU": "AFL", "SV": "SVA", "SW": "NMB",
  "SY": "SCX", "T2": "TCG", "T3": "EZE", "T4": "HEJ", "T5": "TUA", "T7": "TJT", "T9": "TRZ", "TA": "TAT",
  "TB": "TBZ", "TC": "ATC", "TD": "LUR", "TE": "LIL", "TF": "SCW", "TG": "THA", "TH": "THS", "TI": "THI",
  "TJ": "TJA", "TK": "THY", "TL": "TMA", "TN": "THT", "TO": "TVF", "TP": "TAP", "TQ": "TXW", "TR": "TGW",
  "TS": "TSC", "TT": "TGW", "TU": "TAR", "TV": "VEX", "TW": "TWB", "TX": "FWI", "TY": "IWD", "TZ": "SCO",
  "U1": "ABI", "U2": "EZY", "U3": "AIA", "U4": "PMT", "U5": "GWY", "U6": "SVR", "U8": "RNV", "U9": "TAK",
  "UA": "UAL", "UB": "UBA", "UD": "HER", "UE": "NAS", "UF": "UKM", "UG": "TUI", "UI": "ECA", "UJ": "LMU",
  "UK": "VTI", "UL": "ALK", "UM": "AZW", "UN": "TSO", "UO": "HKE", "UP": "BHS", "UQ": "SJU", "US": "USA",
  "UT": "UTA", "UU": "REU", "UX": "AEA", "UY": "UYC", "UZ": "BRQ", "V0": "VCV", "V1": "VIA", "V2": "RBY",
  "V3": "KRP", "V4": "REK", "V7": "VOE", "V8": "VAS", "V9": "HCW", "VA": "VOZ", "VE": "VLE", "VF": "VLU",
  "VG": "VLM", "VH": "VNP", "VI": "VDA", "VJ": "RAC", "VK": "VGN", "VL": "VIM", "VM": "VOA", "VN": "HVN",
  "VO": "TYR", "VP": "VSP", "VQ": "VKH", "VR": "TCV", "VS": "VIR", "VT": "VTA", "VU": "VUN", "VV": "AEW",
  "VW": "TAO", "VX": "VRD", "VY": "VLG", "VZ": "MYT", "W3": "WSS", "W4": "WER", "W5": "IRM", "W6": "WZZ",
  "W8": "CJT", "W9": "JAB", "WA": "WAL", "WB": "RWD", "WC": "ISV", "WD": "AAN", "WF": "WIF", "WJ": "WEB",
  "WK": "EDW", "WL": "FQR", "WN": "SWA", "WO": "WOA", "WP": "MKU", "WQ": "PQW", "WR": "WEN", "WS": "WJA",
  "WU": "WAU", "WV": "SWV", "WW": "BMI", "WX": "BCY", "WY": "OMA", "WZ": "RWZ", "X3": "HLX", "X5": "OTJ",
  "X7": "CHF", "XA": "XAU", "XB": "NXB", "XE": "BTA", "XF": "VLK", "XG": "CLI", "XJ": "MES", "XK": "CCM",
  "XL": "LNE", "XM": "SMX", "XO": "LTE", "XP": "XPT", "XQ": "SXS", "XS": "SIT", "XT": "AXL", "XW": "SXR",
  "XX": "GFY", "XY": "KNE", "Y4": "VOI", "Y5": "AWA", "Y8": "MRS", "Y9": "IRK", "YC": "YCC", "YE": "YEL",
  "YL": "LLM", "YM": "MGX", "YO": "TYS", "YP": "AEF", "YS": "RAE", "YV": "ASH", "YW": "ANE", "YX": "MEP",
  "YY": "VWA", "YZ": "YZZ", "Z3": "SMJ", "Z4": "OOM", "Z5": "IIR", "Z6": "ZTT", "Z8": "AZN", "ZA": "SUW",
  "ZB": "MON", "ZC": "KGO", "ZE": "ESR", "ZG": "VVM", "ZH": "CSZ", "ZI": "AAF", "ZK": "GLA", "ZL": "RXA",
  "ZM": "IWA", "ZN": "ZNA", "ZP": "ZZZ", "ZQ": "LOC", "ZS": "SMY", "ZU": "HCY", "ZV": "VAX", "ZW": "AWI",
  "ZX": "ZXY", "ZY": "ADE",
}

/** Convert an IATA flight ident like "BA178" to an ICAO callsign like "BAW178". */
export function identToCallsign(ident: string): string {
  const clean = ident.toUpperCase().replace(/\s+/g, '')
  const m = clean.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/)
  if (!m) return clean
  const [, code, num] = m
  const icao = IATA_TO_ICAO[code]
  return icao ? `${icao}${num}` : clean
}

// callsign → discovered icao24 hex, so subsequent polls can use the cheap
// icao24-filtered endpoint instead of scanning every aircraft in the sky.
const callsignToIcao = new Map<string, { icao24: string; ts: number }>()
const ICAO_CACHE_TTL = 6 * 60 * 60 * 1000

function toPosition(state: unknown[]): AircraftPosition | null {
  const [icao24, rawCallsign, , , lastContact, lon, lat, altitude, onGround, velocity, heading] = state as [
    string, string, string, null, number, number | null, number | null,
    number | null, boolean, number | null, number | null
  ]
  if (lat == null || lon == null) return null
  return {
    icao24: String(icao24),
    callsign: String(rawCallsign ?? '').trim(),
    latitude: lat as number,
    longitude: lon as number,
    altitude: (altitude as number) ?? 0,
    velocity: (velocity as number) ?? 0,
    heading: (heading as number) ?? 0,
    onGround: Boolean(onGround),
    lastContact: lastContact as number,
  }
}

async function fetchStates(query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${OPENSKY_BASE}/states/all${query}`, {
      headers: { 'User-Agent': 'Departarr/1.0' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { states?: unknown[][] | null }
    return data.states ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a live aircraft position from OpenSky (free, no key). Prefers the
 * flight ident (→ ICAO callsign match); falls back to a hex icao24 in the
 * registration field. Returns null when the flight isn't currently broadcasting
 * (e.g. on the ground / not yet departed) — that's expected, not an error.
 */
export async function getAircraftPosition(opts: {
  ident?: string
  registration?: string | null
}): Promise<AircraftPosition | null> {
  const { ident, registration } = opts

  // 1. If registration is actually a hex icao24, query it directly (cheap).
  if (registration && /^[0-9a-f]{6}$/i.test(registration)) {
    const states = await fetchStates(`?icao24=${registration.toLowerCase()}`)
    const s = states?.[0]
    return s ? toPosition(s) : null
  }

  if (!ident) return null
  const callsign = identToCallsign(ident)

  // 2. Cached icao24 for this callsign → cheap filtered query.
  const cached = callsignToIcao.get(callsign)
  if (cached && Date.now() - cached.ts < ICAO_CACHE_TTL) {
    const states = await fetchStates(`?icao24=${cached.icao24}`)
    const s = states?.[0]
    const pos = s ? toPosition(s) : null
    if (pos) return pos
    // fall through to full scan if the cached hex went stale
  }

  // 3. Full scan, match by callsign (no key needed).
  const states = await fetchStates('')
  if (!states) return null
  const match = states.find(
    (s) => Array.isArray(s) && typeof s[1] === 'string' && (s[1] as string).trim() === callsign
  )
  if (!match) return null

  const pos = toPosition(match)
  if (pos) callsignToIcao.set(callsign, { icao24: pos.icao24, ts: Date.now() })
  return pos
}
