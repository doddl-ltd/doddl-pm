import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verifyIdToken } from '../lib/server/msalVerify.js'

const TENANT = '927d1e2c-7c8d-406f-8640-678dfce86b7d'
const CLIENT = 'bddcde1a-b104-4c96-8f67-9b40a1dfea3c'
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' }
const now = Date.now()

function sign(claims, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const h = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const s = crypto.sign('sha256', Buffer.from(`${h}.${p}`), key).toString('base64url')
  return `${h}.${p}.${s}`
}

const good = {
  aud: CLIENT, tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  exp: Math.floor(now / 1000) + 600, nbf: Math.floor(now / 1000) - 10,
  preferred_username: 'Jon@doddl.com', name: 'Jon Fawcett', oid: 'o1',
}
const opts = { jwks: [jwk], now }

test('accepts a valid doddl ID token and maps the display name', async () => {
  const u = await verifyIdToken(sign(good), opts)
  assert.equal(u.email, 'jon@doddl.com')
  assert.equal(u.name, 'Jon')
})

const badClaims = [
  ['wrong audience', { ...good, aud: 'someone-else' }],
  ['wrong tenant', { ...good, tid: '00000000-0000-0000-0000-000000000000' }],
  ['wrong issuer', { ...good, iss: 'https://evil.example/v2.0' }],
  ['expired', { ...good, exp: Math.floor(now / 1000) - 3600 }],
  ['not yet valid', { ...good, nbf: Math.floor(now / 1000) + 3600 }],
  ['no identity', { ...good, preferred_username: undefined }],
]
for (const [label, claims] of badClaims) {
  test(`rejects: ${label}`, async () => {
    await assert.rejects(verifyIdToken(sign(claims), opts), (e) => e.status === 401)
  })
}

test('rejects a token signed by another key', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  await assert.rejects(verifyIdToken(sign(good, { key: other }), opts), /signature/)
})

test('rejects tampered claims', async () => {
  const [h, , s] = sign(good).split('.')
  const p = Buffer.from(JSON.stringify({ ...good, preferred_username: 'attacker@doddl.com' })).toString('base64url')
  await assert.rejects(verifyIdToken(`${h}.${p}.${s}`, opts), /signature/)
})

test('rejects unknown kid, alg none and garbage', async () => {
  await assert.rejects(verifyIdToken(sign(good, { kid: 'nope' }), opts), /Unknown signing key/)
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${Buffer.from(JSON.stringify(good)).toString('base64url')}.`
  await assert.rejects(verifyIdToken(none, opts), /algorithm/)
  await assert.rejects(verifyIdToken('not-a-jwt', opts), /Malformed/)
  await assert.rejects(verifyIdToken(null, opts), /Missing/)
})
