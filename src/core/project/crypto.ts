import { sha256 } from '@noble/hashes/sha2.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function uid(): string {
  const cryptography = globalThis.crypto;
  if (typeof cryptography.randomUUID === 'function') return cryptography.randomUUID();
  // getRandomValues remains available on HTTP; randomUUID requires a secure context.
  const bytes = cryptography.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function digest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return hex(new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(bytes).buffer)));
  // Retain SHA-256 integrity checks on HTTP, including inside archive workers.
  return hex(sha256(bytes));
}
