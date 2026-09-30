import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPin, isPinRole, lockAfterFailure, minutesLeft, pinProblem, verifyPin } from '../lib/staff/pin.ts';

test('PIN: acepta 4 a 6 números y rechaza los obvios', () => {
  for (const ok of ['2580', '7391', '904172', '13579']) assert.equal(pinProblem(ok), null, ok);
  for (const bad of ['123', '1234567', '12a4', '0000', '111111', '1234', '4321', '56789', '987654', ''])
    assert.notEqual(pinProblem(bad), null, bad);
});

test('PIN: el hash no contiene el PIN, usa sal propia y verifica', () => {
  const a = hashPin('2580');
  const b = hashPin('2580');
  assert.notEqual(a, b, 'misma entrada, distinta sal');
  assert.ok(!a.includes('2580'));
  assert.ok(verifyPin('2580', a));
  assert.ok(!verifyPin('2581', a));
  assert.ok(!verifyPin('2580', 'basura'));
  assert.ok(!verifyPin('2580', 'bcrypt$1$x$y'));
});

test('PIN: bloqueo progresivo por intentos fallidos', () => {
  const now = new Date('2026-09-29T20:00:00Z');
  assert.equal(lockAfterFailure(1, now), null);
  assert.equal(lockAfterFailure(4, now), null);
  assert.equal(lockAfterFailure(5, now)?.toISOString(), '2026-09-29T20:05:00.000Z');
  assert.equal(lockAfterFailure(6, now), null);
  assert.equal(lockAfterFailure(10, now)?.toISOString(), '2026-09-29T20:30:00.000Z');
  assert.equal(lockAfterFailure(11, now)?.toISOString(), '2026-09-29T20:30:00.000Z');
  assert.equal(minutesLeft('2026-09-29T20:04:10Z', now), 5);
  assert.equal(minutesLeft('2026-09-29T19:59:00Z', now), 0);
  assert.equal(minutesLeft(null, now), 0);
});

test('PIN: sólo roles operativos (nunca admin ni agentes IA)', () => {
  assert.ok(isPinRole('waiter') && isPinRole('cashier') && isPinRole('kitchen') && isPinRole('bar'));
  assert.ok(!isPinRole('admin') && !isPinRole('ai_agent'));
});
