import type { CollectionName } from './types';

/** Guards for data arriving from the browser. Modest by design — this is a
 *  single-user, password-gated app — but enough that a malformed or runaway
 *  payload can't corrupt the database or blow up the row count. */

const MAX_STRING = 20_000;
const MAX_FIELDS = 60;
const MAX_ARRAY = 200;

export const COLLECTION_LIMITS: Record<CollectionName, number> = {
  companies: 5_000,
  contacts: 20_000,
  applications: 50_000,
  outreach: 20_000,
  templates: 500,
  jobSources: 2_000,
  runs: 200,
};

export class ValidationError extends Error {}

/**
 * Returns a cleaned copy: strips dangerous keys, drops nested objects deeper
 * than one level, and trims oversized values.
 */
export function sanitize(input: unknown, depth = 0): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('body must be a JSON object');
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) {
    throw new ValidationError(`too many fields (max ${MAX_FIELDS})`);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    // Prototype-pollution vectors have no legitimate use here.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (key.length > 100) continue;

    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value
        .slice(0, MAX_ARRAY)
        .filter((v) => ['string', 'number', 'boolean'].includes(typeof v))
        .map((v) => (typeof v === 'string' && v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v));
    } else if (typeof value === 'object' && depth < 1) {
      out[key] = sanitize(value, depth + 1);
    }
    // functions, symbols, and deeper nesting are dropped
  }
  return out;
}

/** Fields the server owns — a client must not be able to set or change them. */
const PROTECTED = ['id', 'createdAt'];

export function stripProtected(fields: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fields };
  for (const key of PROTECTED) delete out[key];
  return out;
}

export function assertRoom(collection: CollectionName, currentLength: number): void {
  const limit = COLLECTION_LIMITS[collection];
  if (currentLength >= limit) {
    throw new ValidationError(`${collection} is full (${limit} max) — delete some rows first`);
  }
}
