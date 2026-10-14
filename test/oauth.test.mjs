import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAllowedRedirect, redirectMatches, pkceS256, validVerifier, validateAuthorizeParams,
  authorizationServerMetadata, protectedResourceMetadata,
} from '../lib/server/oauth.js'

test('PKCE S256 matches the RFC 7636 test vector', () => {
  assert.equal(pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  assert.equal(validVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), true)
  assert.equal(validVerifier('short'), false)
})

test('only Claude callbacks and loopback redirects may register', () => {
  assert.equal(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(isAllowedRedirect('http://localhost:3118/callback'), true)
  assert.equal(isAllowedRedirect('http://127.0.0.1:50000/callback'), true)
  assert.equal(isAllowedRedirect('https://evil.example/callback'), false)
  assert.equal(isAllowedRedirect('https://claude.ai.evil.example/api/mcp/auth_callback'), false)
  assert.equal(isAllowedRedirect('http://user:pw@localhost/callback'), false)
  assert.equal(isAllowedRedirect('javascript:alert(1)'), false)
})

test('loopback redirects match on any port, others exactly', () => {
  assert.equal(redirectMatches(['http://localhost/callback'], 'http://localhost:4321/callback'), true)
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://localhost:4321/callback'), false)
  assert.equal(redirectMatches(['http://localhost/callback'], 'http://localhost:4321/other'), false)
  assert.equal(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback2'), false)
})

test('authorize params need a registered redirect, code flow and S256', () => {
  const client = { client_id: 'c', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
  const ok = {
    response_type: 'code', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256',
  }
  assert.doesNotThrow(() => validateAuthorizeParams(ok, client))
  assert.throws(() => validateAuthorizeParams(ok, null), /Unknown client/)
  assert.throws(() => validateAuthorizeParams({ ...ok, redirect_uri: 'https://evil.example/cb' }, client), /redirect_uri/)
  assert.throws(() => validateAuthorizeParams({ ...ok, code_challenge_method: 'plain' }, client), /PKCE/)
  assert.throws(() => validateAuthorizeParams({ ...ok, response_type: 'token' }, client), /response_type/)
})

test('discovery metadata', () => {
  const as = authorizationServerMetadata('https://pm.example')
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none'])
  assert.equal(as.registration_endpoint, 'https://pm.example/api/oauth/register')
  assert.equal(protectedResourceMetadata('https://pm.example').resource, 'https://pm.example/api/mcp')
})
