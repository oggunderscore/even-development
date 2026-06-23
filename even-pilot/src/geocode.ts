export interface GeoLocation {
  street: string  // road / highway name
  city:   string  // city, town, or village
  state:  string  // 2-letter abbreviation
}

interface NominatimResponse {
  display_name?: string
  address?: {
    road?: string; suburb?: string
    city?: string; town?: string; village?: string
    state?: string; country_code?: string
  }
}

const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
  Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}

const FALLBACK: GeoLocation = { street: '', city: 'Unknown', state: '' }

export async function reverseGeocode(lat: number, lon: number): Promise<GeoLocation> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`

  let data: NominatimResponse
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'EvenPilot/0.1' },
    })
    if (!res.ok) return FALLBACK
    data = await res.json()
  } catch {
    return FALLBACK
  }

  const addr = data.address
  if (!addr) return FALLBACK

  const street = addr.road ?? ''
  const city   = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? ''
  const state  = addr.state
    ? (STATE_ABBR[addr.state] ?? addr.state.slice(0, 2).toUpperCase())
    : ''

  return { street, city, state }
}
