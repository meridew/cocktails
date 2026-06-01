import { storage } from './storage';

/** Anonymous device id so the bar can push "your drink" back to this device. */
const DEVICE_ID = 'device_id';
const NAME = 'name';

/**
 * A v4-ish UUID that works in non-secure contexts too. `crypto.randomUUID`
 * only exists over HTTPS/localhost; on plain HTTP (e.g. the NAS on the LAN)
 * it's undefined, so we fall back to getRandomValues / Math.random.
 */
function uuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
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
