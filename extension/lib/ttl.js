// Expiry for anything cached about a document. Pure, so it is tested in Node.

export const DEFAULT_TTL_MIN = 60;

export function expiresAt(now, ttlMin = DEFAULT_TTL_MIN) {
  return now + Math.max(1, ttlMin) * 60 * 1000;
}

export function isExpired(entry, now) {
  return !entry || typeof entry.expires !== 'number' || entry.expires <= now;
}

// Keys of a storage snapshot that should be removed now. Only keys this
// extension writes with an expiry (cache:, note:, job:) are considered.
export function expiredKeys(items, now) {
  return Object.keys(items).filter((k) => /^(cache|note|job):/.test(k) && isExpired(items[k], now));
}
