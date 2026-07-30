import { storage } from './storage.ts';

/** Anonymous device id so the bar can push "your drink" back to this device. */
const DEVICE_ID = 'device_id';
const NAME = 'name';

/**
 * A v4 UUID that works in non-secure contexts too.
 *
 * `crypto.randomUUID` is gated on a secure context, so it's undefined over plain
 * HTTP (the NAS on the LAN). `crypto.getRandomValues` is NOT gated, so it's
 * always available in the browsers we target — there is deliberately no
 * Math.random fallback, which would be the only non-CSPRNG path here.
 */
function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getDeviceId(): string {
  let id = storage.read(DEVICE_ID);
  if (!id) {
    id = uuid();
    storage.write(DEVICE_ID, id);
  }
  return id;
}

export const getSavedName = (): string => storage.read(NAME) ?? '';
export const saveName = (name: string): void => storage.write(NAME, name);
