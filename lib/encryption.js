import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured.');
  }

  const buffer = Buffer.from(rawKey, rawKey.length === 64 ? 'hex' : 'utf8');
  if (buffer.length < 32) {
    const padded = Buffer.alloc(32);
    buffer.copy(padded);
    return padded;
  }

  return buffer.slice(0, 32);
}

export function encrypt(text) {
  if (text == null) {
    return null;
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(payload) {
  if (!payload) {
    return null;
  }

  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
  const data = buffer.subarray(IV_LENGTH + 16);
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
