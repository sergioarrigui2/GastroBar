import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptJson, encryptJson, maskSecret } from '../lib/einvoice/crypto.ts';
import { simulatorProvider } from '../lib/einvoice/providers/simulator.ts';

const SECRET = 'clave-de-prueba-suficientemente-larga';

test('cifrado de credenciales: ida y vuelta, y detecta manipulación o clave distinta', () => {
  const token = encryptJson({ api_token: 'tok_123456789', company_id: '42' }, SECRET);
  assert.ok(token.startsWith('v1.'));
  assert.ok(!token.includes('tok_123456789'));
  assert.deepEqual(decryptJson(token, SECRET), { api_token: 'tok_123456789', company_id: '42' });
  assert.throws(() => decryptJson(token, 'otra-clave-distinta-pero-larga'));
  const parts = token.split('.');
  parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptJson(parts.join('.'), SECRET));
  assert.throws(() => encryptJson({}, 'corta'), /EINVOICE_ENCRYPTION_KEY/);
  assert.equal(maskSecret('abcdef123456'), '••••3456');
});

const payload = {
  order: { id: 'o1', number: 7, table: 'T1', closed_at: null, guests: 2 },
  seller: { name: 'Bar', tax_id: '900123456', address: null, phone: null, currency: 'COP' },
  items: [],
  totals: { subtotal: 25000, discount: 0, total: 25000, tax: 1851.85, base: 23148.15 },
  taxes: [{ rate: 8, base: 23148.15, amount: 1851.85 }],
  payments: [{ method: 'cash' as const, amount: 25000, tip: 0 }],
};

test('simulador: acepta POS con CUDE SHA-384 determinístico y exige cliente para factura', async () => {
  const config = simulatorProvider.configSchema.parse({});
  const request = { documentId: 'd1', docType: 'pos' as const, environment: 'test' as const, customer: null, payload };
  const first = await simulatorProvider.issue(request, config);
  const second = await simulatorProvider.issue(request, config);
  assert.equal(first.status, 'accepted');
  assert.deepEqual(first, { ...second, issuedAt: (first as { issuedAt: string }).issuedAt });
  if (first.status === 'accepted') {
    assert.match(first.cufe!, /^[0-9a-f]{96}$/);
    assert.match(first.number!, /^SIM\d+$/);
    assert.match(first.qrData!, /^SIMULADO\|/);
  }

  const invoice = await simulatorProvider.issue({ ...request, docType: 'invoice' }, config);
  assert.equal(invoice.status, 'rejected');
  assert.deepEqual(simulatorProvider.environments, ['test']);
});
