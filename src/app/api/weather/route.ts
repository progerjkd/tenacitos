/**
 * Weather API - IP-based geolocation
 * GET /api/weather
 * Uses ip-api.com for geolocation + Open-Meteo for weather (both free, no API key)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Cache weather data for 10 minutes
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_DURATION = 10 * 60 * 1000;

const WMO_CODES: Record<number, { label: string; emoji: string }> = {
  0: { label: "Clear sky", emoji: "☀️" },
  1: { label: "Mainly clear", emoji: "🌤️" },
  2: { label: "Partly cloudy", emoji: "⛅" },
  3: { label: "Overcast", emoji: "☁️" },
  45: { label: "Foggy", emoji: "🌫️" },
  48: { label: "Icy fog", emoji: "🌫️" },
  51: { label: "Light drizzle", emoji: "🌦️" },
  53: { label: "Drizzle", emoji: "🌦️" },
  55: { label: "Heavy drizzle", emoji: "🌧️" },
  61: { label: "Light rain", emoji: "🌧️" },
  63: { label: "Rain", emoji: "🌧️" },
  65: { label: "Heavy rain", emoji: "🌧️" },
  71: { label: "Light snow", emoji: "🌨️" },
  73: { label: "Snow", emoji: "❄️" },
  75: { label: "Heavy snow", emoji: "❄️" },
  80: { label: "Light showers", emoji: "🌦️" },
  81: { label: "Showers", emoji: "🌧️" },
  82: { label: "Heavy showers", emoji: "⛈️" },
  95: { label: "Thunderstorm", emoji: "⛈️" },
  96: { label: "Thunderstorm with hail", emoji: "⛈��" },
  99: { label: "Thunderstorm with heavy hail", emoji: "⛈️" },
};

async function geolocateIp(ip: string): Promise<{ lat: number; lon: number; city: string; timezone: string } | null> {
  // Skip private/loopback IPs
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip === '::1') {
    return null;
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,timezone`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data.status === 'success') {
      return { lat: data.lat, lon: data.lon, city: data.city, timezone: data.timezone };
    }
  } catch {
    // geolocation failed — fall through to default
  }
  return null;
}

export async function GET(request: NextRequest) {
  // Get client IP
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  // Try to geolocate, fall back to server location
  const geo = await geolocateIp(ip);
  const lat = geo?.lat ?? 43.7001;    // Toronto fallback
  const lon = geo?.lon ?? -79.4163;
  const city = geo?.city ?? 'Unknown';
  const timezone = geo?.timezone ?? 'America/Toronto';

  // Return cached response for this IP/location
  const cacheKey = ip + ':' + city;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_DURATION) {
    return NextResponse.json(cached.data);
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=${encodeURIComponent(timezone)}&forecast_days=3`;

    const res = await fetch(url, { next: { revalidate: 600 } });
    const json = await res.json();

    const current = json.current;
    const daily = json.daily;

    const isDay = current.is_day === 1;
    const wmo = WMO_CODES[current.weather_code] || { label: "Unknown", emoji: "🌡️" };
    // Use moon emoji for clear/mainly-clear conditions at night
    let emoji = wmo.emoji;
    if (!isDay && current.weather_code <= 1) emoji = "🌙";

    const data = {
      city,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind: Math.round(current.wind_speed_10m),
      precipitation: current.precipitation,
      condition: wmo.label,
      emoji,
      is_day: current.is_day,
      forecast: daily.time.slice(0, 3).map((day: string, i: number) => ({
        day,
        max: Math.round(daily.temperature_2m_max[i]),
        min: Math.round(daily.temperature_2m_min[i]),
        emoji: (WMO_CODES[daily.weather_code[i]] || { emoji: "🌡️" }).emoji,
      })),
      updated: new Date().toISOString(),
    };

    cache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[weather] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch weather' }, { status: 500 });
  }
}
