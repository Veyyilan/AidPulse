/** Indian mobile numbers: exactly 10 digits starting 6-9 (as entered). */
export const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/** True when raw input is a 10-digit Indian mobile number. */
export function isValidIndianMobile(raw) {
  return INDIAN_MOBILE_RE.test(String(raw ?? '').trim());
}

/**
 * Normalise a phone number to the canonical stored form `+91XXXXXXXXXX`.
 * Accepts a bare 10-digit number or an already-+91-prefixed number.
 * Returns null when the input is not a valid Indian mobile number.
 */
export function normalizePhone(raw) {
  const value = String(raw ?? '').trim().replace(/[\s-]/g, '');
  if (INDIAN_MOBILE_RE.test(value)) return `+91${value}`;
  if (/^\+91[6-9]\d{9}$/.test(value)) return value;
  if (/^91[6-9]\d{9}$/.test(value)) return `+${value}`;
  return null;
}
