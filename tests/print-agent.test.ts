import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLUMNS, type Doc, encodeText, layout, renderEscPos, renderText, sendToPrinter, testDocument } from '../public/descargas/gastrobar-print.mjs';

test('tildes y eñes en la tabla de la impresora', () => {
  assert.deepEqual(encodeText('Limón ñ', 'cp850'), [0x4c, 0x69, 0x6d, 0xa2, 0x6e, 0x20, 0xa4]);
  assert.deepEqual(encodeText('ó', 'cp1252'), [0xf3]);
  assert.deepEqual(encodeText('Café ñ', 'ascii'), [...Buffer.from('Cafe n')]);
  assert.deepEqual(encodeText('¿¡', 'cp850'), [0xa8, 0xad]);
});

test('filas al ancho del papel: 48 columnas en 80 mm, 32 en 58 mm', () => {
  const doc = { blocks: [{ t: 'row', left: '2 x Hamburguesa', right: '$ 32.000' }, { t: 'rule' }] } as const satisfies Doc;
  for (const width of [80, 58] as const) {
    const lines = layout(doc, width);
    assert.equal(lines[0]!.text.length, COLUMNS[width]);
    assert.ok(lines[0]!.text.startsWith('2 x Hamburguesa') && lines[0]!.text.endsWith('$ 32.000'));
    assert.equal(lines[1]!.text, '-'.repeat(COLUMNS[width]));
  }
  // Nombre largo: se parte sin pisar el precio.
  const long = layout({ blocks: [{ t: 'row', left: 'Hamburguesa de la Casa La Artesana con Patacón', right: '$ 38.000' }] }, 58);
  assert.ok(long.length >= 2 && long.every((l) => l.text.length <= 32));
  assert.ok(long[0]!.text.endsWith('$ 38.000'));
});

test('texto grande usa media línea y se parte por palabras', () => {
  const lines = layout({ blocks: [{ t: 'text', text: 'MESA 12 · ORDEN 345 RONDA 2', big: true, align: 'center' }] }, 58);
  assert.ok(lines.every((l) => l.text.length <= 16 && l.big && l.align === 'center'));
});

test('ESC/POS: inicia, elige tabla, corta y abre el cajón sólo si se pide', () => {
  const bytes = renderEscPos(testDocument(), { paperWidth: 80, codepage: 'cp850', cut: true, openDrawer: true });
  const hex = bytes.toString('hex');
  assert.ok(hex.startsWith('1b7000'), 'cajón primero');
  assert.ok(hex.includes('1b40') && hex.includes('1b7402'), 'reinicio + tabla CP850');
  assert.ok(hex.endsWith('1d564200'), 'corte parcial al final');
  const plain = renderEscPos(testDocument(), { cut: false });
  assert.ok(!plain.toString('hex').startsWith('1b7000'));
  assert.ok(!plain.toString('hex').includes('1d5642'));
  // Copias: el cuerpo se repite.
  const one = renderEscPos(testDocument(), { copies: 1 }).length;
  assert.equal(renderEscPos(testDocument(), { copies: 2 }).length, one * 2);
});

test('modo universal: texto plano centrado sin comandos de impresora', () => {
  const text = renderText({ blocks: [{ t: 'text', text: 'PRECUENTA', align: 'center' }] }, { paperWidth: 58 });
  assert.equal(text, ' '.repeat(Math.floor((32 - 9) / 2)) + 'PRECUENTA');
  assert.ok(!text.includes('\x1b'));
});

test('impresora de red: los bytes ESC/POS llegan por el puerto 9100', async () => {
  const net = await import('node:net');
  const received: Buffer[] = [];
  const server = net.createServer((socket) => socket.on('data', (d) => received.push(d)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const job = { id: 'j1', payload: testDocument('Prueba'), copies: 1, open_drawer: false };
    const printer = { connection: 'network', target: `127.0.0.1:${port}`, paper_width: 80, codepage: 'cp850', mode: 'escpos', cut: true } as const;
    await sendToPrinter(printer, job);
    await new Promise((r) => setTimeout(r, 50));
    const bytes = Buffer.concat(received);
    assert.deepEqual(bytes, renderEscPos(job.payload, { paperWidth: 80, codepage: 'cp850', cut: true }));
    // Sin impresora escuchando: error claro.
    server.close();
    await assert.rejects(sendToPrinter({ ...printer, target: `127.0.0.1:${port}` }, job), /No hay conexión/);
  } finally {
    server.close();
  }
});
