import { REGION_BOUNDS, GAP_CELL_DEGREES } from '../config/constants.js';

const EARTH_RADIUS_KM = 6371.0088;

/** Haversine distance in kilometres between two lat/lng points. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Haversine distance in metres. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

/** True when a coordinate is a valid WGS84 lat/lng. */
export function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * True when a coordinate falls inside the Tamil Nadu deployment region
 * (lat 7.9–13.7, lng 76.1–80.5).
 */
export function isInsideRegion(lat, lng) {
  const b = REGION_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** Build a GeoJSON Point from lat/lng (note GeoJSON order is [lng, lat]). */
export function toGeoPoint(lat, lng) {
  return { type: 'Point', coordinates: [Number(lng), Number(lat)] };
}

/** Floor a coordinate to the 0.01-degree gap grid. */
export function gapCellIndex(lat, lng) {
  return {
    latCell: Math.floor(lat / GAP_CELL_DEGREES),
    lngCell: Math.floor(lng / GAP_CELL_DEGREES),
  };
}

/** Stable string key for a gap grid cell. */
export function gapCellKey(latCell, lngCell) {
  return `${latCell}:${lngCell}`;
}
