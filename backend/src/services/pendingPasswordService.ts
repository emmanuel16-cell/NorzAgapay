import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

function getKey(): Buffer {
  if (!config.jwtSecret || (config.nodeEnv === 'production' && config.jwtSecret.length < 32)) {
    throw new Error('A strong JWT secret is required to protect pending account passwords.');
  }
  return createHash('sha256').update('norzagapay-pending-password:').update(config.jwtSecret).digest();
}

/** Encrypt a password while a short-lived SMS registration OTP is pending. */
export function encryptPendingPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptPendingPassword(payload: string): string {
  const [encodedIv, encodedTag, encodedCiphertext, extra] = payload.split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext || extra) throw new Error('Pending password data is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
