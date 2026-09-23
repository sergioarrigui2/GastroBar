import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado de credenciales de proveedores con AES-256-GCM. La clave se deriva
 * (SHA-256) de EINVOICE_ENCRYPTION_KEY, así que acepta cualquier secreto largo.
 * Formato: "v1.<iv>.<tag>.<cifrado>" en base64url.
 */
const VERSION = 'v1';

function keyFrom(secret: string | undefined): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error('EINVOICE_ENCRYPTION_KEY no está configurada (mínimo 16 caracteres)');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptJson(value: unknown, secret = process.env.EINVOICE_ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptJson<T = unknown>(token: string, secret = process.env.EINVOICE_ENCRYPTION_KEY): T {
  const [version, iv, tag, data] = token.split('.');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Credenciales cifradas con un formato desconocido');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/** "••••a1b2" para mostrar un secreto sin revelarlo. */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;
}
