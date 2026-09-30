import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchByFilename, words } from '../lib/images/match.ts';

const products = [
  { id: 'mixta-pan', name: 'Hamburguesa Mixta con Pan' },
  { id: 'mixta-patacon', name: 'Hamburguesa Mixta con Patacón' },
  { id: 'lim-coco', name: 'Limonada de Coco' },
  { id: 'lim-natural', name: 'Limonada Natural' },
  { id: 'poker', name: 'Póker' },
  { id: 'mich-mango', name: 'Michelada Mango Biche' },
];

test('palabras: sin tildes, sin extensión, sin conectores ni números', () => {
  assert.deepEqual(words('Hamburguesa_Mixta-con-PATACÓN (2).JPG'), ['hamburguesa', 'mixta', 'patacon']);
});

test('empareja nombres de archivo claros', () => {
  assert.equal(matchByFilename('hamburguesa-mixta-patacon.jpg', products)?.id, 'mixta-patacon');
  assert.equal(matchByFilename('limonada coco.png', products)?.id, 'lim-coco');
  assert.equal(matchByFilename('michelada_mango_biche_2.webp', products)?.id, 'mich-mango');
  assert.equal(matchByFilename('poker.jpg', products)?.id, 'poker');
});

test('no adivina: nombres de Facebook, ambiguos o genéricos quedan sin asignar', () => {
  assert.equal(matchByFilename('123456789_10158123456789_987654321_n.jpg', products), null);
  assert.equal(matchByFilename('limonada.jpg', products), null, 'hay varias limonadas');
  assert.equal(matchByFilename('hamburguesa mixta.jpg', products), null, 'con pan o con patacón: empate');
  assert.equal(matchByFilename('IMG_2024.jpg', products), null);
});
