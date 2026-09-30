import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assistantLabel, isAllowedRedirectUri, normalizeScopes, randomToken, sha256Hex, verifyPkce } from '../lib/oauth/core.ts';

test('PKCE S256: sólo el verificador correcto abre el código', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'vector de la RFC 7636');
  assert.ok(verifyPkce(verifier, challenge));
  assert.ok(!verifyPkce(verifier.slice(0, -1) + 'Y', challenge));
  assert.ok(!verifyPkce('corto', challenge), 'verificador muy corto');
  assert.ok(!verifyPkce(verifier, 'otro'));
});

test('tokens opacos: prefijo, 256 bits y sólo su hash se guarda', () => {
  const t = randomToken('gba_');
  assert.match(t, /^gba_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(randomToken('gba_'), t);
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('direcciones de retorno: https o localhost, nunca otras', () => {
  assert.ok(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'));
  assert.ok(isAllowedRedirectUri('http://localhost:6274/callback'));
  assert.ok(!isAllowedRedirectUri('http://malicioso.com/callback'));
  assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
  assert.ok(!isAllowedRedirectUri('https://x.com/cb#frag'));
});

test('permisos: sólo los que existen; por defecto, lectura', () => {
  assert.deepEqual(normalizeScopes(''), ['gastrobar.read']);
  assert.deepEqual(normalizeScopes('gastrobar.read gastrobar.admin'), ['gastrobar.read']);
  assert.deepEqual(normalizeScopes('openid email'), ['gastrobar.read']);
});

test('nombre del asistente por su dirección de retorno', () => {
  assert.equal(assistantLabel('Claude', 'https://claude.ai/api/mcp/auth_callback'), 'Claude');
  assert.equal(assistantLabel('x', 'https://chatgpt.com/connector_platform_oauth_redirect'), 'ChatGPT');
  assert.equal(assistantLabel('Mi app', 'http://localhost:3000/cb'), 'Mi app');
});
