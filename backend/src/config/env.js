import dotenv from 'dotenv';

dotenv.config();

const isProd = (process.env.NODE_ENV || 'development') === 'production';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Parse "minLat,maxLat,minLng,maxLng" into an object.
 * Falls back to the whole world when unset/invalid.
 */
function parseRegionBounds(raw) {
  const world = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
  if (!raw) return world;
  const parts = raw.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    // eslint-disable-next-line no-console
    console.warn(`[env] Invalid DEPLOYMENT_REGION_BOUNDS="${raw}", using whole world.`);
    return world;
  }
  const [minLat, maxLat, minLng, maxLng] = parts;
  return { minLat, maxLat, minLng, maxLng };
}

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const jwtSecret = required('JWT_SECRET', 'dev-insecure-secret-change-me');
if (isProd && jwtSecret === 'dev-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production.');
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT || 4000),
  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017/aidpulse'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  staleClaimHours: Number(process.env.STALE_CLAIM_HOURS || 4),
  smsApiKey: process.env.SMS_API_KEY || '',
  regionBounds: parseRegionBounds(process.env.DEPLOYMENT_REGION_BOUNDS),
  gapCellThreshold: Number(process.env.GAP_CELL_THRESHOLD || 3),
  geocodeOnSms: parseBool(process.env.GEOCODE_ON_SMS, false),
};
