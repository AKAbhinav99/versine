/* Shared network plumbing: one fetch wrapper, one cancel signal, one way of
 * turning a failure into something a person can read. */

const EARTH_RADIUS_M = 6371000;

/** Raised when the caller deliberately cancelled; callers ignore it silently. */
export class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

export const hostOf = (url) => { try { return new URL(url).host; } catch { return 'the server'; } };

/** Failures worth trying again, or trying the next provider for. */
export const TRANSIENT_STATUS = [408, 429, 500, 502, 503, 504];

/**
 * fetch with a hard deadline and an optional external cancel.
 *
 * A bare fetch rejects with TypeError("Failed to fetch") for every network-level
 * failure — DNS, refused connection, a server hanging up mid-response — and that
 * string tells a user nothing. Everything here comes back named.
 */
export async function fetchWithTimeout(url, options = {}, ms = 20000, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const relay = () => controller.abort();

  if (signal) {
    if (signal.aborted) throw new CancelledError();
    signal.addEventListener('abort', relay, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw new CancelledError();
    if (error.name === 'AbortError') {
      throw transient(`${hostOf(url)} did not answer within ${Math.round(ms / 1000)}s.`);
    }
    if (error instanceof TypeError) {
      if (!navigator.onLine) throw new Error('Your device is offline. Reconnect and try again.');
      throw transient(`Could not reach ${hostOf(url)}. The connection was refused or dropped.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

export const transient = (message) => Object.assign(new Error(message), { transient: true });

/** Reads a JSON body, turning an unhappy status into a labelled error. */
export async function readJson(response, label) {
  if (TRANSIENT_STATUS.includes(response.status)) {
    throw transient(`${label} answered ${response.status}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label} rejected the API key (${response.status}). Check it in the key settings.`);
  }
  if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
  return response.json();
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new CancelledError()); }, { once: true });
  });
}

export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tries each provider in turn until one returns something.
 *
 * A provider that has no key configured is skipped rather than failed, so the
 * chain reads the same whether a key is present or not. Every failure is kept
 * so the UI can say what was tried and why each one did not work.
 *
 * @returns {Promise<{value: *, provider: object, attempts: string[]}>}
 */
export async function runChain(providers, attempt, { signal = null } = {}) {
  const attempts = [];

  for (const provider of providers) {
    if (signal?.aborted) throw new CancelledError();
    if (!provider.available()) continue;

    try {
      const value = await attempt(provider);
      if (value !== null && value !== undefined) return { value, provider, attempts };
      attempts.push(`${provider.label}: nothing found`);
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      attempts.push(`${provider.label}: ${error.message}`);
    }
  }

  const error = new Error(attempts.length
    ? `Every lookup service failed. ${attempts.join(' · ')}`
    : 'No lookup service is configured.');
  error.attempts = attempts;
  throw error;
}
