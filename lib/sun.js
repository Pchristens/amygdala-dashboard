// Real sun for the village: NOAA-style solar position for the human's location, so the world's day matches the clock.
// Location from AMYGDALA_LATLON ("lat,lon"); default Athens (the village is Aegean). Set it to your own place.
import { env } from './bin.js';
const [LAT, LON] = (env('LATLON') || '37.98,23.73').split(',').map(Number);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// Solar altitude/azimuth (degrees) at time t (ms).
export function sunAt(t = Date.now(), lat = LAT, lon = LON) {
  const d = t / 86400000 - 10957.5;                      // days since J2000.0
  const g = rad((357.529 + 0.98560028 * d) % 360);       // mean anomaly
  const q = (280.459 + 0.98564736 * d) % 360;            // mean longitude
  const L = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const e = rad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = rad(((gmst * 15 + lon) - deg(ra)) % 360);   // hour angle
  const φ = rad(lat);
  const alt = Math.asin(Math.sin(φ) * Math.sin(dec) + Math.cos(φ) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(φ) - Math.sin(φ) * Math.cos(H));
  return { altitude: +deg(alt).toFixed(2), azimuth: +((deg(az) + 360) % 360).toFixed(1) };
}

// Today's sunrise/sunset (altitude crosses −0.833°), found by stepping through the local day.
export function sunTimes(t = Date.now()) {
  const day = new Date(t); day.setHours(0, 0, 0, 0);
  let rise = null, set = null, prev = sunAt(day.getTime()).altitude;
  for (let m = 5; m <= 1440; m += 5) {
    const ts = day.getTime() + m * 60000, a = sunAt(ts).altitude;
    if (prev < -0.833 && a >= -0.833) rise ??= ts;
    if (prev >= -0.833 && a < -0.833) set = ts;
    prev = a;
  }
  return { sunrise: rise, sunset: set };
}

// Phase names follow the real sun: night < −6° (civil twilight), dawn/twilight between −6° and +6°, then morning/afternoon.
export function phaseOf(t = Date.now()) {
  const { altitude } = sunAt(t), noon = new Date(t).getHours() < 12;
  if (altitude < -6) return 'night';
  if (altitude < 6) return noon ? 'dawn' : 'twilight';
  return noon ? 'morning' : 'afternoon';
}
