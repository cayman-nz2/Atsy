// Application-layer encryption for stored CV bytes.
//
// R2 already encrypts everything at rest with AES-256, but that key belongs to
// the storage system: anything that can read the bucket can read the objects.
// Atsy encrypts the file inside the Worker first, with a key derived from a
// secret that lives nowhere in storage, so a leaked object — or a mis-scoped
// token — yields ciphertext and nothing else.
//
//   key    = HKDF-SHA256(CV_MASTER_KEY, salt, info = "atsy-cv:" + scanId)
//
// That "atsy-cv:" is a fixed domain separator, NOT the name of the R2 bucket.
// They were the same string once and no longer are. Changing it to follow a
// renamed bucket would silently make every object already in storage
// undecryptable, because the key is derived from it.
//   object = [ version | generation | salt(16) | iv(12) | AES-256-GCM(body) ]
//
// The per-file salt means two identical CVs produce unrelated ciphertext, and
// the scan id in the info string binds an object to the record that owns it:
// a ciphertext moved to another row will not decrypt.

const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 2 + SALT_BYTES + IV_BYTES;

export class DecryptionFailed extends Error {}

function masterKeyBytes(env) {
  const encoded = env.CV_MASTER_KEY;
  if (!encoded) throw new Error('CV_MASTER_KEY is not set');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < 32) throw new Error('CV_MASTER_KEY must be at least 32 bytes');
  return bytes;
}

async function deriveKey(env, salt, scanId) {
  const master = await crypto.subtle.importKey('raw', masterKeyBytes(env), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(`atsy-cv:${scanId}`) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt file bytes for storage. Returns the bytes to put in R2. */
export async function encryptFile(env, scanId, plaintext, generation = 1) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(env, salt, scanId);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

  const out = new Uint8Array(HEADER_BYTES + body.length);
  out[0] = FORMAT_VERSION;
  out[1] = generation;
  out.set(salt, 2);
  out.set(iv, 2 + SALT_BYTES);
  out.set(body, HEADER_BYTES);
  return out;
}

/**
 * Decrypt bytes read back from R2. Throws DecryptionFailed for anything that
 * has been tampered with, truncated, or written under a different key — never
 * returns partial or unauthenticated plaintext.
 */
export async function decryptFile(env, scanId, stored) {
  const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
  if (bytes.length <= HEADER_BYTES) throw new DecryptionFailed('object is too short to be a CV');
  if (bytes[0] !== FORMAT_VERSION) throw new DecryptionFailed(`unknown format version ${bytes[0]}`);

  const generation = bytes[1];
  const salt = bytes.slice(2, 2 + SALT_BYTES);
  const iv = bytes.slice(2 + SALT_BYTES, HEADER_BYTES);
  const body = bytes.slice(HEADER_BYTES);

  const key = await deriveKey(env, salt, scanId, generation);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    return new Uint8Array(plaintext);
  } catch {
    // GCM authentication failed: wrong key, wrong scan id, or altered bytes.
    throw new DecryptionFailed('could not decrypt this object');
  }
}

/** The key generation an object was written with, for rotation. */
export function keyGeneration(stored) {
  return stored.length > 1 ? stored[1] : null;
}
