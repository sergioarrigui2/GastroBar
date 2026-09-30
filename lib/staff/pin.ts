import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * PIN del personal para terminales compartidas.
 *
 * Un PIN de 4–6 dígitos tiene poca entropía, así que la defensa real es otra:
 * sólo se acepta desde una terminal autorizada por el admin y cada empleado se
 * bloquea tras varios intentos fallidos. Aun así se guarda con scrypt y sal
 * propia, para que un volcado de la tabla no entregue los PINs.
 */
export const PIN_ROLES = ['waiter', 'cashier', 'kitchen', 'bar'] as const;
export type PinRole = (typeof PIN_ROLES)[number];

export function isPinRole(role: string): role is PinRole {
  return (PIN_ROLES as readonly string[]).includes(role);
}

/** Motivo por el que el PIN no sirve, o null si es válido. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'El PIN debe tener entre 4 y 6 números';
  if (/^(\d)\1+$/.test(pin)) return 'El PIN no puede repetir el mismo número';
  const digits = [...pin].map(Number);
  const step = digits[1]! - digits[0]!;
  if (Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step)) {
    return 'El PIN no puede ser una secuencia (1234, 4321…)';
  }
  return null;
}

const N = 16384;
const KEY_LENGTH = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, { N });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(pin, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n) });
  return timingSafeEqual(actual, expected);
}

/** Tras 5 fallos seguidos, 5 minutos de bloqueo; desde el 10.º, 30 minutos. */
export function lockAfterFailure(failedAttempts: number, now: Date): Date | null {
  if (failedAttempts >= 10) return new Date(now.getTime() + 30 * 60_000);
  if (failedAttempts >= 5 && failedAttempts % 5 === 0) return new Date(now.getTime() + 5 * 60_000);
  return null;
}

export function minutesLeft(lockedUntil: string | null, now: Date): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 60_000));
}
